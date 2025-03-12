package com.cfm.storage

import com.cfm.model.FileModel
import kotlinx.coroutines.future.await
import software.amazon.awssdk.core.async.AsyncRequestBody
import software.amazon.awssdk.core.async.AsyncResponseTransformer
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.services.s3.model.*
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest
import java.io.InputStream
import java.nio.ByteBuffer
import java.time.Duration
import java.util.*

/**
 * Service for handling file storage operations using AWS S3
 */
class StorageService(private val s3Client: S3AsyncClient, private val bucketName: String) {

    /**
     * Uploads a file to S3 storage
     *
     * @param fileName The name of the file
     * @param contentType The content type (MIME type) of the file
     * @param inputStream The file content as an input stream
     * @param metadata Additional metadata to store with the file
     * @return The S3 object key and version ID
     */
    suspend fun uploadFile(
        fileName: String,
        contentType: String,
        inputStream: InputStream,
        metadata: Map<String, String> = emptyMap()
    ): Pair<String, String> {
        val objectKey = generateObjectKey(fileName)

        val putObjectRequest = PutObjectRequest.builder()
            .bucket(bucketName)
            .key(objectKey)
            .contentType(contentType)
            .metadata(metadata)
            .build()

        val fileBytes = inputStream.readAllBytes()
        val response = s3Client.putObject(
            putObjectRequest,
            AsyncRequestBody.fromBytes(fileBytes)
        ).await()

        return Pair(objectKey, response.versionId())
    }

    /**
     * Downloads a file from S3 storage
     *
     * @param objectKey The S3 object key
     * @param versionId Optional version ID (if null, the latest version is downloaded)
     * @return The file content as a ByteBuffer
     */
    suspend fun downloadFile(objectKey: String, versionId: String? = null): ByteBuffer {
        val getObjectRequest = GetObjectRequest.builder()
            .bucket(bucketName)
            .key(objectKey)
            .apply {
                if (versionId != null) versionId(versionId)
            }
            .build()

        return s3Client.getObject(
            getObjectRequest,
            AsyncResponseTransformer.toBytes()
        ).await().asByteBuffer()
    }

    /**
     * Generates a presigned URL for temporary file access
     *
     * @param objectKey The S3 object key
     * @param durationSeconds The duration in seconds for which the URL is valid
     * @param versionId Optional version ID
     * @return The presigned URL as a string
     */
    fun generatePresignedUrl(
        objectKey: String,
        durationSeconds: Long = 3600,
        versionId: String? = null
    ): String {
        val getObjectRequest = GetObjectRequest.builder()
            .bucket(bucketName)
            .key(objectKey)
            .apply {
                if (versionId != null) versionId(versionId)
            }
            .build()

        val presignRequest = GetObjectPresignRequest.builder()
            .signatureDuration(Duration.ofSeconds(durationSeconds))
            .getObjectRequest(getObjectRequest)
            .build()

        return s3Client.presignGetObject(presignRequest).url().toString()
    }

    /**
     * Deletes a file from S3 storage
     *
     * @param objectKey The S3 object key
     * @return True if deletion was successful
     */
    suspend fun deleteFile(objectKey: String): Boolean {
        val deleteObjectRequest = DeleteObjectRequest.builder()
            .bucket(bucketName)
            .key(objectKey)
            .build()

        val response = s3Client.deleteObject(deleteObjectRequest).await()
        return response.deleteMarker()
    }

    /**
     * Lists all file versions for the given object key
     *
     * @param objectKey The S3 object key
     * @return List of version IDs and their creation timestamps
     */
    suspend fun listFileVersions(objectKey: String): List<Pair<String, String>> {
        val listVersionsRequest = ListObjectVersionsRequest.builder()
            .bucket(bucketName)
            .prefix(objectKey)
            .build()

        val response = s3Client.listObjectVersions(listVersionsRequest).await()

        return response.versions().map { version ->
            Pair(version.versionId(), version.lastModified().toString())
        }
    }

    /**
     * Generates a unique object key for S3 storage based on the file name
     *
     * @param fileName The original file name
     * @return A unique S3 object key
     */
    private fun generateObjectKey(fileName: String): String {
        val uuid = UUID.randomUUID().toString()
        val sanitizedFileName = fileName.replace("[^a-zA-Z0-9.-]".toRegex(), "_")

        // Create a path with year/month structure for better organization
        val today = Calendar.getInstance()
        val year = today.get(Calendar.YEAR)
        val month = today.get(Calendar.MONTH) + 1

        return "$year/$month/$uuid-$sanitizedFileName"
    }
}