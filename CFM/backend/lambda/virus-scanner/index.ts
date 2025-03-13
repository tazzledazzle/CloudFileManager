// lambda/virus-scanner/index.ts
import { S3Event, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import * as child_process from 'child_process';
import { Stream } from 'stream';

// Initialize clients
const s3Client = new S3Client({});
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const snsClient = new SNSClient({});
const sqsClient = new SQSClient({});

// Environment variables
const BUCKET_NAME = process.env.BUCKET_NAME!;
const METADATA_TABLE = process.env.METADATA_TABLE!;
const QUARANTINE_PREFIX = process.env.QUARANTINE_PREFIX || 'quarantine/';
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;
const PROCESSING_QUEUE_URL = process.env.PROCESSING_QUEUE_URL!;

// For ClamAV
const CLAMAV_PATH = '/opt/clamav';
const VIRUS_DEFINITIONS_PATH = '/tmp/clamav_defs';

// Promisify exec
const exec = util.promisify(child_process.exec);

/**
 * Ensures ClamAV virus definitions are present and up to date
 */
async function ensureVirusDefinitions(): Promise<void> {
    try {
        if (!fs.existsSync(VIRUS_DEFINITIONS_PATH)) {
            fs.mkdirSync(VIRUS_DEFINITIONS_PATH, { recursive: true });
        }

        // Check if definitions exist and are recent
        const mainFile = path.join(VIRUS_DEFINITIONS_PATH, 'main.cvd');
        if (fs.existsSync(mainFile)) {
            const stats = fs.statSync(mainFile);
            const fileAgeHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);

            // If definitions are less than 24 hours old, use them
            if (fileAgeHours < 24) {
                console.log('Using existing virus definitions');
                return;
            }
        }

        // Download fresh definitions
        console.log('Downloading latest virus definitions...');
        await exec(`cd ${VIRUS_DEFINITIONS_PATH} && ${CLAMAV_PATH}/bin/freshclam --config-file=${CLAMAV_PATH}/etc/freshclam.conf --datadir=${VIRUS_DEFINITIONS_PATH}`);
        console.log('Virus definitions updated successfully');
    } catch (error) {
        console.error('Error updating virus definitions:', error);
        // Continue with existing definitions if update fails
    }
}

/**
 * Scans a file for viruses using ClamAV
 */
async function scanFile(filePath: string): Promise<{ isInfected: boolean, virusName?: string }> {
    try {
        const { stdout, stderr } = await exec(`${CLAMAV_PATH}/bin/clamscan --database=${VIRUS_DEFINITIONS_PATH} ${filePath}`);

        // Check if virus detected
        if (stdout.includes('Infected files: 1')) {
            // Extract virus name
            const match = stdout.match(/: ([^\n]+) FOUND/);
            const virusName = match ? match[1] : 'Unknown virus';
            return { isInfected: true, virusName };
        }

        return { isInfected: false };
    } catch (error) {
        // ClamAV returns non-zero exit code if virus found
        const output = (error as any).stdout || '';

        if (output.includes('Infected files: 1')) {
            const match = output.match(/: ([^\n]+) FOUND/);
            const virusName = match ? match[1] : 'Unknown virus';
            return { isInfected: true, virusName };
        }

        console.error('Error scanning file:', error);
        throw error;
    }
}

/**
 * Download file from S3 to local file system
 */
async function downloadFileFromS3(bucket: string, key: string, localPath: string): Promise<void> {
    try {
        const command = new GetObjectCommand({ Bucket: bucket, Key: key });
        const response = await s3Client.send(command);

        if (!response.Body) {
            throw new Error('Empty file body');
        }

        // Create write stream
        const fileStream = fs.createWriteStream(localPath);

        // Convert body to stream and pipe to file
        if (response.Body instanceof Stream) {
            return new Promise((resolve, reject) => {
                const stream = response.Body as Stream;
                stream.pipe(fileStream)
                    .on('error', (err) => reject(err))
                    .on('finish', () => resolve());
            });
        } else {
            // Handle if body is not a stream (unlikely)
            const buffer = Buffer.from(await response.Body.transformToByteArray());
            fs.writeFileSync(localPath, buffer);
        }
    } catch (error) {
        console.error(`Error downloading file ${key}:`, error);
        throw error;
    }
}

/**
 * Move infected file to quarantine
 */
async function quarantineFile(bucket: string, key: string): Promise<void> {
    try {
        const fileName = path.basename(key);
        const quarantineKey = `${QUARANTINE_PREFIX}${fileName}`;

        // Copy to quarantine location
        await s3Client.send(new CopyObjectCommand({
            Bucket: bucket,
            CopySource: `${bucket}/${key}`,
            Key: quarantineKey,
            Metadata: {
                'quarantine-reason': 'virus-detected',
                'original-path': key,
                'quarantine-date': new Date().toISOString()
            },
            MetadataDirective: 'REPLACE',
        }));

        // Delete original file
        await s3Client.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: key
        }));

        console.log(`File ${key} moved to quarantine at ${quarantineKey}`);
    } catch (error) {
        console.error(`Error quarantining file ${key}:`, error);
        throw error;
    }
}

/**
 * Get file ID from S3 key
 */
async function getFileIdFromS3Key(key: string): Promise<string | null> {
    try {
        // Extract file ID from S3 key
        // Expected format: users/{userId}/{fileId}-{fileName}
        const match = key.match(/users\/[^\/]+\/([^-]+)-/);
        if (match && match[1]) {
            return match[1];
        }

        // If we can't extract from the key, try to get it from S3 metadata
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        const response = await s3Client.send(command);
        return response.Metadata?.['file-id'] || null;
    } catch (error) {
        console.error(`Error getting file ID for ${key}:`, error);
        return null;
    }
}

/**
 * Update file metadata to mark as infected
 */
async function markFileAsInfected(fileId: string, virusName: string): Promise<void> {
    try {
        // Get current metadata
        const getResult = await ddbDocClient.send(new GetCommand({
            TableName: METADATA_TABLE,
            Key: { fileId },
        }));

        if (!getResult.Item) {
            console.warn(`File metadata not found for fileId ${fileId}`);
            return;
        }

        // Update metadata
        await ddbDocClient.send(new UpdateCommand({
            TableName: METADATA_TABLE,
            Key: { fileId },
            UpdateExpression: 'SET securityStatus = :status, securityDetails = :details, quarantineDate = :date',
            ExpressionAttributeValues: {
                ':status': 'infected',
                ':details': { virusName },
                ':date': new Date().toISOString(),
            },
        }));

        console.log(`Updated metadata for infected file ${fileId}`);
    } catch (error) {
        console.error(`Error updating metadata for file ${fileId}:`, error);
        throw error;
    }
}

/**
 * Mark file as clean and queue for content analysis
 */
async function markFileAsClean(fileId: string, s3Key: string): Promise<void> {
    try {
        // Update metadata
        await ddbDocClient.send(new UpdateCommand({
            TableName: METADATA_TABLE,
            Key: { fileId },
            UpdateExpression: 'SET securityStatus = :status, securityScanDate = :date',
            ExpressionAttributeValues: {
                ':status': 'clean',
                ':date': new Date().toISOString(),
            },
        }));

        console.log(`Marked file ${fileId} as clean`);

        // Queue for metadata extraction
        await sqsClient.send(new SendMessageCommand({
            QueueUrl: PROCESSING_QUEUE_URL,
            MessageBody: JSON.stringify({
                fileId,
                s3Key,
                operation: 'extract-metadata',
            }),
        }));

        console.log(`Queued file ${fileId} for metadata extraction`);
    } catch (error) {
        console.error(`Error marking file as clean: ${fileId}`, error);
        throw error;
    }
}

/**
 * Send notification about infected file
 */
async function sendInfectionNotification(fileId: string, fileName: string, virusName: string): Promise<void> {
    if (!NOTIFICATION_TOPIC_ARN) {
        return; // Skip if no topic configured
    }

    try {
        await snsClient.send(new PublishCommand({
            TopicArn: NOTIFICATION_TOPIC_ARN,
            Subject: 'Virus Detected in Uploaded File',
            Message: JSON.stringify({
                message: `A virus was detected in an uploaded file`,
                fileId,
                fileName,
                virusName,
                detectionTime: new Date().toISOString(),
                action: 'File was quarantined',
            }),
        }));

        console.log(`Sent infection notification for file ${fileId}`);
    } catch (error) {
        console.error('Error sending notification:', error);
        // Non-critical, continue even if notification fails
    }
}

/**
 * Lambda handler for virus scanning
 */
export const handler = async (event: S3Event, context: Context): Promise<void> => {
    console.log('Starting virus scan for uploaded files');

    // Ensure virus definitions are up to date
    await ensureVirusDefinitions();

    // Process each file in the event
    for (const record of event.Records) {
        // Skip deleted objects
        if (record.eventName?.startsWith('ObjectRemoved')) {
            continue;
        }

        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

        // Skip files already in quarantine
        if (key.startsWith(QUARANTINE_PREFIX)) {
            console.log(`Skipping quarantined file: ${key}`);
            continue;
        }

        console.log(`Scanning file: ${key}`);

        try {
            // Create temp directory for file
            const tempDir = `/tmp/${context.awsRequestId}`;
            fs.mkdirSync(tempDir, { recursive: true });

            const fileName = path.basename(key);
            const localPath = path.join(tempDir, fileName);

            // Download file from S3
            await downloadFileFromS3(bucket, key, localPath);

            // Scan the file
            const scanResult = await scanFile(localPath);

            // Get file ID from S3 key or metadata
            const fileId = await getFileIdFromS3Key(key);
            if (!fileId) {
                console.error(`Unable to determine file ID for ${key}`);
                continue;
            }

            if (scanResult.isInfected) {
                console.warn(`Virus detected in file ${key}: ${scanResult.virusName}`);

                // Quarantine infected file
                await quarantineFile(bucket, key);

                // Update metadata
                await markFileAsInfected(fileId, scanResult.virusName!);

                // Send notification
                await sendInfectionNotification(fileId, fileName, scanResult.virusName!);
            } else {
                console.log(`File ${key} is clean`);

                // Mark as clean and queue for processing
                await markFileAsClean(fileId, key);
            }

            // Clean up temporary files
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.error(`Error processing file ${key}:`, error);
            // Continue with next file
        }
    }

    console.log('Virus scanning completed');
};