// lib/phase2-updates.ts
// These additions should be integrated into the main cfm-stack.ts file

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';

// This function adds the Phase 2 components to the existing CloudFileManagerStack
export function addPhase2Components(stack: cdk.Stack, props: {
    fileStorageBucket: s3.Bucket,
    metadataTable: dynamodb.Table,
    api: apigateway.RestApi,
}) {
    const { fileStorageBucket, metadataTable, api } = props;

    // Create SQS queue for metadata extraction
    const metadataProcessingQueue = new sqs.Queue(stack, 'MetadataProcessingQueue', {
        visibilityTimeout: cdk.Duration.minutes(5),
        retentionPeriod: cdk.Duration.days(14),
        deadLetterQueue: {
            queue: new sqs.Queue(stack, 'MetadataProcessingDLQ', {
                retentionPeriod: cdk.Duration.days(14),
            }),
            maxReceiveCount: 3,
        },
    });

    // Create SNS topic for security notifications
    const securityNotificationTopic = new sns.Topic(stack, 'SecurityNotificationTopic', {
        displayName: 'CFM Security Notifications',
    });

    // Lambda layer for ClamAV
    const clamavLayer = new lambda.LayerVersion(stack, 'ClamavLayer', {
        code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/clamav-layer')),
        description: 'ClamAV antivirus engine',
        compatibleRuntimes: [lambda.Runtime.NODEJS_18_X, lambda.Runtime.PYTHON_3_13],
    });

    // Virus Scanner Lambda
    const virusScanner = new nodejs.NodejsFunction(stack, 'VirusScanner', {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, '../lambda/virus-scanner/index.ts'),
        handler: 'handler',
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        environment: {
            BUCKET_NAME: fileStorageBucket.bucketName,
            METADATA_TABLE: metadataTable.tableName,
            PROCESSING_QUEUE_URL: metadataProcessingQueue.queueUrl,
            NOTIFICATION_TOPIC_ARN: securityNotificationTopic.topicArn,
            QUARANTINE_PREFIX: 'quarantine/',
        },
        layers: [clamavLayer],
    });

    // Add S3 event trigger for the virus scanner
    virusScanner.addEventSource(new lambdaEventSources.S3EventSource(fileStorageBucket, {
        events: [s3.EventType.OBJECT_CREATED],
        filters: [
            {
                prefix: 'users/',  // Only scan user uploads
                suffix: '',        // All files
            },
        ],
    }));

    // Metadata Extractor Lambda
    const metadataExtractor = new nodejs.NodejsFunction(stack, 'MetadataExtractor', {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, '../lambda/metadata-extractor/index.ts'),
        handler: 'handler',
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        environment: {
            BUCKET_NAME: fileStorageBucket.bucketName,
            METADATA_TABLE: metadataTable.tableName,
            QUEUE_URL: metadataProcessingQueue.queueUrl,
        },
    });

    // Add SQS event source for metadata extractor
    metadataExtractor.addEventSource(new lambdaEventSources.SqsEventSource(metadataProcessingQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(30),
    }));

    // Enhanced Search Lambda
    const enhancedSearchHandler = new nodejs.NodejsFunction(stack, 'EnhancedSearchHandler', {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, '../lambda/enhanced-search-handler/index.ts'),
        handler: 'handler',
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        environment: {
            METADATA_TABLE: metadataTable.tableName,
        },
    });

    // Replace the old search endpoint with the enhanced one
    const searchResource = api.root.getResource('nl-search') || api.root.addResource('nl-search');
    searchResource.addMethod('GET', new apigateway.LambdaIntegration(enhancedSearchHandler), {
        // Override existing method
    });

    // // Daily virus definition update Lambda
    const virusDefinitionUpdater = new nodejs.NodejsFunction(stack, 'VirusDefinitionUpdater', {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, '../lambda/virus-definition-updater/index.ts'),
        handler: 'handler',
        timeout: cdk.Duration.minutes(10),
        memorySize: 1024,
        environment: {
            VIRUS_DEFS_BUCKET: fileStorageBucket.bucketName,
            VIRUS_DEFS_PREFIX: 'virus-definitions/',
        },
        layers: [clamavLayer],
    });

    // Schedule the virus definition updater to run daily
    const rule = new events.Rule(stack, 'DailyVirusDefUpdateRule', {
        schedule: events.Schedule.cron({ minute: '0', hour: '0' }), // Run at midnight UTC
    });
    rule.addTarget(new targets.LambdaFunction(virusDefinitionUpdater));

    // Add permissions
    fileStorageBucket.grantRead(virusScanner);
    fileStorageBucket.grantWrite(virusScanner);
    fileStorageBucket.grantRead(metadataExtractor);
    metadataTable.grantReadWriteData(virusScanner);
    metadataTable.grantReadWriteData(metadataExtractor);
    metadataTable.grantReadData(enhancedSearchHandler);
    securityNotificationTopic.grantPublish(virusScanner);

    // Grant permissions to ML services
    virusScanner.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            's3:PutObjectAcl',
            's3:PutObjectTagging',
        ],
        resources: [fileStorageBucket.arnForObjects('*')],
    }));

    metadataExtractor.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            'rekognition:DetectLabels',
            'rekognition:DetectText',
            'textract:DetectDocumentText',
            'textract:AnalyzeDocument',
        ],
        resources: ['*'], // Rekognition and Textract don't support resource-level permissions
    }));

    // Export the queue URL and topic ARN
    new cdk.CfnOutput(stack, 'MetadataProcessingQueueUrl', {
        value: metadataProcessingQueue.queueUrl,
        description: 'URL of the SQS queue for metadata processing',
    });

    new cdk.CfnOutput(stack, 'SecurityNotificationTopicArn', {
        value: securityNotificationTopic.topicArn,
        description: 'ARN of the SNS topic for security notifications',
    });

    return {
        metadataProcessingQueue,
        securityNotificationTopic,
        virusScanner,
        metadataExtractor,
        enhancedSearchHandler,
    };
}