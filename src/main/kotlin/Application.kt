package com.cfm

import com.cfm.api.configureFileManagerApi
import com.cfm.api.configureWebInterface
import com.cfm.metadata.MetadataExtractor
import com.cfm.metadata.MetadataService
import com.cfm.search.SearchService
import com.cfm.security.SecurityService
import com.cfm.storage.StorageService
import com.cfm.utils.ConfigUtils
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.cors.routing.*
import kotlinx.serialization.json.Json
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

    // Configure CORS
    install(CORS) {
        anyHost()
        allowMethod(io.ktor.http.HttpMethod.Options)
        allowMethod(io.ktor.http.HttpMethod.Get)
        allowMethod(io.ktor.http.HttpMethod.Post)
        allowMethod(io.ktor.http.HttpMethod.Put)
        allowMethod(io.ktor.http.HttpMethod.Delete)
        allowHeader("Authorization")
        allowHeader("Content-Type")
        allowNonSimpleContentTypes = true
    }

    // Initialize AWS clients
    val region = ConfigUtils.getAwsRegion()
    val credentialsProvider = ConfigUtils.getCredentialsProvider()

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
    val bucketName = ConfigUtils.getBucketName()
    val metadataTableName = ConfigUtils.getMetadataTableName()

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

    // Configure Web Interface
    if (ConfigUtils.isLocalDevelopment()) {
        configureWebInterface()
    }

    log.info("Cloud File Manager initialized and ready")
}