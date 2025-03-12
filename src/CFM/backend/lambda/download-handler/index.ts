// lambda/download-handler/index.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize clients
const s3Client = new S3Client({});
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// Environment variables
const BUCKET_NAME = process.env.BUCKET_NAME!;
const METADATA_TABLE = process.env.METADATA_TABLE!;

/**
 * Lambda handler for file downloads
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        // Extract file ID from path parameter
        const fileId = event.pathParameters?.fileId;

        if (!fileId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'File ID is required' }),
            };
        }

        // Get file metadata from DynamoDB
        const metadataResponse = await ddbDocClient.send(new GetCommand({
            TableName: METADATA_TABLE,
            Key: { fileId },
        }));

        if (!metadataResponse.Item) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'File not found' }),
            };
        }

        const fileMetadata = metadataResponse.Item;

        // Generate a pre-signed URL for secure download (valid for 15 minutes)
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fileMetadata.s3Key,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

        // Return the pre-signed URL and metadata
        return {
            statusCode: 200,
            body: JSON.stringify({
                fileId: fileMetadata.fileId,
                fileName: fileMetadata.fileName,
                fileType: fileMetadata.fileType,
                fileSize: fileMetadata.fileSize,
                uploadDate: fileMetadata.uploadDate,
                downloadUrl: presignedUrl,
                expiresIn: '15 minutes',
            }),
        };
    } catch (error) {
        console.error('Error generating download URL:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error generating download URL',
                error: (error as Error).message,
            }),
        };
    }
};