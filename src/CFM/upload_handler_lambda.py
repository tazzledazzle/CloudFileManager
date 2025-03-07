import boto3
import json
import os
import uuid
import hashlib
import base64
import mimetypes
import re
from datetime import datetime, timedelta

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
lambda_client = boto3.client('lambda')
table = dynamodb.Table(os.environ['TABLE_NAME'])
bucket_name = os.environ['BUCKET_NAME']

# Config
MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024  # 5GB (S3 limit for single upload)
ALLOWED_EXTENSIONS = [
    # Documents
    '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.csv', '.xls', '.xlsx',
    # Images
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.svg',
    # Audio/Video
    '.mp3', '.wav', '.mp4', '.avi', '.mov', '.flv',
    # Archives
    '.zip', '.tar', '.gz', '.rar',
    # Other
    '.json', '.xml', '.html', '.css', '.js'
]

VIRUS_SCAN_ENDPOINT = os.environ.get('VIRUS_SCAN_ENDPOINT', None)

def handler(event, context):
    """Handle file upload requests"""
    try:
        # Determine request type
        http_method = event.get('httpMethod', 'GET')
        
        if http_method == 'GET':
            # Handle presigned URL generation
            return generate_presigned_url(event)
        elif http_method == 'POST':
            # Handle post-upload processing
            return process_upload(event)
        else:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Unsupported HTTP method'})
            }
            
    except Exception as e:
        print(f"Error in upload handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }

def generate_presigned_url(event):
    """Generate presigned URL for direct S3 upload"""
    params = event.get('queryStringParameters', {}) or {}
    
    # Validate required parameters
    if 'filename' not in params:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Filename is required'})
        }
    
    filename = params['filename']
    content_type = params.get('contentType', 'application/octet-stream')
    file_size = int(params.get('fileSize', 0))
    
    # Validate file extension
    file_extension = os.path.splitext(filename)[1].lower()
    if file_extension not in ALLOWED_EXTENSIONS:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': f'File type {file_extension} not allowed',
                'allowedTypes': ALLOWED_EXTENSIONS
            })
        }
    
    # Validate file size
    if file_size > MAX_FILE_SIZE:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'File size exceeds maximum allowed',
                'maxSize': MAX_FILE_SIZE
            })
        }
    
    # Generate unique key with folder structure
    date_prefix = datetime.now().strftime('%Y/%m/%d')
    file_id = str(uuid.uuid4())
    safe_filename = re.sub(r'[^\w\-\.]', '_', filename)
    key = f"{date_prefix}/{file_id}/{safe_filename}"
    
    # Generate presigned URL
    presigned_url = s3.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': bucket_name,
            'Key': key,
            'ContentType': content_type,
            'Metadata': {
                'original_filename': filename,
                'file_id': file_id
            }
        },
        ExpiresIn=3600  # URL expires in 1 hour
    )
    
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({
            'uploadUrl': presigned_url,
            'fileId': file_id,
            'key': key,
            'expiresIn': 3600
        })
    }

def process_upload(event):
    """Process a completed upload"""
    body = json.loads(event.get('body', '{}'))
    
    # Validate request
    if 'key' not in body:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'File key is required'})
        }
    
    key = body['key']
    
    try:
        # Get object metadata
        response = s3.head_object(Bucket=bucket_name, Key=key)
        
        # Generate file ID if not provided
        file_id = response.get('Metadata', {}).get('file_id', str(uuid.uuid4()))
        
        # Store initial metadata
        metadata = {
            'file_id': file_id,
            'file_name': os.path.basename(key),
            'key': key,
            'bucket': bucket_name,
            'size': response['ContentLength'],
            'content_type': response.get('ContentType', 'application/octet-stream'),
            'etag': response['ETag'].strip('"'),
            'last_modified': response['LastModified'].isoformat(),
            'upload_status': 'processing'
        }
        
        # Scan for viruses if configured
        if VIRUS_SCAN_ENDPOINT:
            scan_result = scan_file(bucket_name, key)
            metadata['scan_result'] = scan_result
            
            if scan_result.get('threat_detected', False):
                # Mark file as infected and prevent processing
                metadata['upload_status'] = 'infected'
                table.put_item(Item=metadata)
                
                # Delete infected file
                s3.delete_object(Bucket=bucket_name, Key=key)
                
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({
                        'error': 'Virus detected',
                        'scanResult': scan_result
                    })
                }
        
        # Store initial metadata
        table.put_item(Item=metadata)
        
        # Trigger metadata extraction as a separate Lambda
        trigger_metadata_extraction(bucket_name, key)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'message': 'File uploaded successfully',
                'fileId': file_id,
                'status': 'processing'
            })
        }
        
    except Exception as e:
        print(f"Error processing upload: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }

def scan_file(bucket, key):
    """Scan file for viruses using ClamAV or similar service"""
    if not VIRUS_SCAN_ENDPOINT:
        return {'scan_status': 'skipped'}
    
    try:
        # Generate presigned URL for virus scanning service
        presigned_url = s3.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': bucket,
                'Key': key
            },
            ExpiresIn=3600
        )
        
        # In a real implementation, you would call your virus scanning service here
        # For demonstration, we'll simulate a scan result
        
        # Mock implementation (replace with actual service call)
        import hashlib
        file_hash = hashlib.md5(f"{bucket}{key}".encode()).hexdigest()
        is_infected = file_hash.startswith('a')  # Simulate ~6% of files as infected
        
        result = {
            'scan_status': 'completed',
            'threat_detected': is_infected,
            'scan_timestamp': datetime.now().isoformat()
        }
        
        if is_infected:
            result['threat_name'] = 'DEMO-VIRUS'
            result['threat_level'] = 'high'
        
        return result
        
    except Exception as e:
        print(f"Error scanning file: {str(e)}")
        return {
            'scan_status': 'error',
            'error_message': str(e)
        }

def trigger_metadata_extraction(bucket, key):
    """Trigger metadata extraction Lambda"""
    try:
        # Simulate S3 event to trigger metadata analyzer
        event = {
            'Records': [
                {
                    's3': {
                        'bucket': {
                            'name': bucket
                        },
                        'object': {
                            'key': key
                        }
                    }
                }
            ]
        }
        
        # Invoke metadata analyzer Lambda asynchronously
        analyzer_function = os.environ.get('METADATA_ANALYZER_FUNCTION')
        if analyzer_function:
            lambda_client.invoke(
                FunctionName=analyzer_function,
                InvocationType='Event',
                Payload=json.dumps(event)
            )
        
    except Exception as e:
        print(f"Error triggering metadata extraction: {str(e)}")