// lambda/enhanced-search-handler/index.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

// Initialize clients
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// Environment variables
const METADATA_TABLE = process.env.METADATA_TABLE!;

// Search types
const SEARCH_TYPE = {
    BASIC: 'basic',
    CONTENT: 'content',
    ADVANCED: 'advanced',
};

interface SearchParams {
    userId: string;
    query?: string;
    fileType?: string;
    fileExtension?: string;
    contentCategory?: string;
    contentKeyword?: string;
    securityStatus?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    lastKey?: any;
}

/**
 * Perform content keyword search using GSI
 */
async function contentKeywordSearch(params: SearchParams): Promise<any> {
    const { userId, contentKeyword, limit = 50, lastKey } = params;

    if (!contentKeyword) {
        throw new Error('Content keyword is required for content search');
    }

    // Query the content keywords index
    const queryCommand = new QueryCommand({
        TableName: METADATA_TABLE,
        IndexName: 'contentKeywordsIndex',
        KeyConditionExpression: 'contentKeyword = :keyword',
        FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: {
            ':keyword': contentKeyword.toLowerCase(),
            ':userId': userId,
        },
        Limit: limit,
        ExclusiveStartKey: lastKey,
    });

    return ddbDocClient.send(queryCommand);
}

/**
 * Perform basic search by scanning the database with filters
 */
async function basicSearch(params: SearchParams): Promise<any> {
    const {
        userId, query, fileType, fileExtension, contentCategory,
        securityStatus, dateFrom, dateTo, limit = 50, lastKey
    } = params;

    // Build filter expressions
    let filterExpressions: string[] = ['userId = :userId'];
    let expressionAttributeValues: Record<string, any> = {
        ':userId': userId,
    };
    let expressionAttributeNames: Record<string, string> = {};

    // Add file name search if query provided
    if (query) {
        filterExpressions.push('contains(lower(fileName), :query)');
        expressionAttributeValues[':query'] = query.toLowerCase();
    }

    // Add file type filter if provided
    if (fileType) {
        filterExpressions.push('contains(fileType, :fileType)');
        expressionAttributeValues[':fileType'] = fileType.toLowerCase();
    }

    // Add file extension filter if provided
    if (fileExtension) {
        filterExpressions.push('fileExtension = :fileExtension');
        expressionAttributeValues[':fileExtension'] = fileExtension.toLowerCase();
    }

    // Add content category filter if provided
    if (contentCategory) {
        filterExpressions.push('contentCategory = :contentCategory');
        expressionAttributeValues[':contentCategory'] = contentCategory.toLowerCase();
    }

    // Add security status filter if provided
    if (securityStatus) {
        filterExpressions.push('securityStatus = :securityStatus');
        expressionAttributeValues[':securityStatus'] = securityStatus.toLowerCase();
    }

    // Add date range filters if provided
    if (dateFrom) {
        filterExpressions.push('uploadDate >= :dateFrom');
        expressionAttributeValues[':dateFrom'] = dateFrom;
    }

    if (dateTo) {
        filterExpressions.push('uploadDate <= :dateTo');
        expressionAttributeValues[':dateTo'] = dateTo;
    }

    // Build the filter expression string
    const filterExpression = filterExpressions.join(' AND ');

    // Scan with filters
    const scanCommand = new ScanCommand({
        TableName: METADATA_TABLE,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0
            ? expressionAttributeNames
            : undefined,
        Limit: limit,
        ExclusiveStartKey: lastKey,
    });

    return ddbDocClient.send(scanCommand);
}

/**
 * Perform advanced search with natural language parsing
 */
async function advancedSearch(params: SearchParams): Promise<any> {
    const { userId, query = '', limit = 50, lastKey } = params;

    // Parse natural language query (simplified implementation for Phase 2)
    const queryParts = parseNaturalLanguageQuery(query);

    // Build filter expressions
    let filterExpressions: string[] = ['userId = :userId'];
    let expressionAttributeValues: Record<string, any> = {
        ':userId': userId,
    };

    // Apply parsed query parts
    let expressionIndex = 0;
    for (const [field, operator, value] of queryParts) {
        const placeholder = `:val${expressionIndex}`;

        switch (operator) {
            case 'contains':
                filterExpressions.push(`contains(${field}, ${placeholder})`);
                expressionAttributeValues[placeholder] = value.toLowerCase();
                break;
            case 'equals':
                filterExpressions.push(`${field} = ${placeholder}`);
                expressionAttributeValues[placeholder] = value;
                break;
            case 'greater':
                filterExpressions.push(`${field} > ${placeholder}`);
                expressionAttributeValues[placeholder] = value;
                break;
            case 'less':
                filterExpressions.push(`${field} < ${placeholder}`);
                expressionAttributeValues[placeholder] = value;
                break;
            default:
                // Skip unknown operators
                continue;
        }

        expressionIndex++;
    }

    // Build the filter expression string
    const filterExpression = filterExpressions.join(' AND ');

    // Scan with filters
    const scanCommand = new ScanCommand({
        TableName: METADATA_TABLE,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit,
        ExclusiveStartKey: lastKey,
    });

    return ddbDocClient.send(scanCommand);
}

/**
 * Simple natural language query parser
 * This is a simplified implementation for Phase 2
 * Will be enhanced with ML-based parsing in Phase 3
 */
function parseNaturalLanguageQuery(query: string): Array<[string, string, string]> {
    const results: Array<[string, string, string]> = [];

    // Simple pattern matching for basic queries
    const typeMatch = query.match(/type(?:\s+is)?\s+([a-z]+)/i);
    if (typeMatch) {
        results.push(['contentCategory', 'equals', typeMatch[1].toLowerCase()]);
    }

    const dateMatch = query.match(/(?:from|after|since)\s+(\d{4}-\d{2}-\d{2})/i);
    if (dateMatch) {
        results.push(['uploadDate', 'greater', dateMatch[1]]);
    }

    const dateLessMatch = query.match(/(?:before|until)\s+(\d{4}-\d{2}-\d{2})/i);
    if (dateLessMatch) {
        results.push(['uploadDate', 'less', dateLessMatch[1]]);
    }

    const contentMatch = query.match(/(?:contains|about|with)\s+([a-z\s]+)/i);
    if (contentMatch) {
        results.push(['textContent', 'contains', contentMatch[1].trim()]);
    }

    // Add fallback for simple text queries
    if (results.length === 0 && query.trim().length > 0) {
        results.push(['fileName', 'contains', query.trim()]);
    }

    return results;
}

/**
 * Format search results
 */
function formatSearchResults(items: any[] = []): any[] {
    return items.map(item => ({
        fileId: item.fileId,
        fileName: item.fileName,
        fileType: item.fileType,
        fileSize: item.fileSize,
        fileExtension: item.fileExtension,
        uploadDate: item.uploadDate,
        contentCategory: item.contentCategory,
        securityStatus: item.securityStatus || 'unknown',
        // Include content summary if available
        contentSummary: getContentSummary(item),
    }));
}

/**
 * Generate content summary based on available metadata
 */
function getContentSummary(item: any): string {
    if (!item) return '';

    if (item.contentCategory === 'image' && item.contentLabels?.length > 0) {
        return `Image: ${item.contentLabels.slice(0, 5).join(', ')}`;
    }

    if (item.contentCategory === 'document' && item.textContent) {
        return `Text: ${item.textContent.substring(0, 100)}...`;
    }

    if (item.contentEntities?.length > 0) {
        return `Contains: ${item.contentEntities.slice(0, 3).join(', ')}`;
    }

    return '';
}

/**
 * Parse query parameters from API Gateway event
 */
function parseQueryParameters(event: APIGatewayProxyEvent): SearchParams {
    const params = event.queryStringParameters || {};

    return {
        userId: params.userId!,
        query: params.q,
        fileType: params.fileType,
        fileExtension: params.fileExtension,
        contentCategory: params.category,
        contentKeyword: params.keyword,
        securityStatus: params.security,
        dateFrom: params.from,
        dateTo: params.to,
        limit: params.limit ? parseInt(params.limit) : 50,
        lastKey: params.lastKey ? JSON.parse(params.lastKey) : undefined,
    };
}

/**
 * Lambda handler for enhanced search
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const searchParams = parseQueryParameters(event);
        const searchType = event.queryStringParameters?.searchType || SEARCH_TYPE.BASIC;

        // Validate required parameters
        if (!searchParams.userId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'userId is required as a query parameter' }),
            };
        }

        // Choose search strategy based on search type
        let searchResult;

        switch (searchType) {
            case SEARCH_TYPE.CONTENT:
                searchResult = await contentKeywordSearch(searchParams);
                break;
            case SEARCH_TYPE.ADVANCED:
                searchResult = await advancedSearch(searchParams);
                break;
            case SEARCH_TYPE.BASIC:
            default:
                searchResult = await basicSearch(searchParams);
                break;
        }

        // Format the response
        const files = formatSearchResults(searchResult.Items);

        // Return the search results
        return {
            statusCode: 200,
            body: JSON.stringify({
                query: searchParams.query || '',
                searchType,
                filters: {
                    fileType: searchParams.fileType,
                    fileExtension: searchParams.fileExtension,
                    contentCategory: searchParams.contentCategory,
                    contentKeyword: searchParams.contentKeyword,
                    securityStatus: searchParams.securityStatus,
                    dateRange: {
                        from: searchParams.dateFrom,
                        to: searchParams.dateTo,
                    },
                },
                results: {
                    count: files.length,
                    files,
                    lastEvaluatedKey: searchResult.LastEvaluatedKey
                        ? JSON.stringify(searchResult.LastEvaluatedKey)
                        : null,
                    hasMore: !!searchResult.LastEvaluatedKey,
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