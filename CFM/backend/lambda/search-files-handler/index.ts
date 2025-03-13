// lambda/search-files-handler/index.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

// Initialize clients
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// Environment variables
const METADATA_TABLE = process.env.METADATA_TABLE!;

/**
 * Lambda handler for searching files
 *
 * Phase 1 implementation provides basic search by file name and type
 * Phase 2 will enhance with content-based search using extracted metadata
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        // Extract query string parameters
        const userId = event.queryStringParameters?.userId;
        const query = event.queryStringParameters?.q?.toLowerCase();
        const fileType = event.queryStringParameters?.fileType;
        const fileExtension = event.queryStringParameters?.fileExtension;
        const limit = event.queryStringParameters?.limit
            ? parseInt(event.queryStringParameters.limit)
            : 50;

        if (!userId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'userId is required as a query parameter' }),
            };
        }

        // Build filter expression based on search parameters
        let filterExpressions = [];
        let expressionAttributeValues: Record<string, any> = {
            ':userId': userId,
        };

        // Add file name search if query provided
        if (query) {
            filterExpressions.push('contains(lower(fileName), :query)');
            expressionAttributeValues[':query'] = query;
        }

        // Add file type filter if provided
        if (fileType) {
            filterExpressions.push('fileType = :fileType');
            expressionAttributeValues[':fileType'] = fileType;
        }

        // Add file extension filter if provided
        if (fileExtension) {
            filterExpressions.push('fileExtension = :fileExtension');
            expressionAttributeValues[':fileExtension'] = fileExtension;
        }

        // Build the filter expression string
        const filterExpression = filterExpressions.length > 0
            ? filterExpressions.join(' AND ')
            : undefined;

        // In Phase 1, we'll use scan with filters (Phase 2 will use GSI for content search)
        const scanResult = await ddbDocClient.send(new ScanCommand({
            TableName: METADATA_TABLE,
            FilterExpression: `userId = :userId${filterExpression ? ` AND ${filterExpression}` : ''}`,
            ExpressionAttributeValues: expressionAttributeValues,
            Limit: limit,
        }));

        // Format the response
        const files = scanResult.Items?.map(item => ({
            fileId: item.fileId,
            fileName: item.fileName,
            fileType: item.fileType,
            fileSize: item.fileSize,
            uploadDate: item.uploadDate,
            fileExtension: item.fileExtension,
        })) || [];

        // Return the search results
        return {
            statusCode: 200,
            body: JSON.stringify({
                query: query || '',
                filters: {
                    fileType,
                    fileExtension,
                },
                results: {
                    count: files.length,
                    files,
                },
            }),
        };
    } catch (error) {
        console.error('Error searching files:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error searching files',
                error: (error as Error).message,
            }),
        };
    }
};