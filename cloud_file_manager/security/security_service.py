import hashlib
import logging
from dataclasses import dataclass
from typing import BinaryIO, List, Set

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """Result of file validation"""
    is_valid: bool
    message: str = ""


@dataclass
class ScanResult:
    """Result of virus scanning"""
    is_clean: bool
    threats: List[str] = None
    message: str = ""

    def __post_init__(self):
        if self.threats is None:
            self.threats = []


class SecurityService:
    """Service for handling security-related operations like virus scanning and file validation"""

    # List of allowed file types
    ALLOWED_MIME_TYPES: Set[str] = {
        # Documents
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "text/csv",

        # Images
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/svg+xml",
        "image/webp",

        # Archives
        "application/zip",
        "application/x-rar-compressed"
    }

    # Maximum file size (5GB - S3 single upload limit)
    MAX_FILE_SIZE: int = 5 * 1024 * 1024 * 1024

    # List of suspicious file extensions that might contain malicious code
    SUSPICIOUS_EXTENSIONS: Set[str] = {
        "exe", "bat", "cmd", "sh", "js", "vbs", "ps1", "jar", "msi", "com", "scr"
    }

    def validate_file(self, file_name: str, file_size: int, mime_type: str) -> ValidationResult:
        """
        Validates a file before upload

        Args:
            file_name: The name of the file
            file_size: The size of the file in bytes
            mime_type: The MIME type of the file

        Returns:
            The validation result
        """
        # Check file size
        if file_size > self.MAX_FILE_SIZE:
            return ValidationResult(
                is_valid=False,
                message=f"File size exceeds maximum allowed (5GB)"
            )

        # Check file type
        if mime_type not in self.ALLOWED_MIME_TYPES:
            return ValidationResult(
                is_valid=False,
                message=f"File type not allowed: {mime_type}"
            )

        # Check for suspicious file extension
        extension = file_name.split(".")[-1].lower() if "." in file_name else ""
        if extension in self.SUSPICIOUS_EXTENSIONS:
            return ValidationResult(
                is_valid=False,
                message=f"File extension not allowed: .{extension}"
            )

        return ValidationResult(is_valid=True)

    def scan_file(self, file_bytes: bytes) -> ScanResult:
        """
        Scans a file for viruses

        In a real implementation, this would integrate with a virus scanning service
        like ClamAV or a third-party API. This is a simplified placeholder.

        Args:
            file_bytes: The file content

        Returns:
            The scan result
        """
        # This is a placeholder for actual virus scanning logic
        # In a real implementation, we would integrate with a virus scanning service

        # For demonstration, we'll just check for a "VIRUS" string in the first 100 bytes
        # as a very basic simulation
        try:
            file_start = file_bytes[:100].decode("utf-8", errors="ignore")
            is_malicious = "VIRUS" in file_start

            if is_malicious:
                return ScanResult(
                    is_clean=False,
                    threats=["Simulated virus detected"],
                    message="File contains malicious content"
                )
            else:
                return ScanResult(is_clean=True)

        except Exception as e:
            logger.error(f"Error scanning file: {e}")
            # Be conservative - if scanning fails, assume the file is not clean
            return ScanResult(
                is_clean=False,
                threats=["Scan failed"],
                message=f"Could not scan file: {str(e)}"
            )

    def calculate_file_hash(self, file_data: BinaryIO) -> str:
        """
        Calculates a hash for the file content (for integrity verification)

        Args:
            file_data: The file input stream

        Returns:
            The calculated SHA-256 hash
        """
        sha256 = hashlib.sha256()

        # Process the file in chunks to avoid loading large files into memory
        for chunk in iter(lambda: file_data.read(8192), b""):
            sha256.update(chunk)

        # Reset the file pointer to the beginning
        file_data.seek(0)

        return sha256.hexdigest()