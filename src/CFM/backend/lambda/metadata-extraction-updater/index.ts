// lambda/metadata-extraction-updater/index.ts
import { SQSEvent, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

// Initialize clients
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const sqsClient = new SQSClient({});

// Environment variables
const METADATA_TABLE = process.env.METADATA_TABLE!;
const CLASSIFICATION_QUEUE_URL = process.env.CLASSIFICATION_QUEUE_URL!;

/**
 * This Lambda acts as a bridge between the Phase 2 metadata extraction
 * and the Phase 3 document classification process.
 *
 * It listens to the same queue as the metadata extractor,
 * checks if the file is eligible for document classification,
 * and forwards it to the classification queue.
 */
export const handler = async (event: SQSEvent, context: Context): Promise<void> => {
    console.log(`Processing ${event.Records.length} messages for classification routing`);

    // Process each message
    for (const record of event.Records) {
        try {
            // Parse message body
            const message = JSON.parse(record.body);

            // Extract necessary information
            const { fileId, s3Key, operation } = message;

            // Validate required fields
            if (!fileId || !s3Key) {
                console.error('Missing required fields in message:', message);
                continue;
            }

            // Skip messages that aren't for metadata extraction
            if (operation && operation !== 'extract-metadata') {
                console.log(`Skipping message with operation: ${operation}`);
                continue;
            }

            console.log(`Checking if file ${fileId} is eligible for classification`);

            // Get file metadata from DynamoDB
            const metadataResponse = await ddbDocClient.send(new GetCommand({
                TableName: METADATA_TABLE,
                Key: { fileId },
            }));

            if (!metadataResponse.Item) {
                console.warn(`File metadata not found for fileId ${fileId}`);
                continue;
            }

            const metadata = metadataResponse.Item;

            // Only route documents with textual content for classification
            const isEligibleForClassification =
                metadata.contentCategory === 'document' ||
                metadata.contentCategory === 'spreadsheet' ||
                metadata.contentCategory === 'presentation' ||
                (metadata.textContent && metadata.textContent.length > 0);

            if (!isEligibleForClassification) {
                console.log(`File ${fileId} is not eligible for classification`);
                continue;
            }

            // Send to document classification queue
            await sqsClient.send(new SendMessageCommand({
                QueueUrl: CLASSIFICATION_QUEUE_URL,
                MessageBody: JSON.stringify({
                    fileId,
                    s3Key,
                    fileName: metadata.fileName,
                    operation: 'classify-document',
                }),
            }));

            console.log(`Sent file ${fileId} to classification queue`);

            // Delete from original queue to avoid double processing
            await sqsClient.send(new DeleteMessageCommand({
                QueueUrl: process.env.QUEUE_URL!, // Original queue URL
                ReceiptHandle: record.receiptHandle,
            }));
        } catch (error) {
            console.error('Error processing record:', error);
            // Don't delete the message, let it go back to the queue for retry
        }
    }

    console.log('Finished processing messages for classification routing');
};