package com.cfm.infrastructure

import software.amazon.awssdk.services.s3.model.Bucket
import software.amazon.awssdk.services.s3.model.LifecycleRule


class CloudFileManagerStack(scope: Construct, id: String, props: StackProps? = null) : Stack(scope, id, props) {
    init {
        // Create S3 bucket for file storage
        val bucket = Bucket.Builder.create(this, "FileStorageBucket")
            .versioned(true)
            .encryption(BucketEncryption.S3_MANAGED)
            .lifecycleRules(listOf(
                LifecycleRule.builder()
                    .id("TransitionToIntelligentTiering")
                    .transitions(listOf(
                        Transition.builder()
                            .storageClass(StorageClass.INTELLIGENT_TIERING)
                            .transitionAfter(Duration.days(0))
                            .build()
                    ))
                    .build()
            ))
            .cors(listOf(
                CorsRule.builder()
                    .allowedMethods(listOf(
                        HttpMethods.GET,
                        HttpMethods.PUT,
                        HttpMethods.POST,
                        HttpMethods.DELETE,
                        HttpMethods.HEAD
                    ))
                    .allowedOrigins(listOf("*"))
                    .allowedHeaders(listOf("*"))
                    .build()
            ))
            .build()

        // Create DynamoDB table for metadata
        val metadataTable = Table.Builder.create(this, "FileMetadataTable")
            .partitionKey(Attribute.builder()
                .name("id")
                .type(AttributeType.STRING)
                .build())
            .billingMode(BillingMode.PAY_PER_REQUEST)
            .encryption(TableEncryption.AWS_MANAGED)
            .pointInTimeRecovery(true)
            .build()

        // Create a role for Lambda functions
        val lambdaRole = Role.Builder.create(this, "FileManagerLambdaRole")
            .assumedBy(ServicePrincipal("lambda.amazonaws.com"))
            .managedPolicies(listOf(
                ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
            ))
            .build()

        // Add S3 permissions
        bucket.grantReadWrite(lambdaRole)

        // Add DynamoDB permissions
        metadataTable.grantReadWriteData(lambdaRole)

        // Add Rekognition and Textract permissions
        lambdaRole.addToPolicy(PolicyStatement.Builder.create()
            .actions(listOf(
                "rekognition:DetectLabels",
                "rekognition:DetectText",
                "textract:AnalyzeDocument"
            ))
            .resources(listOf("*"))
            .build())

        // Create upload Lambda function
        val uploadFunction = Function.Builder.create(this, "UploadFunction")
            .runtime(Runtime.JAVA_11)
            .code(Code.fromAsset("build/libs/cloud-file-manager.jar"))
            .handler("com.cfm.lambda.UploadHandler")
            .memorySize(1024)
            .timeout(Duration.seconds(30))
            .environment(mapOf(
                "BUCKET_NAME" to bucket.getBucketName(),
                "METADATA_TABLE" to metadataTable.getTableName()
            ))
            .role(lambdaRole)
            .build()

        // Create metadata extraction Lambda function
        val extractionFunction = Function.Builder.create(this, "MetadataExtractionFunction")
            .runtime(Runtime.JAVA_11)
            .code(Code.fromAsset("build/libs/cloud-file-manager.jar"))
            .handler("com.cfm.lambda.MetadataExtractionHandler")
            .memorySize(2048)
            .timeout(Duration.minutes(5))
            .environment(mapOf(
                "BUCKET_NAME" to bucket.getBucketName(),
                "METADATA_TABLE" to metadataTable.getTableName()
            ))
            .role(lambdaRole)
            .build()

        // Create search Lambda function
        val searchFunction = Function.Builder.create(this, "SearchFunction")
            .runtime(Runtime.JAVA_11)
            .code(Code.fromAsset("build/libs/cloud-file-manager.jar"))
            .handler("com.cfm.lambda.SearchHandler")
            .memorySize(1024)
            .timeout(Duration.seconds(30))
            .environment(mapOf(
                "METADATA_TABLE" to metadataTable.getTableName()
            ))
            .role(lambdaRole)
            .build()

        // Create API Gateway
        val api = RestApi.Builder.create(this, "FileManagerApi")
            .restApiName("Cloud File Manager API")
            .description("API for Cloud File Manager")
            .endpointTypes(listOf(EndpointType.REGIONAL))
            .defaultCorsPreflightOptions(CorsOptions.builder()
                .allowOrigins(listOf("*"))
                .allowMethods(listOf("GET", "POST", "PUT", "DELETE"))
                .allowHeaders(listOf("Content-Type", "Authorization"))
                .build())
            .build()

        // Create API resources and methods
        val filesResource = api.getRoot().addResource("files")

        // POST /files (upload)
        filesResource.addMethod("POST", LambdaIntegration(uploadFunction))

        // GET /files/{id} (get metadata)
        val fileResource = filesResource.addResource("{id}")
        fileResource.addMethod("GET", LambdaIntegration(searchFunction))

        // GET /files/{id}/download (download file)
        val downloadResource = fileResource.addResource("download")
        downloadResource.addMethod("GET", LambdaIntegration(searchFunction))

        // DELETE /files/{id} (delete file)
        fileResource.addMethod("DELETE", LambdaIntegration(uploadFunction))

        // PUT /files/{id}/tags (update tags)
        val tagsResource = fileResource.addResource("tags")
        tagsResource.addMethod("PUT", LambdaIntegration(searchFunction))

        // GET /search (search files)
        val searchResource = api.getRoot().addResource("search")
        searchResource.addMethod("GET", LambdaIntegration(searchFunction))

        // Output values
        CfnOutput.Builder.create(this, "BucketName")
            .description("S3 Bucket Name")
            .value(bucket.getBucketName())
            .build()

        CfnOutput.Builder.create(this, "MetadataTableName")
            .description("DynamoDB Metadata Table Name")
            .value(metadataTable.getTableName())
            .build()

        CfnOutput.Builder.create(this, "ApiEndpoint")
            .description("API Gateway Endpoint")
            .value(api.getUrl())
            .build()
    }
}