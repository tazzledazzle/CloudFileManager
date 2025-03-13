import json
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from cloud_file_manager.models.file_models import FileModel, FileMetadata

logger = logging.getLogger(__name__)


class MetadataService:
    """Service for handling file metadata operations using AWS DynamoDB"""

    def __init__(self, table_name: str, region_name: str = "us-east-1"):
        self.table_name = table_name
        self.region_name = region_name
        self.dynamodb = boto3.resource("dynamodb", region_name=region_name)
        self.table = self.dynamodb.Table(table_name)

    def save_metadata(self, file_model: FileModel) -> str:
        """
        Saves file metadata to DynamoDB

        Args:
            file_model: The file model containing metadata

        Returns:
            The ID of the saved metadata record
        """
        try:
            # Generate a new ID if not provided
            if not file_model.id:
                file_model.id = str(uuid.uuid4())

            # Convert the FileModel to a dictionary
            item = file_model.dict()

            # Convert nested models to JSON strings
            item["metadata"] = json.dumps(item["metadata"])

            # Save to DynamoDB
            self.table.put_item(Item=item)

            return file_model.id

        except ClientError as e:
            logger.error(f"Error saving metadata to DynamoDB: {e}")
            raise

    def get_metadata(self, file_id: str) -> Optional[FileModel]:
        """
        Retrieves file metadata by ID

        Args:
            file_id: The ID of the file

        Returns:
            The file model or None if not found
        """
        try:
            # Get the item from DynamoDB
            response = self.table.get_item(
                Key={"id": file_id}
            )

            # Check if the item exists
            if "Item" not in response:
                return None

            # Parse the item
            item = response["Item"]

            # Parse the metadata JSON string
            if "metadata" in item and isinstance(item["metadata"], str):
                item["metadata"] = json.loads(item["metadata"])

            # Create and return a FileModel
            return FileModel.parse_obj(item)

        except ClientError as e:
            logger.error(f"Error getting metadata from DynamoDB: {e}")
            raise

    def update_metadata(self, file_id: str, metadata: FileMetadata) -> bool:
        """
        Updates file metadata

        Args:
            file_id: The ID of the file
            metadata: The updated metadata

        Returns:
            True if update was successful
        """
        try:
            # Convert metadata to JSON string
            metadata_json = json.dumps(metadata.dict())

            # Update the item in DynamoDB
            response = self.table.update_item(
                Key={"id": file_id},
                UpdateExpression="SET metadata = :metadata, updated_at = :updated_at",
                ExpressionAttributeValues={
                    ":metadata": metadata_json,
                    ":updated_at": datetime.now().isoformat()
                },
                ReturnValues="UPDATED_NEW"
            )

            return "Attributes" in response

        except ClientError as e:
            logger.error(f"Error updating metadata in DynamoDB: {e}")
            raise

    def update_tags(self, file_id: str, tags: List[str]) -> bool:
        """
        Updates the tags for a file

        Args:
            file_id: The ID of the file
            tags: The updated list of tags

        Returns:
            True if update was successful
        """
        try:
            # Update the item in DynamoDB
            response = self.table.update_item(
                Key={"id": file_id},
                UpdateExpression="SET tags = :tags, updated_at = :updated_at",
                ExpressionAttributeValues={
                    ":tags": tags,
                    ":updated_at": datetime.now().isoformat()
                },
                ReturnValues="UPDATED_NEW"
            )

            return "Attributes" in response

        except ClientError as e:
            logger.error(f"Error updating tags in DynamoDB: {e}")
            raise

    def delete_metadata(self, file_id: str) -> bool:
        """
        Deletes file metadata

        Args:
            file_id: The ID of the file

        Returns:
            True if deletion was successful
        """
        try:
            # Delete the item from DynamoDB
            response = self.table.delete_item(
                Key={"id": file_id},
                ReturnValues="ALL_OLD"
            )

            return "Attributes" in response

        except ClientError as e:
            logger.error(f"Error deleting metadata from DynamoDB: {e}")
            raise

    def search_files(
            self,
            search_term: str = "",
            tags: List[str] = None,
            mime_types: List[str] = None
    ) -> List[FileModel]:
        """
        Searches for files based on metadata criteria

        Args:
            search_term: The text to search for
            tags: Optional list of tags to filter by
            mime_types: Optional list of MIME types to filter by

        Returns:
            List of matching file models
        """
        try:
            # Initialize filter conditions
            filter_expression = None

            # Add search term filter
            if search_term:
                filter_expression = (
                        Attr("name").contains(search_term) |
                        Attr("metadata").contains(search_term)
                )

            # Add tags filter
            if tags:
                tags_filter = None
                for tag in tags:
                    tag_condition = Attr("tags").contains(tag)
                    if tags_filter is None:
                        tags_filter = tag_condition
                    else:
                        tags_filter = tags_filter | tag_condition

                if filter_expression is None:
                    filter_expression = tags_filter
                else:
                    filter_expression = filter_expression & tags_filter

            # Add MIME type filter
            if mime_types:
                mime_filter = None
                for mime_type in mime_types:
                    mime_condition = Attr("mime_type").eq(mime_type)
                    if mime_filter is None:
                        mime_filter = mime_condition
                    else:
                        mime_filter = mime_filter | mime_condition

                if filter_expression is None:
                    filter_expression = mime_filter
                else:
                    filter_expression = filter_expression & mime_filter

            # Perform the scan operation
            if filter_expression:
                response = self.table.scan(
                    FilterExpression=filter_expression
                )
            else:
                response = self.table.scan()

            # Parse the results
            items = response.get("Items", [])
            file_models = []

            for item in items:
                # Parse the metadata JSON string
                if "metadata" in item and isinstance(item["metadata"], str):
                    item["metadata"] = json.loads(item["metadata"])

                # Create a FileModel
                file_models.append(FileModel.parse_obj(item))

            return file_models

        except ClientError as e:
            logger.error(f"Error searching files in DynamoDB: {e}")
            raise