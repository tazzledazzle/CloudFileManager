// lambda/analytics-api-handler/index.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// Initialize clients
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// Environment variables
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE!;

/**
 * Parse query parameters from API Gateway event
 */
function parseQueryParameters(event: APIGatewayProxyEvent) {
    const params = event.queryStringParameters || {};

    return {
        userId: params.userId,
        period: params.period || 'monthly',
        date: params.date,
    };
}

/**
 * Get analytics by ID (combination of userId, period, and date)
 */
async function getAnalyticsById(analyticsId: string) {
    const command = new GetCommand({
        TableName: ANALYTICS_TABLE,
        Key: { analyticsId },
    });

    const response = await ddbDocClient.send(command);
    return response.Item;
}

/**
 * Query analytics by userId and period
 */
async function queryAnalyticsByUserAndPeriod(userId: string, period: string, dateKey?: string) {
    // Build query parameters
    const queryParams: any = {
        TableName: ANALYTICS_TABLE,
        IndexName: 'userPeriodIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
            ':userId': userId,
        },
        ScanIndexForward: false, // Sort in descending order (newest first)
        Limit: 1, // Get only the most recent
    };

    // Add period filter if specified
    if (period) {
        queryParams.KeyConditionExpression += ' AND begins_with(dateKey, :periodPrefix)';
        queryParams.ExpressionAttributeValues[':periodPrefix'] = `${period}#`;
    }

    // Add specific date if provided
    if (dateKey) {
        queryParams.KeyConditionExpression = 'userId = :userId AND dateKey = :dateKey';
        queryParams.ExpressionAttributeValues[':dateKey'] = dateKey;
    }

    const command = new QueryCommand(queryParams);
    const response = await ddbDocClient.send(command);

    return response.Items && response.Items.length > 0 ? response.Items[0] : null;
}

/**
 * Get analytics by parameters
 */
async function getAnalytics(userId: string, period: string, date?: string) {
    try {
        let analyticsData;

        if (date) {
            // If exact date is provided, construct the analyticsId
            const analyticsId = `${userId}#${period}#${date}`;
            analyticsData = await getAnalyticsById(analyticsId);
        } else {
            // Otherwise, query by userId and period to get most recent
            analyticsData = await queryAnalyticsByUserAndPeriod(userId, period);
        }

        if (!analyticsData) {
            // If no data for requested period/date, fall back to total
            if (period !== 'total') {
                console.log(`No ${period} analytics found for user ${userId}, falling back to total`);
                return getAnalytics(userId, 'total');
            }
            return null;
        }

        return analyticsData;
    } catch (error) {
        console.error('Error getting analytics:', error);
        throw error;
    }
}

/**
 * Create a trend report comparing current period with previous
 */
async function createTrendReport(userId: string, period: string, date?: string) {
    try {
        // Get current period data
        const currentData = await getAnalytics(userId, period, date);
        if (!currentData) {
            return null;
        }

        // For trends, we only care about daily, weekly, and monthly periods
        if (period === 'total') {
            return null;
        }

        // Determine previous period date
        let previousDate;
        const currentDateKey = currentData.dateKey;

        if (period === 'daily') {
            // Previous day
            const currentDate = new Date(currentDateKey);
            currentDate.setDate(currentDate.getDate() - 1);
            previousDate = currentDate.toISOString().split('T')[0];
        } else if (period === 'weekly') {
            // Previous week
            const currentDate = new Date(currentDateKey);
            currentDate.setDate(currentDate.getDate() - 7);
            previousDate = currentDate.toISOString().split('T')[0];
        } else if (period === 'monthly') {
            // Previous month
            const [year, month] = currentDateKey.split('-');
            const prevMonth = parseInt(month) - 1;
            if (prevMonth === 0) {
                previousDate = `${parseInt(year) - 1}-12`;
            } else {
                previousDate = `${year}-${prevMonth.toString().padStart(2, '0')}`;
            }
        }

        // Get previous period data
        const previousData = await getAnalytics(userId, period, previousDate);
        if (!previousData) {
            return null;
        }

        // Calculate trends
        const currentStats = currentData.stats;
        const previousStats = previousData.stats;

        const trend = {
            fileCount: {
                current: currentStats.fileCount,
                previous: previousStats.fileCount,
                change: calculatePercentageChange(currentStats.fileCount, previousStats.fileCount),
            },
            totalSize: {
                current: currentStats.totalSize,
                previous: previousStats.totalSize,
                change: calculatePercentageChange(currentStats.totalSize, previousStats.totalSize),
            },
            fileTypesDiversity: {
                current: Object.keys(currentStats.fileTypes).length,
                previous: Object.keys(previousStats.fileTypes).length,
                change: calculatePercentageChange(
                    Object.keys(currentStats.fileTypes).length,
                    Object.keys(previousStats.fileTypes).length
                ),
            },
            documentTypesDiversity: {
                current: Object.keys(currentStats.documentTypes).length,
                previous: Object.keys(previousStats.documentTypes).length,
                change: calculatePercentageChange(
                    Object.keys(currentStats.documentTypes).length,
                    Object.keys(previousStats.documentTypes).length
                ),
            },
        };

        return trend;
    } catch (error) {
        console.error('Error creating trend report:', error);
        return null;
    }
}

/**
 * Calculate percentage change between two values
 */
function calculatePercentageChange(current: number, previous: number): number {
    if (previous === 0) {
        return current === 0 ? 0 : 100;
    }

    return Number(((current - previous) / previous * 100).toFixed(1));
}

/**
 * Lambda handler for the analytics API
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const { userId, period, date } = parseQueryParameters(event);

        // Validate required parameters
        if (!userId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'userId is required as a query parameter' }),
            };
        }

        // Get analytics data
        const analyticsData = await getAnalytics(userId, period, date);

        if (!analyticsData) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'No analytics data found for the specified parameters' }),
            };
        }

        // Generate trend report for comparison with previous period
        const trendReport = await createTrendReport(userId, period, date);

        // Return analytics data
        return {
            statusCode: 200,
            body: JSON.stringify({
                userId,
                period,
                date: date || analyticsData.dateKey,
                stats: analyticsData.stats,
                insights: analyticsData.insights,
                trend: trendReport,
                generatedAt: analyticsData.generatedAt,
            }),
        };
    } catch (error) {
        console.error('Error in analytics API:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error retrieving analytics data',
                error: (error as Error).message,
            }),
        };
    }
};