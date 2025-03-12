package com.cfm.api

import com.cfm.metadata.MetadataExtractor
import com.cfm.metadata.MetadataService
import com.cfm.model.FileModel
import com.cfm.search.SearchFilters
import com.cfm.search.SearchService
import com.cfm.security.SecurityService
import com.cfm.storage.StorageService
import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.ByteBuffer
import java.text.SimpleDateFormat
import java.util.*

/**
 * Configures the API routes for the file manager
 */
fun Application.configureFileManagerApi(
    storageService: StorageService,
    metadataService: MetadataService,
    metadataExtractor: MetadataExtractor,
    searchService: SearchService,
    securityService: SecurityService
) {
    routing {
        // Health check endpoint
        get("/health") {
            call.respondText("OK", contentType = ContentType.Text.Plain)
        }

        // Upload file endpoint
        post("/files") {
            val multipart = call.receiveMultipart()
            var fileName = ""
            var fileBytes: ByteBuffer? = null
            var mimeType = ""
            var tags = listOf<String>()

            multipart.forEachPart { part ->
                when (part) {
                    is PartData.FormItem -> {
                        if (part.name == "tags") {
                            tags = part.value.split(",").map { it.trim() }
                        }
                    }
                    is PartData.FileItem -> {
                        fileName = part.originalFileName ?: "unknown"
                        mimeType = part.contentType?.toString() ?: "application/octet-stream"

                        // Create a temporary file
                        val tempFile = File.createTempFile("upload-", "-temp")
                        part.streamProvider().use { input ->
                            tempFile.outputStream().use { output ->
                                input.copyTo(output)
                            }
                        }

                        // Read the file into memory
                        fileBytes = ByteBuffer.wrap(tempFile.readBytes())
                        tempFile.delete()
                    }
                    else -> {}
                }
                part.dispose()
            }

            if (fileBytes == null) {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "No file uploaded"))
                return@post
            }

            // Validate the file
            val validationResult = securityService.validateFile(
                fileName = fileName,
                fileSize = fileBytes.remaining().toLong(),
                mimeType = mimeType
            )

            if (!validationResult.isValid) {
                call.respond(
                    HttpStatusCode.BadRequest,
                    mapOf("error" to validationResult.message)
                )
                return@post
            }

            // Scan for viruses
            val scanResult = securityService.scanFile(fileBytes!!)
            if (!scanResult.isClean) {
                call.respond(
                    HttpStatusCode.BadRequest,
                    mapOf("error" to "File contains malicious content: ${scanResult.message}")
                )
                return@post
            }

            // Upload to S3
            val (objectKey, versionId) = storageService.uploadFile(
                fileName = fileName,
                contentType = mimeType,
                inputStream = ByteArrayInputStream(fileBytes.array(), fileBytes.position(), fileBytes.remaining()),
                metadata = mapOf("uploadedBy" to "api", "fileSize" to fileBytes.remaining().toString())
            )

            // Extract metadata
            val metadata = metadataExtractor.extractMetadata(
                fileBytes = fileBytes.rewind(),
                mimeType = mimeType,
                fileName = fileName
            )

            // Create file model
            val fileModel = FileModel(
                id = UUID.randomUUID().toString(),
                name = fileName,
                size = fileBytes.remaining().toLong(),
                mimeType = mimeType,
                path = objectKey,
                metadata = metadata,
                tags = tags
            )

            // Save metadata to DynamoDB
            val fileId = metadataService.saveMetadata(fileModel)

            // Generate a presigned URL for immediate access
            val presignedUrl = storageService.generatePresignedUrl(objectKey)

            call.respond(
                HttpStatusCode.Created,
                mapOf(
                    "fileId" to fileId,
                    "objectKey" to objectKey,
                    "versionId" to versionId,
                    "url" to presignedUrl
                )
            )
        }

        // Get file metadata endpoint
        get("/files/{id}") {
            val fileId = call.parameters["id"] ?: run {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Missing file ID"))
                return@get
            }

            val fileModel = metadataService.getMetadata(fileId) ?: run {
                call.respond(HttpStatusCode.NotFound, mapOf("error" to "File not found"))
                return@get
            }

            call.respond(fileModel)
        }

        // Download file endpoint
        get("/files/{id}/download") {
            val fileId = call.parameters["id"] ?: run {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Missing file ID"))
                return@get
            }

            val fileModel = metadataService.getMetadata(fileId) ?: run {
                call.respond(HttpStatusCode.NotFound, mapOf("error" to "File not found"))
                return@get
            }

            // Generate a presigned URL for download
            val presignedUrl = storageService.generatePresignedUrl(fileModel.path)

            // Redirect to the presigned URL
            call.respondRedirect(presignedUrl)
        }

        // Delete file endpoint
        delete("/files/{id}") {
            val fileId = call.parameters["id"] ?: run {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Missing file ID"))
                return@delete
            }

            val fileModel = metadataService.getMetadata(fileId) ?: run {
                call.respond(HttpStatusCode.NotFound, mapOf("error" to "File not found"))
                return@delete
            }

            // Delete from S3
            val deleted = storageService.deleteFile(fileModel.path)

            // Delete metadata from DynamoDB
            metadataService.deleteMetadata(fileId)

            call.respond(HttpStatusCode.OK, mapOf("deleted" to deleted))
        }

        // Update file tags endpoint
        put("/files/{id}/tags") {
            val fileId = call.parameters["id"] ?: run {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Missing file ID"))
                return@put
            }

            val fileModel = metadataService.getMetadata(fileId) ?: run {
                call.respond(HttpStatusCode.NotFound, mapOf("error" to "File not found"))
                return@put
            }

            val requestBody = call.receive<Map<String, List<String>>>()
            val tags = requestBody["tags"] ?: run {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Missing tags"))
                return@put
            }

            metadataService.updateTags(fileId, tags)

            call.respond(HttpStatusCode.OK, mapOf("updated" to true))
        }

        // Search files endpoint
        get("/search") {
            val query = call.request.queryParameters["q"] ?: ""
            val tags = call.request.queryParameters["tags"]?.split(",") ?: emptyList()
            val mimeTypes = call.request.queryParameters["types"]?.split(",") ?: emptyList()
            val categories = call.request.queryParameters["categories"]?.split(",") ?: emptyList()

            // Parse date filters
            val dateFormat = SimpleDateFormat("yyyy-MM-dd")
            val uploadedAfter = call.request.queryParameters["after"]?.let {
                try {
                    dateFormat.parse(it)
                } catch (e: Exception) {
                    null
                }
            }

            val uploadedBefore = call.request.queryParameters["before"]?.let {
                try {
                    dateFormat.parse(it)
                } catch (e: Exception) {
                    null
                }
            }

            // Parse size filters
            val minSize = call.request.queryParameters["minSize"]?.toLongOrNull()
            val maxSize = call.request.queryParameters["maxSize"]?.toLongOrNull()

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

            call.respond(results)
        }
    }
}