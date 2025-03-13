from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Union
from uuid import uuid4

from dataclasses_json import DataClassJsonMixin
from pydantic import BaseModel, Field


class EntityType(str, Enum):
    PERSON = "PERSON"
    ORGANIZATION = "ORGANIZATION"
    LOCATION = "LOCATION"
    DATE = "DATE"
    PHONE_NUMBER = "PHONE_NUMBER"
    EMAIL = "EMAIL"
    URL = "URL"
    OTHER = "OTHER"


class Entity(BaseModel):
    """Represents an entity extracted from text"""
    text: str
    type: EntityType
    confidence: float


class BoundingBox(BaseModel):
    """Represents a bounding box location in an image"""
    top: float
    left: float
    width: float
    height: float


class DetectedObject(BaseModel):
    """Represents an object detected in an image"""
    name: str
    confidence: float
    bounding_box: Optional[BoundingBox] = None


class ImageMetadata(BaseModel):
    """Represents metadata specific to images"""
    width: Optional[int] = None
    height: Optional[int] = None
    detected_objects: List[DetectedObject] = Field(default_factory=list)
    dominant_colors: List[str] = Field(default_factory=list)
    contains_text: bool = False
    extracted_image_text: Optional[str] = None


class Table(BaseModel):
    """Represents a table extracted from a document"""
    id: str
    page_number: int
    headers: List[str] = Field(default_factory=list)
    rows: List[List[str]] = Field(default_factory=list)


class DocumentMetadata(BaseModel):
    """Represents metadata specific to documents"""
    page_count: Optional[int] = None
    document_type: Optional[str] = None
    key_value_pairs: Dict[str, str] = Field(default_factory=dict)
    tables: List[Table] = Field(default_factory=list)


class FileMetadata(BaseModel):
    """Represents metadata extracted from a file"""
    content_type: str
    extracted_text: Optional[str] = None
    entities: List[Entity] = Field(default_factory=list)
    categories: List[str] = Field(default_factory=list)
    image_data: Optional[ImageMetadata] = None
    document_data: Optional[DocumentMetadata] = None
    custom_attributes: Dict[str, str] = Field(default_factory=dict)


class FileVersion(BaseModel):
    """Represents a version of a file"""
    version_id: str
    created_at: str
    size: int
    is_latest: bool = False


class FileModel(BaseModel):
    """Represents a file stored in the system with its metadata"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    size: int
    mime_type: str
    uploaded_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    path: str
    metadata: FileMetadata
    tags: List[str] = Field(default_factory=list)
    versions: List[FileVersion] = Field(default_factory=list)

    class Config:
        json_encoders = {
            datetime: lambda dt: dt.isoformat()
        }