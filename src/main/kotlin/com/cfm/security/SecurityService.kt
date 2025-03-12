package com.cfm.security

import java.io.InputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Service for handling security-related operations like virus scanning and file validation
 */
class SecurityService {

    // List of allowed file types
    private val allowedMimeTypes = setOf(
        // Documents
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "text/csv",

        // Images
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/svg+xml",
        "image/webp",

        // Archives
        "application/zip",
        "application/x-rar-compressed"
    )

    // Maximum file size (5GB - S3 single upload limit)
    private val maxFileSize = 5L * 1024 * 1024 * 1024

    /**
     * Validates a file before upload
     *
     * @param fileName The name of the file
     * @param fileSize The size of the file in bytes
     * @param mimeType The MIME type of the file
     * @return The validation result
     */
    fun validateFile(fileName: String, fileSize: Long, mimeType: String): ValidationResult {
        // Check file size
        if (fileSize > maxFileSize) {
            return ValidationResult(
                isValid = false,
                message = "File size exceeds maximum allowed (5GB)"
            )
        }

        // Check file type
        if (mimeType !in allowedMimeTypes) {
            return ValidationResult(
                isValid = false,
                message = "File type not allowed: $mimeType"
            )
        }

        // Check for suspicious file extension
        val extension = fileName.substringAfterLast('.', "").lowercase()
        if (extension in SUSPICIOUS_EXTENSIONS) {
            return ValidationResult(
                isValid = false,
                message = "File extension not allowed: .$extension"
            )
        }

        return ValidationResult(isValid = true)
    }

    /**
     * Scans a file for viruses
     *
     * In a real implementation, this would integrate with a virus scanning service
     * like ClamAV or a third-party API. This is a simplified placeholder.
     *
     * @param fileBytes The file content
     * @return The scan result
     */
    suspend fun scanFile(fileBytes: ByteBuffer): ScanResult {
        // This is a placeholder for actual virus scanning logic
        // In a real implementation, we would integrate with a virus scanning service

        // For demonstration, we'll just check for a "VIRUS" string in the first 100 bytes
        // as a very basic simulation
        return withContext(Dispatchers.IO) {
            val bytes = ByteArray(Math.min(100, fileBytes.remaining()))
            fileBytes.get(bytes)
            fileBytes.rewind() // Reset position to start

            val fileStart = String(bytes)
            val isMalicious = fileStart.contains("VIRUS")

            if (isMalicious) {
                ScanResult(
                    isClean = false,
                    threats = listOf("Simulated virus detected"),
                    message = "File contains malicious content"
                )
            } else {
                ScanResult(isClean = true)
            }
        }
    }

    /**
     * Calculates a hash for the file content (for integrity verification)
     *
     * @param inputStream The file input stream
     * @return The calculated SHA-256 hash
     */
    suspend fun calculateFileHash(inputStream: InputStream): String = withContext(Dispatchers.IO) {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)
        var bytesRead: Int

        while (inputStream.read(buffer).also { bytesRead = it } != -1) {
            digest.update(buffer, 0, bytesRead)
        }

        val hashBytes = digest.digest()
        val hexString = StringBuilder()

        for (byte in hashBytes) {
            val hex = Integer.toHexString(0xff and byte.toInt())
            if (hex.length == 1) {
                hexString.append('0')
            }
            hexString.append(hex)
        }

        hexString.toString()
    }

    companion object {
        // List of suspicious file extensions that might contain malicious code
        private val SUSPICIOUS_EXTENSIONS = setOf(
            "exe", "bat", "cmd", "sh", "js", "vbs", "ps1", "jar", "msi", "com", "scr"
        )
    }
}

/**
 * Result of file validation
 */
data class ValidationResult(
    val isValid: Boolean,
    val message: String = ""
)

/**
 * Result of virus scanning
 */
data class ScanResult(
    val isClean: Boolean,
    val threats: List<String> = emptyList(),
    val message: String = ""
)