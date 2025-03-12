package com.cfm

import com.cfm.api.configureFileManagerApi
import com.cfm.metadata.MetadataExtractor
import com.cfm.metadata.MetadataService
import com.cfm.search.SearchService
import com.cfm.security.SecurityService
import com.cfm.storage.StorageService
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import kotlinx.serialization.json.Json
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.dynamodb.DynamoDbAsyncClient
import software.amazon.awssdk.services.rekognition.RekognitionAsyncClient
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.services.textract.TextractAsyncClient

/**
 * Main application entry point for local development
 */
fun main() {
    // Start the server
    embeddedServer(Netty, port = 8080, host = "0.0.0.0", module = Application::module)
        .start(wait = true)
}

/**
 * Application module configuration
 */
fun Application.module() {
    // Configure serialization
    install(ContentNegotiation) {
        json(Json {
            prettyPrint = true
            isLenient = true
            ignoreUnknownKeys = true
        })
    }

    // Initialize AWS clients
    val region = Region.of(System.getenv("AWS_REGION") ?: "us-east-1")
    val credentialsProvider = DefaultCredentialsProvider.create()

    val s3Client = S3AsyncClient.builder()
        .region(region)
        .credentialsProvider(credentialsProvider)
        .build()

    val dynamoDbClient = DynamoDbAsyncClient.builder()
        .region(region)
        .credentialsProvider(credentialsProvider)
        .build()

    val rekognitionClient = RekognitionAsyncClient.builder()
        .region(region)
        .credentialsProvider(credentialsProvider)
        .build()

    val textractClient = TextractAsyncClient.builder()
        .region(region)
        .credentialsProvider(credentialsProvider)
        .build()

    // Initialize services
    val bucketName = System.getenv("BUCKET_NAME") ?: "cfm-files-dev"
    val metadataTableName = System.getenv("METADATA_TABLE") ?: "cfm-metadata-dev"

    val storageService = StorageService(s3Client, bucketName)
    val metadataService = MetadataService(dynamoDbClient, metadataTableName)
    val metadataExtractor = MetadataExtractor(rekognitionClient, textractClient)
    val securityService = SecurityService()
    val searchService = SearchService(metadataService)

    // Configure API
    configureFileManagerApi(
        storageService = storageService,
        metadataService = metadataService,
        metadataExtractor = metadataExtractor,
        searchService = searchService,
        securityService = securityService
    )

    log.info("Cloud File Manager initialized and ready")
}