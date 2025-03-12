package com.cfm.lambda

import com.amazonaws.services.lambda.runtime.Context
import com.amazonaws.services.lambda.runtime.RequestHandler
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent
import com.amazonaws.services.lambda.runtime.events.S3Event
import com.cfm.metadata.MetadataExtractor
import com.cfm.metadata.MetadataService
import com.cfm.model.FileModel
import com.cfm.search.SearchFilters
import com.cfm.search.SearchService
import com.cfm.security.SecurityService
import com.cfm.storage.StorageService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import software.amazon.awssdk.auth.credentials.EnvironmentVariableCredentialsProvider
import software.amazon.awssdk.core.SdkBytes
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.dynamodb.DynamoDbAsyncClient
import software.amazon.awssdk.services.rekognition.RekognitionAsyncClient
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.textract.TextractAsyncClient
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.*
import kotlin.text.Charsets.UTF_8

/**
 * AWS Lambda handler for file uploads and deletions
 */
class UploadHandler : RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    private val s3Client: S3AsyncClient = S3AsyncClient.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val dynamoDbClient: DynamoDbAsyncClient = DynamoDbAsyncClient.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val rekognitionClient: RekognitionAsyncClient = RekognitionAsyncClient.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val textractClient: TextractAsyncClient = TextractAsyncClient.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val bucketName = System.getenv("BUCKET_NAME")
    private val metadataTableName = System.getenv("METADATA_TABLE")

    private val storageService = StorageService(s3Client, bucketName)
    private val metadataService = MetadataService(dynamoDbClient, metadataTableName)
    private val metadataExtractor = MetadataExtractor(rekognitionClient, textractClient)
    private val securityService = SecurityService()

    override fun handleRequest(
        input: APIGatewayProxyRequestEvent,
        context: Context
    ): APIGatewayProxyResponseEvent {
        val logger = context.logger
        logger.log("Input: $input")

        return when (input.httpMethod) {
            "POST" -> handleUpload(input)
            "DELETE" -> handleDelete(input)
            else -> APIGatewayProxyResponseEvent()
                .withStatusCode(405)
                .withBody(json.encodeToString(mapOf("error" to "Method not allowed")))
        }
    }

    private fun handleUpload(input: APIGatewayProxyRequestEvent): APIGatewayProxyResponseEvent {
        return runBlocking {
            try {
                // Verify content type is multipart/form-data
                val contentType = input.headers["Content-Type"] ?: ""
                if (!contentType.startsWith("multipart/form-data")) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(400)
                        .withBody(json.encodeToString(
                            mapOf("error" to "Content type must be multipart/form-data")
                        ))
                }

                // Parse multipart request (simplified for example)
                val body = input.body ?: ""
                val boundary = contentType.split("boundary=")[1]
                val parts = body.split("--$boundary")

                var fileName = ""
                var mimeType = ""
                var fileContent: ByteArray? = null
                val tags = mutableListOf<String>()

                // Parse each part
                for (part in parts) {
                    if (part.contains("filename=")) {
                        // This is a file part
                        val filenameMatch = Regex("filename=\"(.+?)\"").find(part)
                        fileName = filenameMatch?.groupValues?.getOrNull(1) ?: "unknown"

                        val contentTypeMatch = Regex("Content-Type: (.+?)\\r\\n").find(part)
                        mimeType = contentTypeMatch?.groupValues?.getOrNull(1) ?: "application/octet-stream"

                        // Extract file content (simplified)
                        val contentIndex = part.indexOf("\r\n\r\n") + 4
                        if (contentIndex > 3 && contentIndex < part.length) {
                            fileContent = part.substring(contentIndex).toByteArray(UTF_8)
                        }
                    } else if (part.contains("name=\"tags\"")) {
                        // This is a tags part
                        val contentIndex = part.indexOf("\r\n\r\n") + 4
                        if (contentIndex > 3 && contentIndex < part.length) {
                            val tagsValue = part.substring(contentIndex).trim()
                            tags.addAll(tagsValue.split(",").map { it.trim() })
                        }
                    }
                }

                if (fileContent == null) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(400)
                        .withBody(json.encodeToString(mapOf("error" to "No file uploaded")))
                }

                // Validate the file
                val validationResult = securityService.validateFile(
                    fileName = fileName,
                    fileSize = fileContent!!.size.toLong(),
                    mimeType = mimeType
                )

                if (!validationResult.isValid) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(400)
                        .withBody(json.encodeToString(mapOf("error" to validationResult.message)))
                }

                // Scan for viruses
                val scanResult = securityService.scanFile(ByteBuffer.wrap(fileContent!!))
                if (!scanResult.isClean) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(400)
                        .withBody(json.encodeToString(
                            mapOf("error" to "File contains malicious content: ${scanResult.message}")
                        ))
                }

                // Upload to S3
                val (objectKey, versionId) = storageService.uploadFile(
                    fileName = fileName,
                    contentType = mimeType,
                    inputStream = ByteArrayInputStream(fileContent!!),
                    metadata = mapOf("uploadedBy" to "lambda", "fileSize" to fileContent!!.size.toString())
                )

                // Extract metadata
                val metadata = metadataExtractor.extractMetadata(
                    fileBytes = ByteBuffer.wrap(fileContent!!),
                    mimeType = mimeType,
                    fileName = fileName
                )

                // Create file model
                val fileModel = FileModel(
                    id = UUID.randomUUID().toString(),
                    name = fileName,
                    size = fileContent!!.size.toLong(),
                    mimeType = mimeType,
                    path = objectKey,
                    metadata = metadata,
                    tags = tags
                )

                // Save metadata to DynamoDB
                val fileId = metadataService.saveMetadata(fileModel)

                // Generate a presigned URL for immediate access
                val presignedUrl = storageService.generatePresignedUrl(objectKey)

                APIGatewayProxyResponseEvent()
                    .withStatusCode(201)
                    .withBody(json.encodeToString(
                        mapOf(
                            "fileId" to fileId,
                            "objectKey" to objectKey,
                            "versionId" to versionId,
                            "url" to presignedUrl
                        )
                    ))

            } catch (e: Exception) {
                e.printStackTrace()

                APIGatewayProxyResponseEvent()
                    .withStatusCode(500)
                    .withBody(json.encodeToString(
                        mapOf("error" to "Internal server error: ${e.message}")
                    ))
            }
        }
    }

    private fun handleDelete(input: APIGatewayProxyRequestEvent): APIGatewayProxyResponseEvent {
        return runBlocking {
            try {
                val fileId = input.pathParameters["id"]
                if (fileId.isNullOrEmpty()) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(400)
                        .withBody(json.encodeToString(mapOf("error" to "Missing file ID")))
                }

                val fileModel = metadataService.getMetadata(fileId)
                if (fileModel == null) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(404)
                        .withBody(json.encodeToString(mapOf("error" to "File not found")))
                }

                // Delete from S3
                val deleted = storageService.deleteFile(fileModel.path)

                // Delete metadata from DynamoDB
                metadataService.deleteMetadata(fileId)

                APIGatewayProxyResponseEvent()
                    .withStatusCode(200)
                    .withBody(json.encodeToString(mapOf("deleted" to deleted)))

            } catch (e: Exception) {
                APIGatewayProxyResponseEvent()
                    .withStatusCode(500)
                    .withBody(json.encodeToString(
                        mapOf("error" to "Internal server error: ${e.message}")
                    ))
            }
        }
    }
}

/**
 * AWS Lambda handler for metadata extraction triggered by S3 events
 */
class MetadataExtractionHandler : RequestHandler<S3Event, String> {

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    private val s3Client = S3Client.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val dynamoDbClient: DynamoDbAsyncClient = DynamoDbAsyncClient.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val rekognitionClient: RekognitionAsyncClient = RekognitionAsyncClient.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val textractClient: TextractAsyncClient = TextractAsyncClient.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val metadataTableName = System.getenv("METADATA_TABLE")

    private val metadataService = MetadataService(dynamoDbClient, metadataTableName)
    private val metadataExtractor = MetadataExtractor(rekognitionClient, textractClient)

    override fun handleRequest(input: S3Event, context: Context): String {
        val logger = context.logger
        logger.log("Processing S3 event: $input")

        return runBlocking {
            try {
                for (record in input.records) {
                    val bucketName = record.s3.bucket.name
                    val objectKey = record.s3.`object`.urlDecodedKey

                    logger.log("Processing file: $bucketName/$objectKey")

                    // Get the file from S3
                    val s3Object = s3Client.getObject(
                        GetObjectRequest.builder()
                            .bucket(bucketName)
                            .key(objectKey)
                            .build()
                    )

                    // Read the file into memory
                    val outputStream = ByteArrayOutputStream()
                    s3Object.use { input ->
                        input.transferTo(outputStream)
                    }
                    val fileContent = outputStream.toByteArray()

                    // Get the content type
                    val mimeType = s3Object.response().contentType()

                    // Extract file name from object key
                    val fileName = objectKey.substringAfterLast("/")

                    // Extract metadata
                    val metadata = metadataExtractor.extractMetadata(
                        fileBytes = ByteBuffer.wrap(fileContent),
                        mimeType = mimeType,
                        fileName = fileName
                    )

                    // Find the file in DynamoDB by path
                    val files = metadataService.searchFiles(objectKey, listOf(), listOf())
                    val fileModel = files.firstOrNull { it.path == objectKey }

                    if (fileModel != null) {
                        // Update the metadata
                        metadataService.updateMetadata(fileModel.id, metadata)
                        logger.log("Updated metadata for file: ${fileModel.id}")
                    } else {
                        logger.log("File not found in metadata database: $objectKey")
                    }
                }

                "Processed ${input.records.size} files"
            } catch (e: Exception) {
                logger.log("Error processing S3 event: ${e.message}")
                e.printStackTrace()
                "Error: ${e.message}"
            }
        }
    }
}

/**
 * AWS Lambda handler for search and metadata operations
 */
class SearchHandler : RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    private val s3Client: S3AsyncClient = S3AsyncClient.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val dynamoDbClient: DynamoDbAsyncClient = DynamoDbAsyncClient.builder()
        .region(Region.of(System.getenv("AWS_REGION") ?: "us-east-1"))
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .build()

    private val bucketName = System.getenv("BUCKET_NAME")
    private val metadataTableName = System.getenv("METADATA_TABLE")

    private val storageService = StorageService(s3Client, bucketName)
    private val metadataService = MetadataService(dynamoDbClient, metadataTableName)
    private val searchService = SearchService(metadataService)

    override fun handleRequest(
        input: APIGatewayProxyRequestEvent,
        context: Context
    ): APIGatewayProxyResponseEvent {
        val logger = context.logger
        logger.log("Input: $input")

        return when {
            input.resource == "/search" && input.httpMethod == "GET" -> handleSearch(input)
            input.resource == "/files/{id}" && input.httpMethod == "GET" -> handleGetMetadata(input)
            input.resource == "/files/{id}/download" && input.httpMethod == "GET" -> handleDownload(input)
            input.resource == "/files/{id}/tags" && input.httpMethod == "PUT" -> handleUpdateTags(input)
            else -> APIGatewayProxyResponseEvent()
                .withStatusCode(405)
                .withBody(json.encodeToString(mapOf("error" to "Method not allowed")))
        }
    }

    private fun handleSearch(input: APIGatewayProxyRequestEvent): APIGatewayProxyResponseEvent {
        return runBlocking {
            try {
                val queryParams = input.queryStringParameters ?: mapOf()
                val query = queryParams["q"] ?: ""
                val tags = queryParams["tags"]?.split(",") ?: emptyList()
                val mimeTypes = queryParams["types"]?.split(",") ?: emptyList()
                val categories = queryParams["categories"]?.split(",") ?: emptyList()

                // Parse date filters
                val uploadedAfter = queryParams["after"]?.let {
                    try {
                        Date(it.toLong())
                    } catch (e: Exception) {
                        null
                    }
                }

                val uploadedBefore = queryParams["before"]?.let {
                    try {
                        Date(it.toLong())
                    } catch (e: Exception) {
                        null
                    }
                }

                // Parse size filters
                val minSize = queryParams["minSize"]?.toLongOrNull()
                val maxSize = queryParams["maxSize"]?.toLongOrNull()

                // Create search filters
                val filters = SearchFilters(
                    tags = tags,
                    categories = categories,
                    mimeTypes = mimeTypes,
                    uploadedAfter = uploadedAfter,
                    uploadedBefore = uploadedBefore,
                    minSize = minSize,
                    maxSize = maxSize
                )

                // Perform the search
                val results = searchService.searchFiles(query, filters)

                APIGatewayProxyResponseEvent()
                    .withStatusCode(200)
                    .withBody(json.encodeToString(results))

            } catch (e: Exception) {
                APIGatewayProxyResponseEvent()
                    .withStatusCode(500)
                    .withBody(json.encodeToString(
                        mapOf("error" to "Internal server error: ${e.message}")
                    ))
            }
        }
    }

    private fun handleGetMetadata(input: APIGatewayProxyRequestEvent): APIGatewayProxyResponseEvent {
        return runBlocking {
            try {
                val fileId = input.pathParameters["id"]
                if (fileId.isNullOrEmpty()) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(400)
                        .withBody(json.encodeToString(mapOf("error" to "Missing file ID")))
                }

                val fileModel = metadataService.getMetadata(fileId)
                if (fileModel == null) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(404)
                        .withBody(json.encodeToString(mapOf("error" to "File not found")))
                }

                APIGatewayProxyResponseEvent()
                    .withStatusCode(200)
                    .withBody(json.encodeToString(fileModel))

            } catch (e: Exception) {
                APIGatewayProxyResponseEvent()
                    .withStatusCode(500)
                    .withBody(json.encodeToString(
                        mapOf("error" to "Internal server error: ${e.message}")
                    ))
            }
        }
    }

    private fun handleDownload(input: APIGatewayProxyRequestEvent): APIGatewayProxyResponseEvent {
        return runBlocking {
            try {
                val fileId = input.pathParameters["id"]
                if (fileId.isNullOrEmpty()) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(400)
                        .withBody(json.encodeToString(mapOf("error" to "Missing file ID")))
                }

                val fileModel = metadataService.getMetadata(fileId)
                if (fileModel == null) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(404)
                        .withBody(json.encodeToString(mapOf("error" to "File not found")))
                }

                // Generate a presigned URL for download
                val presignedUrl = storageService.generatePresignedUrl(fileModel.path)

                // Return a redirect response
                val response = APIGatewayProxyResponseEvent()
                    .withStatusCode(302)
                    .withHeaders(mapOf("Location" to presignedUrl))

                response

            } catch (e: Exception) {
                APIGatewayProxyResponseEvent()
                    .withStatusCode(500)
                    .withBody(json.encodeToString(
                        mapOf("error" to "Internal server error: ${e.message}")
                    ))
            }
        }
    }

    private fun handleUpdateTags(input: APIGatewayProxyRequestEvent): APIGatewayProxyResponseEvent {
        return runBlocking {
            try {
                val fileId = input.pathParameters["id"]
                if (fileId.isNullOrEmpty()) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(400)
                        .withBody(json.encodeToString(mapOf("error" to "Missing file ID")))
                }

                val fileModel = metadataService.getMetadata(fileId)
                if (fileModel == null) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(404)
                        .withBody(json.encodeToString(mapOf("error" to "File not found")))
                }

                val requestBody = json.decodeFromString<Map<String, List<String>>>(input.body ?: "{}")
                val tags = requestBody["tags"]
                if (tags == null) {
                    return@runBlocking APIGatewayProxyResponseEvent()
                        .withStatusCode(400)
                        .withBody(json.encodeToString(mapOf("error" to "Missing tags")))
                }

                metadataService.updateTags(fileId, tags)

                APIGatewayProxyResponseEvent()
                    .withStatusCode(200)
                    .withBody(json.encodeToString(mapOf("updated" to true)))

            } catch (e: Exception) {
                APIGatewayProxyResponseEvent()
                    .withStatusCode(500)
                    .withBody(json.encodeToString(
                        mapOf("error" to "Internal server error: ${e.message}")
                    ))
            }
        }
    }
}