package com.cfm.metadata

import com.cfm.model.*
import kotlinx.coroutines.future.await
import software.amazon.awssdk.core.SdkBytes
import software.amazon.awssdk.services.rekognition.RekognitionAsyncClient
import software.amazon.awssdk.services.rekognition.model.*
import software.amazon.awssdk.services.textract.TextractAsyncClient
import software.amazon.awssdk.services.textract.model.AnalyzeDocumentRequest
import software.amazon.awssdk.services.textract.model.Document
import software.amazon.awssdk.services.textract.model.FeatureType
import java.nio.ByteBuffer
import java.util.*

/**
 * Service for extracting metadata from different file types using AWS services
 */
class MetadataExtractor(
    private val rekognitionClient: RekognitionAsyncClient,
    private val textractClient: TextractAsyncClient
) {
    /**
     * Extracts metadata from a file based on its MIME type
     *
     * @param fileBytes The file content as a ByteBuffer
     * @param mimeType The MIME type of the file
     * @param fileName The name of the file
     * @return The extracted metadata
     */
    suspend fun extractMetadata(
        fileBytes: ByteBuffer,
        mimeType: String,
        fileName: String
    ): FileMetadata {
        return when {
            mimeType.startsWith("image/") -> extractImageMetadata(fileBytes)
            mimeType.startsWith("application/pdf") -> extractDocumentMetadata(fileBytes)
            mimeType.contains("document") || mimeType.contains("spreadsheet") ->
                extractDocumentMetadata(fileBytes)
            else -> FileMetadata(contentType = mimeType)
        }
    }

    /**
     * Extracts metadata from an image file
     *
     * @param fileBytes The image file content
     * @return The extracted image metadata
     */
    private suspend fun extractImageMetadata(fileBytes: ByteBuffer): FileMetadata {
        val sdkBytes = SdkBytes.fromByteBuffer(fileBytes)

        // Detect labels (objects) in the image
        val detectLabelsRequest = DetectLabelsRequest.builder()
            .image(Image.builder().bytes(sdkBytes).build())
            .maxLabels(20)
            .minConfidence(70f)
            .build()

        val labelsResponse = rekognitionClient.detectLabels(detectLabelsRequest).await()

        val detectedObjects = labelsResponse.labels().map { label ->
            val boundingBox = label.instances().firstOrNull()?.boundingBox()?.let {
                BoundingBox(
                    top = it.top(),
                    left = it.left(),
                    width = it.width(),
                    height = it.height()
                )
            }

            DetectedObject(
                name = label.name(),
                confidence = label.confidence(),
                boundingBox = boundingBox
            )
        }

        // Detect text in the image
        val detectTextRequest = DetectTextRequest.builder()
            .image(Image.builder().bytes(sdkBytes).build())
            .build()

        val textResponse = rekognitionClient.detectText(detectTextRequest).await()
        val extractedText = textResponse.textDetections()
            .filter { it.type() == TextTypes.LINE }
            .joinToString("\n") { it.detectedText() }

        // Create categories based on detected labels
        val categories = labelsResponse.labels()
            .filter { it.confidence() > 90f }
            .map { it.name() }
            .toList()

        // Extract entities from detected text
        val entities = extractEntitiesFromText(extractedText)

        // Create image metadata
        val imageMetadata = ImageMetadata(
            detectedObjects = detectedObjects,
            containsText = extractedText.isNotEmpty(),
            extractedImageText = extractedText
        )

        return FileMetadata(
            contentType = "image",
            extractedText = extractedText,
            entities = entities,
            categories = categories,
            imageData = imageMetadata
        )
    }

    /**
     * Extracts metadata from a document file
     *
     * @param fileBytes The document file content
     * @return The extracted document metadata
     */
    private suspend fun extractDocumentMetadata(fileBytes: ByteBuffer): FileMetadata {
        val sdkBytes = SdkBytes.fromByteBuffer(fileBytes)

        // Analyze document using Textract
        val analyzeRequest = AnalyzeDocumentRequest.builder()
            .document(Document.builder().bytes(sdkBytes).build())
            .featureTypes(FeatureType.TABLES, FeatureType.FORMS)
            .build()

        val analyzeResponse = textractClient.analyzeDocument(analyzeRequest).await()

        // Extract text content
        val extractedText = analyzeResponse.blocks()
            .filter { it.blockType().toString() == "LINE" }
            .joinToString("\n") { it.text() }

        // Extract key-value pairs (forms)
        val keyValuePairs = mutableMapOf<String, String>()
        val keyMap = mutableMapOf<String, String>()
        val valueMap = mutableMapOf<String, String>()

        analyzeResponse.blocks().forEach { block ->
            when (block.blockType().toString()) {
                "KEY" -> {
                    val key = block.text()
                    keyMap[block.id()] = key
                }
                "VALUE" -> {
                    val value = block.text()
                    valueMap[block.id()] = value
                }
            }
        }

        // Match keys with values based on relationships
        analyzeResponse.blocks().forEach { block ->
            if (block.blockType().toString() == "KEY_VALUE_SET") {
                val keyId = block.relationships()?.firstOrNull { it.type().toString() == "CHILD" }
                    ?.ids()?.firstOrNull()

                val valueBlock = block.relationships()?.firstOrNull { it.type().toString() == "VALUE" }
                if (keyId != null && valueBlock != null) {
                    val key = keyMap[keyId] ?: return@forEach
                    val valueId = valueBlock.ids().firstOrNull() ?: return@forEach
                    val value = valueMap[valueId] ?: return@forEach

                    keyValuePairs[key] = value
                }
            }
        }

        // Extract tables
        val tables = mutableListOf<Table>()

        // In a real implementation, we would parse table cells into rows and columns
        // This is a simplified version

        // Extract entities
        val entities = extractEntitiesFromText(extractedText)

        // Create document metadata
        val documentMetadata = DocumentMetadata(
            keyValuePairs = keyValuePairs,
            tables = tables
        )

        // Try to determine document type
        val documentType = determineDocumentType(extractedText, keyValuePairs)

        return FileMetadata(
            contentType = "document",
            extractedText = extractedText,
            entities = entities,
            categories = listOf(documentType),
            documentData = documentMetadata
        )
    }

    /**
     * Attempts to determine the document type based on content
     *
     * @param text The extracted text
     * @param keyValuePairs Key-value pairs extracted from the document
     * @return The determined document type
     */
    private fun determineDocumentType(
        text: String,
        keyValuePairs: Map<String, String>
    ): String {
        val lowerText = text.lowercase(Locale.getDefault())

        return when {
            lowerText.contains("invoice") ||
                    keyValuePairs.keys.any { it.lowercase().contains("invoice") } -> "invoice"

            lowerText.contains("receipt") ||
                    keyValuePairs.keys.any { it.lowercase().contains("total") &&
                            it.lowercase().contains("amount") } -> "receipt"

            lowerText.contains("contract") ||
                    lowerText.contains("agreement") -> "contract"

            lowerText.contains("resume") ||
                    lowerText.contains("cv") ||
                    lowerText.contains("curriculum vitae") -> "resume"

            else -> "document"
        }
    }

    /**
     * Extracts entities from text using basic pattern matching
     * In a production system, this would use a more sophisticated NER model
     *
     * @param text The text to analyze
     * @return List of extracted entities
     */
    private fun extractEntitiesFromText(text: String): List<Entity> {
        val entities = mutableListOf<Entity>()

        // Simple email regex
        val emailRegex = Regex("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}")
        emailRegex.findAll(text).forEach {
            entities.add(Entity(it.value, EntityType.EMAIL, 0.9f))
        }

        // Simple phone number regex
        val phoneRegex = Regex("\\+?[0-9]{10,12}")
        phoneRegex.findAll(text).forEach {
            entities.add(Entity(it.value, EntityType.PHONE_NUMBER, 0.8f))
        }

        // Simple URL regex
        val urlRegex = Regex("https?://[\\w.-]+(?:\\.[\\w.-]+)+[\\w\\-._~:/?#[\\]@!$&'()*+,;=]*")
        urlRegex.findAll(text).forEach {
            entities.add(Entity(it.value, EntityType.URL, 0.9f))
        }

        // Simple date regex (covers common formats)
        val dateRegex = Regex("\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}")
        dateRegex.findAll(text).forEach {
            entities.add(Entity(it.value, EntityType.DATE, 0.7f))
        }

        return entities
    }
}