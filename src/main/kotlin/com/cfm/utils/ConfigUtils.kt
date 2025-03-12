package com.cfm.utils

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.regions.Region
import java.util.*

/**
 * Configuration utilities for the Cloud File Manager
 */
object ConfigUtils {

    /**
     * Gets a configuration value from an environment variable,
     * with an optional default value
     *
     * @param key The environment variable name
     * @param defaultValue The default value to use if not found
     * @return The configuration value
     */
    fun getConfig(key: String, defaultValue: String? = null): String? {
        return System.getenv(key) ?: defaultValue
    }

    /**
     * Gets the AWS region to use
     *
     * @return The configured AWS region
     */
    fun getAwsRegion(): Region {
        val regionName = getConfig("AWS_REGION", "us-east-1")
        return Region.of(regionName)
    }

    /**
     * Creates an AWS credentials provider
     *
     * @return An AWS credentials provider
     */
    fun getCredentialsProvider(): AwsCredentialsProvider {
        val accessKey = getConfig("AWS_ACCESS_KEY_ID")
        val secretKey = getConfig("AWS_SECRET_ACCESS_KEY")

        return if (accessKey != null && secretKey != null) {
            // Use provided credentials if available
            StaticCredentialsProvider.create(
                AwsBasicCredentials.create(accessKey, secretKey)
            )
        } else {
            // Fall back to default credential provider chain
            DefaultCredentialsProvider.create()
        }
    }

    /**
     * Gets the S3 bucket name
     *
     * @return The configured S3 bucket name
     */
    fun getBucketName(): String {
        return getConfig("BUCKET_NAME", "cfm-files-${getEnvironment()}")!!
    }

    /**
     * Gets the DynamoDB table name
     *
     * @return The configured DynamoDB table name
     */
    fun getMetadataTableName(): String {
        return getConfig("METADATA_TABLE", "cfm-metadata-${getEnvironment()}")!!
    }

    /**
     * Gets the current deployment environment
     *
     * @return The environment name (dev, test, prod)
     */
    fun getEnvironment(): String {
        return getConfig("CFM_ENVIRONMENT", "dev")!!
    }

    /**
     * Checks if running in local development mode
     *
     * @return True if running locally
     */
    fun isLocalDevelopment(): Boolean {
        return getEnvironment() == "dev" && getConfig("AWS_LAMBDA_FUNCTION_NAME") == null
    }

    /**
     * Gets the maximum file size limit in bytes
     *
     * @return The maximum file size in bytes
     */
    fun getMaxFileSize(): Long {
        val configValue = getConfig("MAX_FILE_SIZE", "5368709120") // 5GB default
        return try {
            configValue!!.toLong()
        } catch (e: NumberFormatException) {
            5L * 1024 * 1024 * 1024 // 5GB
        }
    }

    /**
     * Gets the allowed file extensions
     *
     * @return Set of allowed file extensions
     */
    fun getAllowedFileExtensions(): Set<String> {
        val configValue = getConfig("ALLOWED_EXTENSIONS")

        return if (configValue != null) {
            configValue.split(",").map { it.trim().lowercase(Locale.getDefault()) }.toSet()
        } else {
            // Default allowed extensions
            setOf(
                "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
                "txt", "csv", "json", "xml",
                "jpg", "jpeg", "png", "gif", "svg", "webp",
                "zip", "rar"
            )
        }
    }

    /**
     * Gets the virus scan enabled flag
     *
     * @return True if virus scanning is enabled
     */
    fun isVirusScanEnabled(): Boolean {
        return getConfig("ENABLE_VIRUS_SCAN", "true")!!.toBoolean()
    }
}