// lambda/metadata-extractor/index.ts
import { SQSEvent, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TextractClient, DetectDocumentTextCommand, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { RekognitionClient, DetectLabelsCommand, DetectTextCommand } from '@aws-sdk/client-rekognition';
import { SQSClient, DeleteMessageCommand } from '@aws-sdk/client-sqs';

// Initialize clients
const s3Client = new S3Client({});
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const textractClient = new TextractClient({});
const rekognitionClient = new RekognitionClient({});
const sqsClient = new SQSClient({});

// Environment variables
const BUCKET_NAME = process.env.BUCKET_NAME!;
const METADATA_TABLE = process.env.METADATA_TABLE!;
const QUEUE_URL = process.env.QUEUE_URL!;

// Content type categories
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/tiff', 'image/svg+xml'];
const DOCUMENT_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/csv', 'application/rtf', 'text/html'];
const SPREADSHEET_TYPES = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet', 'text/csv'];
const PRESENTATION_TYPES = ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation'];

/**
 * Extracts text from documents using Amazon Textract
 */
async function extractTextFromDocument(bucket: string, key: string): Promise<string[]> {
    try {
        // Detect document text
        const detectParams = {
            Document: {
                S3Object: {
                    Bucket: bucket,
                    Name: key,
                },
            },
        };

        const detectCommand = new DetectDocumentTextCommand(detectParams);
        const detectResponse = await textractClient.send(detectCommand);

        // Extract text blocks
        const textBlocks = detectResponse.Blocks?.filter(block => block.BlockType === 'LINE')
            .map(block => block.Text || '')
            .filter(text => text.length > 0) || [];

        return textBlocks;
    } catch (error) {
        console.error('Error extracting text with Textract:', error);
        return [];
    }
}

/**
 * Analyzes images using Amazon Rekognition
 */
async function analyzeImage(bucket: string, key: string): Promise<{labels: string[], textInImage: string[]}> {
    try {
        // Detect labels
        const labelParams = {
            Image: {
                S3Object: {
                    Bucket: bucket,
                    Name: key,
                },
            },
            MaxLabels: 20,
            MinConfidence: 70,
        };

        const labelCommand = new DetectLabelsCommand(labelParams);
        const labelResponse = await rekognitionClient.send(labelCommand);

        // Extract labels with high confidence
        const labels = labelResponse.Labels?.map(label => label.Name || '')
            .filter(name => name.length > 0) || [];

        // Detect text in images
        const textParams = {
            Image: {
                S3Object: {
                    Bucket: bucket,
                    Name: key,
                },
            },
        };

        const textCommand = new DetectTextCommand(textParams);
        const textResponse = await rekognitionClient.send(textCommand);

        // Extract detected text
        const textInImage = textResponse.TextDetections?.filter(text => text.Type === 'LINE')
            .map(text => text.DetectedText || '')
            .filter(text => text.length > 0) || [];

        return { labels, textInImage };
    } catch (error) {
        console.error('Error analyzing image with Rekognition:', error);
        return { labels: [], textInImage: [] };
    }
}

/**
 * Updates the file metadata in DynamoDB
 */
async function updateMetadata(fileId: string, metadata: any): Promise<void> {
    try {
        // Generate update expression and attribute values
        const updateExpressions: string[] = [];
        const expressionAttributeValues: Record<string, any> = {};
        const expressionAttributeNames: Record<string, string> = {};

        // Process each metadata field
        Object.entries(metadata).forEach(([key, value]) => {
            // Skip empty arrays or null/undefined values
            if (Array.isArray(value) && value.length === 0) return;
            if (value === null || value === undefined) return;

            const attrName = `#${key}`;
            const attrValue = `:${key}`;

            expressionAttributeNames[attrName] = key;
            expressionAttributeValues[attrValue] = value;
            updateExpressions.push(`${attrName} = ${attrValue}`);
        });

        // Skip update if no valid fields to update
        if (updateExpressions.length === 0) return;

        // Create the update expression
        const updateExpression = `SET ${updateExpressions.join(', ')}`;

        // Update the item in DynamoDB
        await ddbDocClient.send(new UpdateCommand({
            TableName: METADATA_TABLE,
            Key: { fileId },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
        }));

        console.log(`Updated metadata for file ${fileId}`);
    } catch (error) {
        console.error('Error updating metadata in DynamoDB:', error);
        throw error;
    }
}

/**
 * Processes message from SQS queue
 */
async function processMessage(message: any): Promise<void> {
    try {
        const { fileId, s3Key } = message;

        // Validate required fields
        if (!fileId || !s3Key) {
            console.error('Missing required fields in message:', message);
            return;
        }

        // Get object metadata from S3
        const headCommand = new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
        });

        const headResponse = await s3Client.send(headCommand);
        const contentType = headResponse.ContentType || '';

        // Initialize metadata object
        let extractedMetadata: any = {
            processingStatus: 'completed',
            processingTimestamp: new Date().toISOString(),
        };

        // Process based on content type
        if (IMAGE_TYPES.some(type => contentType.includes(type))) {
            // Process image file
            console.log(`Processing image file: ${s3Key}`);
            const imageAnalysis = await analyzeImage(BUCKET_NAME, s3Key);

            extractedMetadata.contentCategory = 'image';
            extractedMetadata.contentLabels = imageAnalysis.labels;
            extractedMetadata.textInImage = imageAnalysis.textInImage;

            // Generate content keywords for search
            const contentKeywords = [...imageAnalysis.labels, ...imageAnalysis.textInImage.slice(0, 10)];
            extractedMetadata.contentKeywords = Array.from(new Set(contentKeywords)).slice(0, 50);

        } else if (DOCUMENT_TYPES.some(type => contentType.includes(type))) {
            // Process document file
            console.log(`Processing document file: ${s3Key}`);
            const textBlocks = await extractTextFromDocument(BUCKET_NAME, s3Key);

            extractedMetadata.contentCategory = 'document';
            extractedMetadata.textContent = textBlocks.join(' ').slice(0, 1000); // Store first 1000 chars

            // Extract important entities (simplified implementation for Phase 2)
            const entities = extractEntities(textBlocks.join(' '));
            extractedMetadata.contentEntities = entities;

            // Generate content keywords for search
            // Get significant words from text for keywords
            const keywords = extractKeywords(textBlocks.join(' '), 50);
            extractedMetadata.contentKeywords = keywords;

        } else if (SPREADSHEET_TYPES.some(type => contentType.includes(type))) {
            // Basic categorization for spreadsheets (advanced parsing in Phase 3)
            extractedMetadata.contentCategory = 'spreadsheet';
            extractedMetadata.contentKeywords = ['spreadsheet', 'data', 'table'];

        } else if (PRESENTATION_TYPES.some(type => contentType.includes(type))) {
            // Basic categorization for presentations
            extractedMetadata.contentCategory = 'presentation';
            extractedMetadata.contentKeywords = ['presentation', 'slides'];

        } else {
            // Generic file - no special processing
            extractedMetadata.contentCategory = 'other';
            extractedMetadata.contentKeywords = [];
        }

        // Update metadata in DynamoDB
        await updateMetadata(fileId, extractedMetadata);

        console.log(`Successfully processed file ${fileId}`);
    } catch (error) {
        console.error('Error processing message:', error);
        throw error;
    }
}

/**
 * Simple entity extraction function (will be enhanced in Phase 3)
 */
function extractEntities(text: string): string[] {
    const entities: string[] = [];

    // Simplistic email detection
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = text.match(emailRegex) || [];
    entities.push(...emails);

    // Simplistic date detection
    const dateRegex = /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g;
    const dates = text.match(dateRegex) || [];
    entities.push(...dates);

    // Return unique entities
    return Array.from(new Set(entities)).slice(0, 20);
}

/**
 * Extract significant keywords from text (simplified implementation)
 */
function extractKeywords(text: string, maxKeywords: number): string[] {
    // Convert to lowercase and remove punctuation
    const cleanText = text.toLowerCase().replace(/[^\w\s]/g, ' ');

    // Split into words and remove short words
    const words = cleanText.split(/\s+/).filter(word => word.length > 3);

    // Count word frequency
    const wordCounts: Record<string, number> = {};
    words.forEach(word => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
    });

    // Sort by frequency
    const sortedWords = Object.entries(wordCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([word]) => word);

    // Filter common stop words (simplified list)
    const stopWords = ['this', 'that', 'these', 'those', 'then', 'than', 'they', 'them', 'their',
        'there', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'could',
        'should', 'about', 'after', 'before', 'because'];

    const filteredWords = sortedWords.filter(word => !stopWords.includes(word));

    // Return top keywords
    return filteredWords.slice(0, maxKeywords);
}

/**
 * Lambda handler for processing SQS messages
 */
export const handler = async (event: SQSEvent, context: Context): Promise<void> => {
    console.log(`Processing ${event.Records.length} messages`);

    // Process each message
    for (const record of event.Records) {
        try {
            // Parse message body
            const message = JSON.parse(record.body);

            // Process the message
            await processMessage(message);

            // Delete message from queue after successful processing
            await sqsClient.send(new DeleteMessageCommand({
                QueueUrl: QUEUE_URL,
                ReceiptHandle: record.receiptHandle,
            }));
        } catch (error) {
            console.error('Error processing record:', error);
            // Don't delete the message, let it go back to the queue for retry
            // Except in the case of malformed JSON or missing fields, which will never succeed
        }
    }
};