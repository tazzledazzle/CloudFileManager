# Cloud File Manager User Manual

## Introduction
The Cloud File Manager is a powerful tool for storing, analyzing, and managing files in the cloud. It automatically extracts metadata and provides intelligent search capabilities for your files.

## Getting Started

### System Requirements
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection
- API key for authentication

### Initial Setup
1. Request an API key from your administrator
2. Install the command-line tool (optional):
```bash
pip install cloud-file-manager-cli
```

## Using the Web Interface

### File Upload
1. Navigate to the web interface
2. Click "Upload Files" button
3. Select files or drag and drop
4. Wait for upload and analysis to complete

### Search Files
1. Use the search bar for basic search
2. Click "Advanced Search" for filters:
   - File type
   - Date range
   - File size
   - Content tags
   - Extracted text

### View File Details
1. Click on any file to view:
   - Basic metadata
   - Extracted text
   - Detected objects (images)
   - Document analysis
   - Version history

## Using the CLI

### Basic Commands
```bash
# Upload file
cfm upload file.pdf

# Search files
cfm search "keyword"

# Download file
cfm download file-id

# List recent files
cfm list --limit 10

# Get file metadata
cfm metadata file-id
```

### Advanced Features
```bash
# Batch upload
cfm upload-batch ./directory

# Export metadata
cfm export-metadata --format json

# Set retention policy
cfm set-retention file-id --days 30

# Generate sharing link
cfm share file-id --expires 24h
```

## API Integration

### Authentication
```python
import requests

headers = {
    'Authorization': 'Bearer your-api-key'
}

response = requests.get('https://api.filemanager.com/files', headers=headers)
```

### Example Requests
```python
# Upload file
files = {'file': open('document.pdf', 'rb')}
response = requests.post('https://api.filemanager.com/files', files=files, headers=headers)

# Search files
params = {
    'query': 'important',