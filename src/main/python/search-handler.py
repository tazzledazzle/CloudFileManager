import boto3
import json
import os
from boto3.dynamodb.conditions import Key, Attr
from datetime import datetime, timedelta

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])

def handler(event, context):
    """Handle search requests for files and metadata"""
    try:
        # Parse query parameters
        params = event.get('queryStringParameters', {}) or {}
        
        # Build base query
        query_params = build_query(params)
        
        # Execute search
        response = table.scan(**query_params)
        
        # Process results
        results = process_results(response['Items'], params)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'results': results,
                'count': len(results),
                'last_evaluated_key': response.get('LastEvaluatedKey')
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': str(e)
            })
        }

def build_query(params):
    """Build DynamoDB query parameters based on search criteria"""
    filter_expression = None
    
    # Text search
    if 'query' in params:
        filter_expression = Attr('file_name').contains(params['query'])
        
        # Search in extracted text if available
        text_expr = Attr('text_content').contains(params['query']) if 'text_content' in params else None
        if text_expr:
            filter_expression = filter_expression | text_expr
    
    # File type filter
    if 'type' in params:
        type_expr = Attr('content_type').begins_with(params['type'])
        filter_expression = type_expr if not filter_expression else filter_expression & type_expr
    
    # Date range filter
    if 'date_from' in params or 'date_to' in params:
        date_expr = build_date_filter(params)
        filter_expression = date_expr if not filter_expression else filter_expression & date_expr
    
    # Size range filter
    if 'size_min' in params or 'size_max' in params:
        size_expr = build_size_filter(params)
        filter_expression = size_expr if not filter_expression else filter_expression & size_expr
    
    query_params = {
        'FilterExpression': filter_expression,
        'Limit': int(params.get('limit', 50))
    }
    
    # Pagination
    if 'last_key' in params:
        query_params['ExclusiveStartKey'] = json.loads(params['last_key'])
    
    return query_params

def build_date_filter(params):
    """Build date range filter expression"""
    date_from = params.get('date_from')
    date_to = params.get('date_to')
    
    if date_from and date_to:
        return Attr('last_modified').between(date_from, date_to)
    elif date_from:
        return Attr('last_modified').gte(date_from)
    else:
        return Attr('last_modified').lte(date_to)

def build_size_filter(params):
    """Build file size filter expression"""
    size_min = int(params.get('size_min', 0))
    size_max = int(params.get('size_max', float('inf')))
    
    if size_min and size_max < float('inf'):
        return Attr('size').between(size_min, size_max)
    elif size_min:
        return Attr('size').gte(size_min)
    else:
        return Attr('size').lte(size_max)

def process_results(items, params):
    """Process and format search results"""
    # Sort results if requested
    sort_key = params.get('sort_by', 'last_modified')
    sort_desc = params.get('sort_desc', 'true').lower() == 'true'
    
    sorted_items = sorted(
        items,
        key=lambda x: x.get(sort_key, ''),
        reverse=sort_desc
    )
    
    # Format results
    results = []
    for item in sorted_items:
        result = {
            'file_id': item['file_id'],
            'file_name': item['file_name'],
            'size': item['size'],
            'last_modified': item['last_modified'],
            'content_type': item['content_type']
        }
        
        # Add analysis results if available
        if 'labels' in item:
            result['labels'] = item['labels']
        if 'text_detected' in item:
            result['text_detected'] = item['text_detected']
        if 'text_content' in item:
            result['text_content'] = item['text_content']
            
        results.append(result)
    
    return results