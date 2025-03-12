package com.cfm.model

import kotlinx.serialization.Serializable
import org.joda.time.Instant

/**
 * Represents a file stored in the system with its metadata
 */
@Serializable
data class FileModel(
    val id: String,
    val name: String,
    val size: Long,
    val mimeType: String,
    val uploadedAt: String = Instant.now().toString(),
    val path: String,
    val metadata: FileMetadata,
    val tags: List<String> = emptyList(),
    val versions: List<FileVersion> = emptyList()
)

/**
 * Represents metadata extracted from a file
 */
@Serializable
data class FileMetadata(
    val contentType: String,
    val extractedText: String? = null,
    val entities: List<Entity> = emptyList(),
    val categories: List<String> = emptyList(),
    val imageData: ImageMetadata? = null,
    val documentData: DocumentMetadata? = null,
    val customAttributes: Map<String, String> = emptyMap()
)

/**
 * Represents metadata specific to images
 */
@Serializable
data class ImageMetadata(
    val width: Int? = null,
    val height: Int? = null,
    val detectedObjects: List<DetectedObject> = emptyList(),
    val dominantColors: List<String> = emptyList(),
    val containsText: Boolean = false,
    val extractedImageText: String? = null
)

/**
 * Represents an object detected in an image
 */
@Serializable
data class DetectedObject(
    val name: String,
    val confidence: Float,
    val boundingBox: BoundingBox? = null
)

/**
 * Represents a bounding box location in an image
 */
@Serializable
data class BoundingBox(
    val top: Float,
    val left: Float,
    val width: Float,
    val height: Float
)

/**
 * Represents metadata specific to documents
 */
@Serializable
data class DocumentMetadata(
    val pageCount: Int? = null,
    val documentType: String? = null,
    val keyValuePairs: Map<String, String> = emptyMap(),
    val tables: List<Table> = emptyList()
)

/**
 * Represents a table extracted from a document
 */
@Serializable
data class Table(
    val id: String,
    val pageNumber: Int,
    val headers: List<String> = emptyList(),
    val rows: List<List<String>> = emptyList()
)

/**
 * Represents an entity extracted from text
 */
@Serializable
data class Entity(
    val text: String,
    val type: EntityType,
    val confidence: Float
)

/**
 * Types of entities that can be extracted
 */
enum class EntityType {
    PERSON,
    ORGANIZATION,
    LOCATION,
    DATE,
    PHONE_NUMBER,
    EMAIL,
    URL,
    OTHER
}

/**
 * Represents a version of a file
 */
@Serializable
data class FileVersion(
    val versionId: String,
    val createdAt: String,
    val size: Long,
    val isLatest: Boolean = false
)