import boto3
import json
import os
import mimetypes
import hashlib
from datetime import datetime

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
rekognition = boto3.client('rekognition')
textract = boto3.client('textract')
table = dynamodb.Table(os.environ['TABLE_NAME'])

def handler(event, context):
    """Handler for processing file uploads and extracting metadata"""
    try:
        # Get file information from S3 event
        bucket = event['Records'][0]['s3']['bucket']['name']
        key = event['Records'][0]['s3']['object']['key']

        # Generate unique file ID
        file_id = hashlib.md5(f"{bucket}{key}{datetime.now()}".encode()).hexdigest()

        # Get basic file metadata
        response = s3.head_object(Bucket=bucket, Key=key)
        basic_metadata = {
            'file_id': file_id,
            'file_name': key,
            'size': response['ContentLength'],
            'last_modified': response['LastModified'].isoformat(),
            'content_type': response.get('ContentType', 'application/octet-stream'),
            'etag': response['ETag'],
        }

        # Detect file type and process accordingly
        content_type = basic_metadata['content_type']
        enhanced_metadata = {}

        if content_type.startswith('image/'):
            enhanced_metadata = process_image(bucket, key)
        elif content_type.startswith('application/pdf') or content_type.startswith('text/'):
            enhanced_metadata = process_document(bucket, key)

        # Combine and store metadata
        metadata = {**basic_metadata, **enhanced_metadata}
        store_metadata(metadata)

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Metadata extraction complete',
                'file_id': file_id
            })
        }

    except Exception as e:
        print(f"Error processing file: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e)
            })
        }

def process_image(bucket, key):
    """Process image files using Rekognition"""
    try:
        # Detect labels
        label_response = rekognition.detect_labels(
            Image={'S3Object': {'Bucket': bucket, 'Name': key}},
            MaxLabels=10,
            MinConfidence=70
        )

        # Detect text in image
        text_response = rekognition.detect_text(
            Image={'S3Object': {'Bucket': bucket, 'Name': key}}
        )

        return {
            'labels': [label['Name'] for label in label_response['Labels']],
            'text_detected': [text['DetectedText'] for text in text_response['TextDetections']],
            'analysis_type': 'image'
        }

    except Exception as e:
        print(f"Error processing image: {str(e)}")
        return {'analysis_type': 'image', 'error': str(e)}

def process_document(bucket, key):
    """Process documents using Textract"""
    try:
        # Detect document text
        response = textract.detect_document_text(
            Document={'S3Object': {'Bucket': bucket, 'Name': key}}
        )

        # Extract text blocks
        text_blocks = []
        for block in response['Blocks']:
            if block['BlockType'] == 'LINE':
                text_blocks.append(block['Text'])

        return {
            'text_content': text_blocks,
            'page_count': len(set(block['Page'] for block in response['Blocks'] if 'Page' in block)),
            'analysis_type': 'document'
        }

    except Exception as e:
        print(f"Error processing document: {str(e)}")
        return {'analysis_type': 'document', 'error': str(e)}

def store_metadata(metadata):
    """Store extracted metadata in DynamoDB"""
    try:
        table.put_item(Item=metadata)
    except Exception as e:
        print(f"Error storing metadata: {str(e)}")
        raise e