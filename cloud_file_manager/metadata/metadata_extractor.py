import logging
import re
from io import BytesIO
from typing import Dict, List, Optional, Tuple

import boto3
from botocore.exceptions import ClientError

from cloud_file_manager.models.file_models import (
    BoundingBox,
    DetectedObject,
    DocumentMetadata,
    Entity,
    EntityType,
    FileMetadata,
    ImageMetadata,
    Table,
)

logger = logging.getLogger(__name__)


class MetadataExtractor:
    """Service for extracting metadata from different file types using AWS services"""

    def __init__(self, region_name: str = "us-east-1"):
        self.region_name = region_name
        self.rekognition_client = boto3.client("rekognition", region_name=region_name)
        self.textract_client = boto3.client("textract", region_name=region_name)

    def extract_metadata(
            self, file_bytes: bytes, mime_type: str, file_name: str
    ) -> FileMetadata:
        """
        Extracts metadata from a file based on its MIME type

        Args:
            file_bytes: The file content as bytes
            mime_type: The MIME type of the file
            file_name: The name of the file

        Returns:
            The extracted metadata
        """
        try:
            # Determine the type of file and extract appropriate metadata
            if mime_type.startswith("image/"):
                return self._extract_image_metadata(file_bytes)
            elif mime_type.startswith("application/pdf"):
                return self._extract_document_metadata(file_bytes)
            elif "document" in mime_type or "spreadsheet" in mime_type:
                return self._extract_document_metadata(file_bytes)
            else:
                return FileMetadata(content_type=mime_type)

        except Exception as e:
            logger.error(f"Error extracting metadata: {e}")
            # Return basic metadata if extraction fails
            return FileMetadata(content_type=mime_type)

    def _extract_image_metadata(self, file_bytes: bytes) -> FileMetadata:
        """
        Extracts metadata from an image file

        Args:
            file_bytes: The image file content

        Returns:
            The extracted image metadata
        """
        try:
            # Detect labels (objects) in the image
            labels_response = self.rekognition_client.detect_labels(
                Image={"Bytes": file_bytes},
                MaxLabels=20,
                MinConfidence=70,
            )

            # Extract detected objects
            detected_objects = []
            for label in labels_response.get("Labels", []):
                # Get the first instance of the object (if available)
                bounding_box = None
                if label.get("Instances") and len(label["Instances"]) > 0:
                    instance = label["Instances"][0]
                    box = instance.get("BoundingBox")
                    if box:
                        bounding_box = BoundingBox(
                            top=box.get("Top", 0),
                            left=box.get("Left", 0),
                            width=box.get("Width", 0),
                            height=box.get("Height", 0),
                        )

                detected_objects.append(
                    DetectedObject(
                        name=label.get("Name", ""),
                        confidence=label.get("Confidence", 0),
                        bounding_box=bounding_box,
                    )
                )

            # Detect text in the image
            text_response = self.rekognition_client.detect_text(
                Image={"Bytes": file_bytes}
            )

            # Extract text lines
            extracted_text = "\n".join(
                [
                    text.get("DetectedText", "")
                    for text in text_response.get("TextDetections", [])
                    if text.get("Type") == "LINE"
                ]
            )

            # Create categories based on detected labels
            categories = [
                label.get("Name")
                for label in labels_response.get("Labels", [])
                if label.get("Confidence", 0) > 90
            ]

            # Extract entities from detected text
            entities = self._extract_entities_from_text(extracted_text)

            # Create image metadata
            image_metadata = ImageMetadata(
                detected_objects=detected_objects,
                contains_text=bool(extracted_text),
                extracted_image_text=extracted_text,
            )

            return FileMetadata(
                content_type="image",
                extracted_text=extracted_text,
                entities=entities,
                categories=categories,
                image_data=image_metadata,
            )

        except ClientError as e:
            logger.error(f"Error extracting image metadata: {e}")
            return FileMetadata(content_type="image")

    def _extract_document_metadata(self, file_bytes: bytes) -> FileMetadata:
        """
        Extracts metadata from a document file

        Args:
            file_bytes: The document file content

        Returns:
            The extracted document metadata
        """
        try:
            # Analyze document using Textract
            response = self.textract_client.analyze_document(
                Document={"Bytes": file_bytes},
                FeatureTypes=["TABLES", "FORMS"],
            )

            # Extract text content
            blocks = response.get("Blocks", [])
            text_blocks = [block for block in blocks if block.get("BlockType") == "LINE"]
            extracted_text = "\n".join(
                [block.get("Text", "") for block in text_blocks]
            )

            # Extract key-value pairs (forms)
            key_value_pairs = {}
            key_map = {}
            value_map = {}

            # First pass: collect keys and values
            for block in blocks:
                if block.get("BlockType") == "KEY":
                    key_map[block.get("Id")] = block.get("Text", "")
                elif block.get("BlockType") == "VALUE":
                    value_map[block.get("Id")] = block.get("Text", "")

            # Second pass: match keys with values
            for block in blocks:
                if block.get("BlockType") == "KEY_VALUE_SET":
                    relationships = block.get("Relationships", [])
                    key_id = None
                    value_id = None

                    for relationship in relationships:
                        if relationship.get("Type") == "CHILD":
                            ids = relationship.get("Ids", [])
                            if ids:
                                key_id = ids[0]
                        elif relationship.get("Type") == "VALUE":
                            ids = relationship.get("Ids", [])
                            if ids:
                                value_id = ids[0]

                    if key_id and value_id:
                        key = key_map.get(key_id)
                        value = value_map.get(value_id)
                        if key and value:
                            key_value_pairs[key] = value

            # Extract tables (simplified)
            tables = []

            # Extract entities
            entities = self._extract_entities_from_text(extracted_text)

            # Determine document type
            document_type = self._determine_document_type(extracted_text, key_value_pairs)

            # Create document metadata
            document_metadata = DocumentMetadata(
                document_type=document_type,
                key_value_pairs=key_value_pairs,
                tables=tables,
            )

            return FileMetadata(
                content_type="document",
                extracted_text=extracted_text,
                entities=entities,
                categories=[document_type],
                document_data=document_metadata,
            )

        except ClientError as e:
            logger.error(f"Error extracting document metadata: {e}")
            return FileMetadata(content_type="document")

    def _determine_document_type(
            self, text: str, key_value_pairs: Dict[str, str]
    ) -> str:
        """
        Attempts to determine the document type based on content

        Args:
            text: The extracted text
            key_value_pairs: Key-value pairs extracted from the document

        Returns:
            The determined document type
        """
        text_lower = text.lower()

        if "invoice" in text_lower or any(
                "invoice" in key.lower() for key in key_value_pairs.keys()
        ):
            return "invoice"
        elif "receipt" in text_lower or any(
                ("total" in key.lower() and "amount" in key.lower())
                for key in key_value_pairs.keys()
        ):
            return "receipt"
        elif "contract" in text_lower or "agreement" in text_lower:
            return "contract"
        elif "resume" in text_lower or "cv" in text_lower or "curriculum vitae" in text_lower:
            return "resume"
        else:
            return "document"

    def _extract_entities_from_text(self, text: str) -> List[Entity]:
        """
        Extracts entities from text using basic pattern matching

        Args:
            text: The text to analyze

        Returns:
            List of extracted entities
        """
        entities = []

        # Email regex
        email_regex = r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
        for match in re.finditer(email_regex, text):
            entities.append(
                Entity(
                    text=match.group(0),
                    type=EntityType.EMAIL,
                    confidence=0.9,
                )
            )

        # Phone number regex
        phone_regex = r"\+?[0-9]{10,12}"
        for match in re.finditer(phone_regex, text):
            entities.append(
                Entity(
                    text=match.group(0),
                    type=EntityType.PHONE_NUMBER,
                    confidence=0.8,
                )
            )

        # URL regex
        url_regex = r"https?://[\w.-]+(?:\.[\w.-]+)+[\w\-._~:/?#[\]@!$&'()*+,;=]*"
        for match in re.finditer(url_regex, text):
            entities.append(
                Entity(
                    text=match.group(0),
                    type=EntityType.URL,
                    confidence=0.9,
                )
            )

        # Date regex
        date_regex = r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}"
        for match in re.finditer(date_regex, text):
            entities.append(
                Entity(
                    text=match.group(0),
                    type=EntityType.DATE,
                    confidence=0.7,
                )
            )

        return entities