import boto3
import json
import os
import subprocess
import tempfile
import time
import shutil
import uuid
import logging
import base64
from datetime import datetime

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
sns = boto3.client('sns')

# Environment variables
QUARANTINE_BUCKET = os.environ.get('QUARANTINE_BUCKET')
METADATA_TABLE = os.environ.get('METADATA_TABLE')
NOTIFICATION_TOPIC = os.environ.get('NOTIFICATION_TOPIC')

# Lambda's temp directory for downloads
TEMP_DIR = '/tmp'
VIRUS_DB_PATH = '/tmp/virus-db'

def handler(event, context):
    """Handler for virus scanning Lambda function"""
    try:
        # Process S3 event
        records = event.get('Records', [])
        results = []
        
        for record in records:
            # Extract S3 bucket and key
            if 's3' not in record:
                continue
                
            bucket = record['s3']['bucket']['name']
            key = record['s3']['object']['key']
            
            logger.info(f"Processing file: s3://{bucket}/{key}")
            
            # Skip very large files (adjust threshold as needed)
            file_size = get_file_size(bucket, key)
            if file_size > 500 * 1024 * 1024:  # 500MB
                logger.warning(f"File too large for scanning: {file_size} bytes")
                results.append({
                    'bucket': bucket, 
                    'key': key,
                    'status': 'skipped',
                    'reason': 'file too large'
                })
                continue
            
            # Scan the file
            scan_result = scan_s3_file(bucket, key)
            results.append(scan_result)
            
            # Update metadata in DynamoDB
            update_metadata(bucket, key, scan_result)
            
            # Take action based on scan results
            if scan_result.get('threat_detected', False):
                handle_infected_file(bucket, key, scan_result)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Virus scan completed',
                'results': results
            })
        }
        
    except Exception as e:
        logger.error(f"Error in virus scanner: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e)
            })
        }

def get_file_size(bucket, key):
    """Get file size from S3 metadata"""
    response = s3.head_object(Bucket=bucket, Key=key)
    return response['ContentLength']

def scan_s3_file(bucket, key):
    """Download and scan an S3 file for viruses"""
    scan_id = str(uuid.uuid4())
    download_path = os.path.join(TEMP_DIR, scan_id)
    
    try:
        # Download file
        logger.info(f"Downloading file: {bucket}/{key}")
        s3.download_file(bucket, key, download_path)
        
        # Ensure ClamAV is available
        ensure_clamav()
        
        # Scan the file
        logger.info(f"Scanning file: {download_path}")
        result = run_clamav_scan(download_path)
        
        scan_result = {
            'bucket': bucket,
            'key': key,
            'scan_id': scan_id,
            'scan_timestamp': datetime.now().isoformat(),
            'scan_status': 'completed',
            'threat_detected': result['infected'],
            'scanner': 'clamav',
            'scanner_version': result.get('version', 'unknown')
        }
        
        if result['infected']:
            scan_result.update({
                'threat_name': result.get('threat_name', 'Unknown threat'),
                'threat_level': 'high'  # Default to high for any detected threat
            })
            
        return scan_result
        
    except Exception as e:
        logger.error(f"Error scanning file: {str(e)}")
        return {
            'bucket': bucket,
            'key': key,
            'scan_id': scan_id,
            'scan_timestamp': datetime.now().isoformat(),
            'scan_status': 'error',
            'error_message': str(e)
        }
    finally:
        # Clean up
        if os.path.exists(download_path):
            os.remove(download_path)

def ensure_clamav():
    """Ensure ClamAV is installed and virus definitions are up to date"""
    # In a real implementation, you would:
    # 1. Use a Lambda layer with ClamAV pre-installed
    # 2. Maintain virus definitions in S3 and download if needed
    # 3. Use freshclam to update definitions periodically
    
    # Simulated implementation
    if not os.path.exists('/usr/bin/clamscan'):
        logger.info("ClamAV not detected, simulating installation")
        
    if not os.path.exists(VIRUS_DB_PATH):
        os.makedirs(VIRUS_DB_PATH, exist_ok=True)
        logger.info("Creating virus database directory")
    
    # In a real implementation, check database age and update if needed

def run_clamav_scan(file_path):
    """Run ClamAV scan on a file"""
    # In a real implementation, this would execute clamscan
    # command = ['/usr/bin/clamscan', '--database=' + VIRUS_DB_PATH, '-v', file_path]
    # output = subprocess.check_output(command, stderr=subprocess.STDOUT)
    
    # Simulated implementation
    logger.info(f"Simulating virus scan on {file_path}")
    time.sleep(1)  # Simulate scan time
    
    # Generate deterministic result based on file content
    with open(file_path, 'rb') as f:
        content = f.read(4096)  # Read first 4KB
        file_hash = hash(content)
    
    # Simulate ~2% infection rate
    infected = (file_hash % 50 == 0)
    
    if infected:
        threat_name = f"EICAR-Test-Signature-{file_hash % 10}"
        result = {
            'infected': True,
            'threat_name': threat_name,
            'version': '0.103.7',
            'scan_time': 1.2
        }
    else:
        result = {
            'infected': False,
            'version': '0.103.7',
            'scan_time': 0.8
        }
    
    logger.info(f"Scan result: {result}")
    return result

def update_metadata(bucket, key, scan_result):
    """Update file metadata with scan results"""
    try:
        table = dynamodb.Table(METADATA_TABLE)
        
        # Try to find the file metadata by key
        response = table.scan(
            FilterExpression="key = :key AND bucket = :bucket",
            ExpressionAttributeValues={
                ":key": key,
                ":bucket": bucket
            }
        )
        
        items = response.get('Items', [])
        if items:
            file_metadata = items[0]
            file_id = file_metadata['file_id']
            
            # Update the metadata with scan results
            table.update_item(
                Key={'file_id': file_id},
                UpdateExpression="set scan_result = :r, upload_status = :s",
                ExpressionAttributeValues={
                    ":r": scan_result,
                    ":s": "infected" if scan_result.get('threat_detected', False) else "available"
                }
            )
            
            logger.info(f"Updated metadata for file_id: {file_id}")
        else:
            logger.warning(f"No metadata found for {bucket}/{key}")
            
    except Exception as e:
        logger.error(f"Error updating metadata: {str(e)}")

def handle_infected_file(bucket, key, scan_result):
    """Handle an infected file according to security policy"""
    try:
        # 1. Move to quarantine bucket if configured
        if QUARANTINE_BUCKET:
            quarantine_key = f"infected/{datetime.now().strftime('%Y%m%d')}/{os.path.basename(key)}"
            
            # Copy to quarantine
            s3.copy_object(
                Bucket=QUARANTINE_BUCKET,
                Key=quarantine_key,
                CopySource={'Bucket': bucket, 'Key': key},
                Metadata={
                    'threat_name': scan_result.get('threat_name', 'unknown'),
                    'scan_id': scan_result.get('scan_id', 'unknown'),
                    'original_bucket': bucket,
                    'original_key': key
                },
                MetadataDirective='REPLACE'
            )
            
            logger.info(f"Moved infected file to quarantine: {QUARANTINE_BUCKET}/{quarantine_key}")
            
            # Delete from original location
            s3.delete_object(Bucket=bucket, Key=key)
            logger.info(f"Deleted infected file from original location: {bucket}/{key}")
        
        # 2. Send notification
        if NOTIFICATION_TOPIC:
            sns.publish(
                TopicArn=NOTIFICATION_TOPIC,
                Subject=f"Virus detected: {scan_result.get('threat_name', 'Unknown threat')}",
                Message=json.dumps({
                    'message': 'Malware detected in uploaded file',
                    'file': f"{bucket}/{key}",
                    'scan_result': scan_result,
                    'timestamp': datetime.now().isoformat()
                })
            )
            logger.info(f"Sent notification for infected file")
            
    except Exception as e:
        logger.error(f"Error handling infected file: {str(e)}")