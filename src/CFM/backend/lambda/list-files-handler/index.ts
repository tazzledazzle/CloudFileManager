// lambda/list-files-handler/index.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

// Initialize clients
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// Environment variables
const METADATA_TABLE = process.env.METADATA_TABLE!;

/**
 * Lambda handler for listing files
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        // Extract query string parameters
        const userId = event.queryStringParameters?.userId;
        const limit = event.queryStringParameters?.limit
            ? parseInt(event.queryStringParameters.limit)
            : 50;
        const lastEvaluatedKey = event.queryStringParameters?.lastKey
            ? JSON.parse(event.queryStringParameters.lastKey)
            : undefined;

        if (!userId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'userId is required as a query parameter' }),
            };
        }

        // Query files by userId using the GSI
        const queryResult = await ddbDocClient.send(new QueryCommand({
            TableName: METADATA_TABLE,
            IndexName: 'userIdIndex',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': userId,
            },
            Limit: limit,
            ScanIndexForward: false, // Sort in descending order (newest first)
            ExclusiveStartKey: lastEvaluatedKey,
        }));

        // Format the response
        const files = queryResult.Items?.map(item => ({
            fileId: item.fileId,
            fileName: item.fileName,
            fileType: item.fileType,
            fileSize: item.fileSize,
            uploadDate: item.uploadDate,
            fileExtension: item.fileExtension,
        })) || [];

        // Return the files with pagination info
        return {
            statusCode: 200,
            body: JSON.stringify({
                files,
                pagination: {
                    count: files.length,
                    lastEvaluatedKey: queryResult.LastEvaluatedKey
                        ? JSON.stringify(queryResult.LastEvaluatedKey)
                        : null,
                    hasMore: !!queryResult.LastEvaluatedKey,
                },
            }),
        };
    } catch (error) {
        console.error('Error listing files:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error listing files',
                error: (error as Error).message,
            }),
        };
    }
};