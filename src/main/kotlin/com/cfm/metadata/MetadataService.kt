package com.cfm.metadata

import com.cfm.model.FileMetadata
import com.cfm.model.FileModel
import kotlinx.coroutines.future.await
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import software.amazon.awssdk.services.dynamodb.DynamoDbAsyncClient
import software.amazon.awssdk.services.dynamodb.model.*
import java.time.Instant
import java.util.*

/**
 * Service for handling file metadata operations using AWS DynamoDB
 */
class MetadataService(
    private val dynamoDbClient: DynamoDbAsyncClient,
    private val tableName: String
) {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    /**
     * Saves file metadata to DynamoDB
     *
     * @param fileModel The file model containing metadata
     * @return The ID of the saved metadata record
     */
    suspend fun saveMetadata(fileModel: FileModel): String {
        val fileId = fileModel.id.ifEmpty { UUID.randomUUID().toString() }

        val item = mapOf(
            "id" to AttributeValue.builder().s(fileId).build(),
            "name" to AttributeValue.builder().s(fileModel.name).build(),
            "size" to AttributeValue.builder().n(fileModel.size.toString()).build(),
            "mimeType" to AttributeValue.builder().s(fileModel.mimeType).build(),
            "uploadedAt" to AttributeValue.builder().s(Instant.now().toString()).build(),
            "path" to AttributeValue.builder().s(fileModel.path).build(),
            "metadata" to AttributeValue.builder().s(json.encodeToString(fileModel.metadata)).build(),
            "tags" to AttributeValue.builder()
                .l(fileModel.tags.map { AttributeValue.builder().s(it).build() })
                .build()
        )

        val putItemRequest = PutItemRequest.builder()
            .tableName(tableName)
            .item(item)
            .build()

        dynamoDbClient.putItem(putItemRequest).await()
        return fileId
    }

    /**
     * Retrieves file metadata by ID
     *
     * @param fileId The ID of the file
     * @return The file model or null if not found
     */
    suspend fun getMetadata(fileId: String): FileModel? {
        val getItemRequest = GetItemRequest.builder()
            .tableName(tableName)
            .key(mapOf("id" to AttributeValue.builder().s(fileId).build()))
            .build()

        val response = dynamoDbClient.getItem(getItemRequest).await()

        if (!response.hasItem() || response.item().isEmpty()) {
            return null
        }

        return mapToFileModel(response.item())
    }

    /**
     * Updates file metadata
     *
     * @param fileId The ID of the file
     * @param metadata The updated metadata
     * @return True if update was successful
     */
    suspend fun updateMetadata(fileId: String, metadata: FileMetadata): Boolean {
        val updateExpression = "SET metadata = :metadata, updatedAt = :updatedAt"

        val attributeValues = mapOf(
            ":metadata" to AttributeValue.builder().s(json.encodeToString(metadata)).build(),
            ":updatedAt" to AttributeValue.builder().s(Instant.now().toString()).build()
        )

        val updateItemRequest = UpdateItemRequest.builder()
            .tableName(tableName)
            .key(mapOf("id" to AttributeValue.builder().s(fileId).build()))
            .updateExpression(updateExpression)
            .expressionAttributeValues(attributeValues)
            .build()

        val response = dynamoDbClient.updateItem(updateItemRequest).await()
        return response.sdkHttpResponse().isSuccessful
    }

    /**
     * Updates the tags for a file
     *
     * @param fileId The ID of the file
     * @param tags The updated list of tags
     * @return True if update was successful
     */
    suspend fun updateTags(fileId: String, tags: List<String>): Boolean {
        val updateExpression = "SET tags = :tags, updatedAt = :updatedAt"

        val attributeValues = mapOf(
            ":tags" to AttributeValue.builder()
                .l(tags.map { AttributeValue.builder().s(it).build() })
                .build(),
            ":updatedAt" to AttributeValue.builder().s(Instant.now().toString()).build()
        )

        val updateItemRequest = UpdateItemRequest.builder()
            .tableName(tableName)
            .key(mapOf("id" to AttributeValue.builder().s(fileId).build()))
            .updateExpression(updateExpression)
            .expressionAttributeValues(attributeValues)
            .build()

        val response = dynamoDbClient.updateItem(updateItemRequest).await()
        return response.sdkHttpResponse().isSuccessful
    }

    /**
     * Deletes file metadata
     *
     * @param fileId The ID of the file
     * @return True if deletion was successful
     */
    suspend fun deleteMetadata(fileId: String): Boolean {
        val deleteItemRequest = DeleteItemRequest.builder()
            .tableName(tableName)
            .key(mapOf("id" to AttributeValue.builder().s(fileId).build()))
            .build()

        val response = dynamoDbClient.deleteItem(deleteItemRequest).await()
        return response.sdkHttpResponse().isSuccessful
    }

    /**
     * Searches for files based on metadata criteria
     *
     * @param searchTerm The text to search for
     * @param tags Optional list of tags to filter by
     * @param mimeTypes Optional list of MIME types to filter by
     * @return List of matching file models
     */
    suspend fun searchFiles(
        searchTerm: String,
        tags: List<String> = emptyList(),
        mimeTypes: List<String> = emptyList()
    ): List<FileModel> {
        // Build filter expressions based on search criteria
        val filterExpressions = mutableListOf<String>()
        val expressionAttributeValues = mutableMapOf<String, AttributeValue>()

        // Add search term filter (searches in name and metadata)
        if (searchTerm.isNotEmpty()) {
            filterExpressions.add("contains(#name, :searchTerm) OR contains(#metadata, :searchTerm)")
            expressionAttributeValues[":searchTerm"] = AttributeValue.builder().s(searchTerm).build()
        }

        // Add tags filter
        if (tags.isNotEmpty()) {
            val tagFilters = tags.mapIndexed { index, tag ->
                val key = ":tag$index"
                expressionAttributeValues[key] = AttributeValue.builder().s(tag).build()
                "contains(#tags, $key)"
            }.joinToString(" OR ")

            filterExpressions.add("($tagFilters)")
        }

        // Add MIME type filter
        if (mimeTypes.isNotEmpty()) {
            val mimeTypeFilters = mimeTypes.mapIndexed { index, mimeType ->
                val key = ":mimeType$index"
                expressionAttributeValues[key] = AttributeValue.builder().s(mimeType).build()
                "#mimeType = $key"
            }.joinToString(" OR ")

            filterExpressions.add("($mimeTypeFilters)")
        }

        // Build the final filter expression
        val filterExpression = if (filterExpressions.isNotEmpty()) {
            filterExpressions.joinToString(" AND ")
        } else {
            null
        }

        // Create expression attribute names
        val expressionAttributeNames = mapOf(
            "#name" to "name",
            "#metadata" to "metadata",
            "#tags" to "tags",
            "#mimeType" to "mimeType"
        )

        // Create the scan request
        val scanRequest = ScanRequest.builder()
            .tableName(tableName)
            .apply {
                if (filterExpression != null) {
                    filterExpression(filterExpression)
                    expressionAttributeValues(expressionAttributeValues)
                    expressionAttributeNames(expressionAttributeNames)
                }
            }
            .build()

        val response = dynamoDbClient.scan(scanRequest).await()
        return response.items().map { mapToFileModel(it) }
    }

    /**
     * Maps a DynamoDB item to a FileModel
     *
     * @param item The DynamoDB item
     * @return The converted FileModel
     */
    private fun mapToFileModel(item: Map<String, AttributeValue>): FileModel {
        val id = item["id"]?.s() ?: ""
        val name = item["name"]?.s() ?: ""
        val size = item["size"]?.n()?.toLong() ?: 0L
        val mimeType = item["mimeType"]?.s() ?: ""
        val uploadedAt = item["uploadedAt"]?.s() ?: Instant.now().toString()
        val path = item["path"]?.s() ?: ""
        val metadataJson = item["metadata"]?.s() ?: "{}"
        val tags = item["tags"]?.l()?.map { it.s() } ?: emptyList()

        val metadata = try {
            json.decodeFromString<FileMetadata>(metadataJson)
        } catch (e: Exception) {
            FileMetadata(contentType = mimeType)
        }

        return FileModel(
            id = id,
            name = name,
            size = size,
            mimeType = mimeType,
            uploadedAt = uploadedAt,
            path = path,
            metadata = metadata,
            tags = tags
        )
    }
}