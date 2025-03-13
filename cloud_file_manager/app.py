import logging
import os
from typing import Dict, Any

import boto3
from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS

from cloud_file_manager.api.routes import api_bp
from cloud_file_manager.metadata.metadata_extractor import MetadataExtractor
from cloud_file_manager.metadata.metadata_service import MetadataService
from cloud_file_manager.search.search_service import SearchService
from cloud_file_manager.security.security_service import SecurityService
from cloud_file_manager.storage.storage_service import StorageService
from cloud_file_manager.utils.config import Config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def create_app(config: Dict[str, Any] = None) -> Flask:
    """
    Create and configure the Flask application

    Args:
        config: Optional configuration override

    Returns:
        The configured Flask application
    """
    # Load environment variables
    load_dotenv()

    # Create Flask app
    app = Flask(__name__, static_folder="static", template_folder="templates")

    # Enable CORS
    CORS(app)

    # Load configuration
    app_config = Config.get_config()
    if config:
        app_config.update(config)
    app.config.update(app_config)

    # Register blueprints
    app.register_blueprint(api_bp, url_prefix="/api")

    # Initialize services
    init_services(app)

    # Register error handlers
    register_error_handlers(app)

    return app


def init_services(app: Flask) -> None:
    """
    Initialize and register services with the Flask application

    Args:
        app: The Flask application
    """
    # Get configuration
    bucket_name = app.config.get("S3_BUCKET_NAME")
    metadata_table_name = app.config.get("DYNAMODB_TABLE_NAME")
    region_name = app.config.get("AWS_REGION", "us-east-1")

    # Initialize services
    storage_service = StorageService(bucket_name, region_name)
    metadata_service = MetadataService(metadata_table_name, region_name)
    metadata_extractor = MetadataExtractor(region_name)
    security_service = SecurityService()
    search_service = SearchService(metadata_service)

    # Add services to app config
    app.config["STORAGE_SERVICE"] = storage_service
    app.config["METADATA_SERVICE"] = metadata_service
    app.config["METADATA_EXTRACTOR"] = metadata_extractor
    app.config["SECURITY_SERVICE"] = security_service
    app.config["SEARCH_SERVICE"] = search_service

    logger.info("Services initialized")


def register_error_handlers(app: Flask) -> None:
    """
    Register error handlers for the Flask application

    Args:
        app: The Flask application
    """
    @app.errorhandler(400)
    def handle_bad_request(e):
        return {"error": "Bad request"}, 400

    @app.errorhandler(404)
    def handle_not_found(e):
        return {"error": "Not found"}, 404

    @app.errorhandler(500)
    def handle_server_error(e):
        return {"error": "Internal server error"}, 500


def main() -> None:
    """Main entry point for running the application"""
    app = create_app()
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    host = os.environ.get("FLASK_HOST", "0.0.0.0")
    port = int(os.environ.get("FLASK_PORT", "5000"))

    logger.info(f"Starting application on {host}:{port} (debug={debug})")
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()