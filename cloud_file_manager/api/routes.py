import datetime
import io
import json
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional, Any

from flask import Blueprint, Response, current_app, jsonify, redirect, request, url_for
from werkzeug.datastructures import FileStorage

from cloud_file_manager.metadata.metadata_extractor import MetadataExtractor
from cloud_file_manager.metadata.metadata_service import MetadataService
from cloud_file_manager.models.file_models import FileMetadata, FileModel
from cloud_file_manager.search.search_service import SearchFilters, SearchService
from cloud_file_manager.security.security_service import SecurityService
from cloud_file_manager.storage.storage_service import StorageService

logger = logging.getLogger(__name__)

# Create a blueprint for the API routes
api_bp = Blueprint("api", __name__)


@api_bp.route("/health", methods=["GET"])
def health_check() -> Response:
    """Health check endpoint"""
    return jsonify({"status": "ok"})


@api_bp.route("/files", methods=["POST"])
def upload_file() -> Response:
    """Upload file endpoint"""
    try:
        # Get services from app context
        storage_service: StorageService = current_app.config["STORAGE_SERVICE"]
        metadata_service: MetadataService = current_app.config["METADATA_SERVICE"]
        metadata_extractor: MetadataExtractor = current_app.config["METADATA_EXTRACTOR"]
        security_service: SecurityService = current_app.config["SECURITY_SERVICE"]

        # Check if the post request has the file part
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file: FileStorage = request.files["file"]

        # If user does not select file, browser submits an empty part
        if not file or file.filename == "":
            return jsonify({"error": "No file selected"}), 400

        # Get file information
        file_name = file.filename
        content_type = file.content_type or "application/octet-stream"
        file_size = file.content_length or 0

        # Get tags
        tags = request.form.get("tags", "").split(",")
        tags = [tag.strip() for tag in tags if tag.strip()]

        # Validate the file
        validation_result = security_service.validate_file(
            file_name=file_name,
            file_size=file_size,
            mime_type=content_type
        )

        if not validation_result.is_valid:
            return jsonify({"error": validation_result.message}), 400

        # Read the file into memory
        file_bytes = file.read()

        # Scan for viruses
        scan_result = security_service.scan_file(file_bytes)
        if not scan_result.is_clean:
            return jsonify({
                "error": f"File contains malicious content: {scan_result.message}"
            }), 400

        # Upload to S3
        file_io = io.BytesIO(file_bytes)
        object_key, version_id = storage_service.upload_file(
            file_name=file_name,
            content_type=content_type,
            file_data=file_io,
            metadata={
                "uploadedBy": "api",
                "fileSize": str(len(file_bytes))
            }
        )

        # Extract metadata
        metadata = metadata_extractor.extract_metadata(
            file_bytes=file_bytes,
            mime_type=content_type,
            file_name=file_name
        )

        # Create file model
        file_model = FileModel(
            name=file_name,
            size=len(file_bytes),
            mime_type=content_type,
            path=object_key,
            metadata=metadata,
            tags=tags
        )

        # Save metadata to DynamoDB
        file_id = metadata_service.save_metadata(file_model)

        # Generate a presigned URL for immediate access
        presigned_url = storage_service.generate_presigned_url(object_key)

        return jsonify({
            "fileId": file_id,
            "objectKey": object_key,
            "versionId": version_id,
            "url": presigned_url
        }), 201

    except Exception as e:
        logger.exception(f"Error uploading file: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/files/<file_id>", methods=["GET"])
def get_file_metadata(file_id: str) -> Response:
    """Get file metadata endpoint"""
    try:
        # Get services from app context
        metadata_service: MetadataService = current_app.config["METADATA_SERVICE"]

        # Get the file metadata
        file_model = metadata_service.get_metadata(file_id)

        if not file_model:
            return jsonify({"error": "File not found"}), 404

        return jsonify(file_model.dict())

    except Exception as e:
        logger.exception(f"Error getting file metadata: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/files/<file_id>/download", methods=["GET"])
def download_file(file_id: str) -> Response:
    """Download file endpoint"""
    try:
        # Get services from app context
        storage_service: StorageService = current_app.config["STORAGE_SERVICE"]
        metadata_service: MetadataService = current_app.config["METADATA_SERVICE"]

        # Get the file metadata
        file_model = metadata_service.get_metadata(file_id)

        if not file_model:
            return jsonify({"error": "File not found"}), 404

        # Generate a presigned URL for download
        presigned_url = storage_service.generate_presigned_url(file_model.path)

        # Redirect to the presigned URL
        return redirect(presigned_url)

    except Exception as e:
        logger.exception(f"Error downloading file: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/files/<file_id>", methods=["DELETE"])
def delete_file(file_id: str) -> Response:
    """Delete file endpoint"""
    try:
        # Get services from app context
        storage_service: StorageService = current_app.config["STORAGE_SERVICE"]
        metadata_service: MetadataService = current_app.config["METADATA_SERVICE"]

        # Get the file metadata
        file_model = metadata_service.get_metadata(file_id)

        if not file_model:
            return jsonify({"error": "File not found"}), 404

        # Delete from S3
        deleted = storage_service.delete_file(file_model.path)

        # Delete metadata from DynamoDB
        metadata_service.delete_metadata(file_id)

        return jsonify({"deleted": deleted})

    except Exception as e:
        logger.exception(f"Error deleting file: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/files/<file_id>/tags", methods=["PUT"])
def update_tags(file_id: str) -> Response:
    """Update file tags endpoint"""
    try:
        # Get services from app context
        metadata_service: MetadataService = current_app.config["METADATA_SERVICE"]

        # Get the file metadata
        file_model = metadata_service.get_metadata(file_id)

        if not file_model:
            return jsonify({"error": "File not found"}), 404

        # Get the new tags from the request
        request_data = request.get_json()
        if not request_data or "tags" not in request_data:
            return jsonify({"error": "Missing tags"}), 400

        tags = request_data["tags"]

        # Update the tags
        metadata_service.update_tags(file_id, tags)

        return jsonify({"updated": True})

    except Exception as e:
        logger.exception(f"Error updating tags: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/search", methods=["GET"])
def search_files() -> Response:
    """Search files endpoint"""
    try:
        # Get services from app context
        search_service: SearchService = current_app.config["SEARCH_SERVICE"]

        # Get search parameters
        query = request.args.get("q", "")
        tags = request.args.get("tags", "").split(",") if request.args.get("tags") else []
        mime_types = request.args.get("types", "").split(",") if request.args.get("types") else []
        categories = request.args.get("categories", "").split(",") if request.args.get("categories") else []

        # Parse date filters
        uploaded_after = None
        if request.args.get("after"):
            try:
                uploaded_after = datetime.strptime(request.args["after"], "%Y-%m-%d")
            except ValueError:
                pass

        uploaded_before = None
        if request.args.get("before"):
            try:
                uploaded_before = datetime.strptime(request.args["before"], "%Y-%m-%d")
            except ValueError:
                pass

        # Parse size filters
        min_size = int(request.args["minSize"]) if request.args.get("minSize") else None
        max_size = int(request.args["maxSize"]) if request.args.get("maxSize") else None

        # Create search filters
        filters = SearchFilters(
            tags=tags,
            categories=categories,
            mime_types=mime_types,
            uploaded_after=uploaded_after,
            uploaded_before=uploaded_before,
            min_size=min_size,
            max_size=max_size
        )

        # Perform the search
        results = search_service.search_files(query, filters)

        # Convert FileModel objects to dictionaries
        return jsonify([file.dict() for file in results])

    except Exception as e:
        logger.exception(f"Error searching files: {e}")
        return jsonify({"error": str(e)}), 500