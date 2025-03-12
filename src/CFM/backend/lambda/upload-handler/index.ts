// lambda/upload-handler/index.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Initialize clients
const s3Client = new S3Client({});
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// Environment variables
const BUCKET_NAME = process.env.BUCKET_NAME!;
const METADATA_TABLE = process.env.METADATA_TABLE!;

/**
 * Lambda handler for file uploads
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        // Basic request validation
        if (!event.body) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Request body is missing' }),
            };
        }

        // Parse the request body
        const requestBody = JSON.parse(event.body);
        const { fileName, fileType, fileContent, userId } = requestBody;

        if (!fileName || !fileType || !fileContent || !userId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing required fields' }),
            };
        }

        // Generate a unique file ID
        const fileId = uuidv4();

        // Decode base64 file content
        const decodedFileContent = Buffer.from(fileContent, 'base64');

        // Upload file to S3
        const s3Key = `users/${userId}/${fileId}-${fileName}`;
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: decodedFileContent,
            ContentType: fileType,
            Metadata: {
                'file-id': fileId,
                'original-name': fileName,
                'user-id': userId,
            },
        }));

        // Extract basic metadata (Phase 1 - simple version)
        const fileExtension = fileName.split('.').pop()?.toLowerCase();
        const fileSize = decodedFileContent.length;
        const uploadDate = new Date().toISOString();

        // For Phase 1, we'll use simple metadata based on file properties
        // Phase 2 will add intelligent metadata extraction
        const metadata = {
            fileId,
            fileName,
            fileType,
            fileExtension,
            fileSize,
            s3Key,
            uploadDate,
            userId,
            contentKeywords: [], // Will be populated in Phase 2
        };

        // Store metadata in DynamoDB
        await ddbDocClient.send(new PutCommand({
            TableName: METADATA_TABLE,
            Item: metadata,
        }));

        // Return success response with file details
        return {
            statusCode: 201,
            body: JSON.stringify({
                message: 'File uploaded successfully',
                fileId,
                fileName,
                uploadDate,
            }),
        };
    } catch (error) {
        console.error('Error uploading file:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error uploading file',
                error: (error as Error).message,
            }),
        };
    }
};