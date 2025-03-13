import io
import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, BinaryIO

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class StorageService:
    """Service for handling file storage operations using AWS S3"""

    def __init__(self, bucket_name: str, region_name: str = "us-east-1"):
        self.bucket_name = bucket_name
        self.region_name = region_name
        self.s3_client = boto3.client("s3", region_name=region_name)
        self.s3_resource = boto3.resource("s3", region_name=region_name)

    def upload_file(
            self,
            file_name: str,
            content_type: str,
            file_data: BinaryIO,
            metadata: Dict[str, str] = None
    ) -> Tuple[str, str]:
        """
        Uploads a file to S3 storage

        Args:
            file_name: The name of the file
            content_type: The content type (MIME type) of the file
            file_data: The file content as a file-like object
            metadata: Additional metadata to store with the file

        Returns:
            Tuple containing the S3 object key and version ID
        """
        if metadata is None:
            metadata = {}

        # Generate a unique object key
        object_key = self._generate_object_key(file_name)

        try:
            # Upload the file to S3
            response = self.s3_client.upload_fileobj(
                file_data,
                self.bucket_name,
                object_key,
                ExtraArgs={
                    "ContentType": content_type,
                    "Metadata": metadata
                }
            )

            # Get the version ID
            head_response = self.s3_client.head_object(
                Bucket=self.bucket_name,
                Key=object_key
            )
            version_id = head_response.get("VersionId", "")

            return object_key, version_id

        except ClientError as e:
            logger.error(f"Error uploading file to S3: {e}")
            raise

    def download_file(self, object_key: str, version_id: Optional[str] = None) -> bytes:
        """
        Downloads a file from S3 storage

        Args:
            object_key: The S3 object key
            version_id: Optional version ID (if None, the latest version is downloaded)

        Returns:
            The file content as bytes
        """
        try:
            # Create a BytesIO object to store the downloaded file
            file_data = io.BytesIO()

            # Download the file from S3
            kwargs = {
                "Bucket": self.bucket_name,
                "Key": object_key
            }

            if version_id:
                kwargs["VersionId"] = version_id

            self.s3_client.download_fileobj(
                **kwargs,
                Fileobj=file_data
            )

            # Reset the file pointer to the beginning and return the bytes
            file_data.seek(0)
            return file_data.read()

        except ClientError as e:
            logger.error(f"Error downloading file from S3: {e}")
            raise

    def generate_presigned_url(
            self,
            object_key: str,
            duration_seconds: int = 3600,
            version_id: Optional[str] = None
    ) -> str:
        """
        Generates a presigned URL for temporary file access

        Args:
            object_key: The S3 object key
            duration_seconds: The duration in seconds for which the URL is valid
            version_id: Optional version ID

        Returns:
            The presigned URL as a string
        """
        try:
            # Generate a presigned URL for the object
            params = {
                "Bucket": self.bucket_name,
                "Key": object_key
            }

            if version_id:
                params["VersionId"] = version_id

            url = self.s3_client.generate_presigned_url(
                ClientMethod="get_object",
                Params=params,
                ExpiresIn=duration_seconds
            )

            return url

        except ClientError as e:
            logger.error(f"Error generating presigned URL: {e}")
            raise

    def delete_file(self, object_key: str) -> bool:
        """
        Deletes a file from S3 storage

        Args:
            object_key: The S3 object key

        Returns:
            True if deletion was successful
        """
        try:
            # Delete the object from S3
            response = self.s3_client.delete_object(
                Bucket=self.bucket_name,
                Key=object_key
            )

            # Check if deletion was successful
            return response.get("DeleteMarker", False)

        except ClientError as e:
            logger.error(f"Error deleting file from S3: {e}")
            raise

    def list_file_versions(self, object_key: str) -> List[Tuple[str, str]]:
        """
        Lists all file versions for the given object key

        Args:
            object_key: The S3 object key

        Returns:
            List of tuples containing version IDs and their creation timestamps
        """
        try:
            # List versions of the object
            response = self.s3_client.list_object_versions(
                Bucket=self.bucket_name,
                Prefix=object_key
            )

            # Extract version information
            versions = []
            for version in response.get("Versions", []):
                if version.get("Key") == object_key:
                    versions.append((
                        version.get("VersionId", ""),
                        version.get("LastModified", datetime.now()).isoformat()
                    ))

            return versions

        except ClientError as e:
            logger.error(f"Error listing file versions: {e}")
            raise

    def _generate_object_key(self, file_name: str) -> str:
        """
        Generates a unique object key for S3 storage based on the file name

        Args:
            file_name: The original file name

        Returns:
            A unique S3 object key
        """
        # Generate a UUID
        unique_id = str(uuid.uuid4())

        # Sanitize the file name (remove special characters)
        sanitized_name = "".join(c if c.isalnum() or c in ".-_" else "_" for c in file_name)

        # Create a path with year/month structure for better organization
        now = datetime.now()
        year = now.year
        month = now.month

        return f"{year}/{month}/{unique_id}-{sanitized_name}"