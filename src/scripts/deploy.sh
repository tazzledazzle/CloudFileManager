#!/bin/bash

# Cloud File Manager Deployment Script

# Exit on any error
set -e

# Function to display usage
function display_usage {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -e, --environment <env>    Deployment environment (dev, test, prod) [default: dev]"
    echo "  -r, --region <region>      AWS region [default: us-east-1]"
    echo "  -b, --bucket <name>        S3 bucket name [default: cfm-files-<env>]"
    echo "  -t, --table <name>         DynamoDB table name [default: cfm-metadata-<env>]"
    echo "  -c, --cdk                  Use CDK for deployment"
    echo "  -m, --manual               Use manual deployment steps"
    echo "  -h, --help                 Display this help message"
    echo ""
}

# Default values
ENVIRONMENT="dev"
REGION="us-east-1"
BUCKET_NAME=""
TABLE_NAME=""
USE_CDK=false
USE_MANUAL=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        -e|--environment)
            ENVIRONMENT="$2"
            shift
            shift
            ;;
        -r|--region)
            REGION="$2"
            shift
            shift
            ;;
        -b|--bucket)
            BUCKET_NAME="$2"
            shift
            shift
            ;;
        -t|--table)
            TABLE_NAME="$2"
            shift
            shift
            ;;
        -c|--cdk)
            USE_CDK=true
            shift
            ;;
        -m|--manual)
            USE_MANUAL=true
            shift
            ;;
        -h|--help)
            display_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            display_usage
            exit 1
            ;;
    esac
done

# Set default bucket and table names if not provided
if [[ -z "$BUCKET_NAME" ]]; then
    BUCKET_NAME="cfm-files-$ENVIRONMENT"
fi

if [[ -z "$TABLE_NAME" ]]; then
    TABLE_NAME="cfm-metadata-$ENVIRONMENT"
fi

# Check if deployment method is specified
if [[ "$USE_CDK" == false && "$USE_MANUAL" == false ]]; then
    echo "Error: Please specify a deployment method (--cdk or --manual)"
    display_usage
    exit 1
fi

# Check if CDK and manual are both specified
if [[ "$USE_CDK" == true && "$USE_MANUAL" == true ]]; then
    echo "Error: Please specify only one deployment method (--cdk or --manual)"
    display_usage
    exit 1
fi

# Export environment variables
export AWS_REGION=$REGION
export CFM_ENVIRONMENT=$ENVIRONMENT
export BUCKET_NAME=$BUCKET_NAME
export METADATA_TABLE=$TABLE_NAME

echo "=== Cloud File Manager Deployment ==="
echo "Environment: $ENVIRONMENT"
echo "AWS Region: $REGION"
echo "S3 Bucket: $BUCKET_NAME"
echo "DynamoDB Table: $TABLE_NAME"
echo "=================================="

# Build the application
echo "Building application..."
./gradlew clean build

# Check if build was successful
if [[ $? -ne 0 ]]; then
    echo "Build failed! Exiting."
    exit 1
fi

echo "Build successful!"

# Deploy using CDK
if [[ "$USE_CDK" == true ]]; then
    echo "Deploying with AWS CDK..."

    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        echo "AWS CDK is not installed. Install it with: npm install -g aws-cdk"
        exit 1
    fi

    # Bootstrap CDK if needed
    echo "Bootstrapping CDK..."
    cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION

    # Deploy the stack
    echo "Deploying CDK stack..."
    cdk deploy --require-approval never

    if [[ $? -ne 0 ]]; then
        echo "CDK deployment failed! Exiting."
        exit 1
    fi

    echo "CDK deployment successful!"
fi

# Deploy manually
if [[ "$USE_MANUAL" == true ]]; then
    echo "Deploying manually..."

    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        echo "AWS CLI is not installed. Please install it first."
        exit 1
    fi

    # Create S3 bucket
    echo "Creating S3 bucket: $BUCKET_NAME"
    if aws s3api head-bucket --bucket $BUCKET_NAME 2>/dev/null; then
        echo "Bucket already exists, skipping creation."
    else
        aws s3api create-bucket \
            --bucket $BUCKET_NAME \
            --region $REGION

        # Enable versioning
        aws s3api put-bucket-versioning \
            --bucket $BUCKET_NAME \
            --versioning-configuration Status=Enabled
    fi

    # Create DynamoDB table
    echo "Creating DynamoDB table: $TABLE_NAME"
    if aws dynamodb describe-table --table-name $TABLE_NAME 2>/dev/null; then
        echo "Table already exists, skipping creation."
    else
        aws dynamodb create-table \
            --table-name $TABLE_NAME \
            --attribute-definitions AttributeName=id,AttributeType=S \
            --key-schema AttributeName=id,KeyType=HASH \
            --billing-mode PAY_PER_REQUEST \
            --region $REGION
    fi

    # Create IAM role for Lambda
    echo "Creating IAM role for Lambda..."
    ROLE_NAME="cfm-lambda-role-$ENVIRONMENT"

    if aws iam get-role --role-name $ROLE_NAME 2>/dev/null; then
        echo "Role already exists, skipping creation."
    else
        aws iam create-role \
            --role-name $ROLE_NAME \
            --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

        # Attach policies
        aws iam attach-role-policy \
            --role-name $ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

        aws iam attach-role-policy \
            --role-name $ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

        aws iam attach-role-policy \
            --role-name $ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess

        # Custom policy for ML services
        aws iam put-role-policy \
            --role-name $ROLE_NAME \
            --policy-name cfm-ml-permissions \
            --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["rekognition:DetectLabels","rekognition:DetectText","textract:AnalyzeDocument"],"Resource":"*"}]}'

        # Wait for role to be available
        echo "Waiting for role to be available..."
        sleep 10
    fi

    # Get the role ARN
    ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)

    # Create or update Lambda function
    FUNCTION_NAME="cfm-main-handler-$ENVIRONMENT"

    if aws lambda get-function --function-name $FUNCTION_NAME 2>/dev/null; then
        echo "Updating Lambda function: $FUNCTION_NAME"
        aws lambda update-function-code \
            --function-name $FUNCTION_NAME \
            --zip-file fileb://build/libs/cloud-file-manager.jar
    else
        echo "Creating Lambda function: $FUNCTION_NAME"
        aws lambda create-function \
            --function-name $FUNCTION_NAME \
            --zip-file fileb://build/libs/cloud-file-manager.jar \
            --handler com.cfm.lambda.MainLambdaHandler::handleRequest \
            --runtime java11 \
            --role $ROLE_ARN \
            --timeout 300 \
            --memory-size 1024 \
            --environment "Variables={BUCKET_NAME=$BUCKET_NAME,METADATA_TABLE=$TABLE_NAME,CFM_ENVIRONMENT=$ENVIRONMENT,AWS_REGION=$REGION}"
    fi

    # Set up S3 trigger for metadata extraction
    echo "Setting up S3 trigger for Lambda function..."

    # Add permission for S3 to invoke Lambda
    aws lambda add-permission \
        --function-name $FUNCTION_NAME \
        --statement-id s3-trigger \
        --action lambda:InvokeFunction \
        --principal s3.amazonaws.com \
        --source-arn arn:aws:s3:::$BUCKET_NAME \
        --source-account $(aws sts get-caller-identity --query 'Account' --output text) \
        2>/dev/null || true  # Ignore if permission already exists

    # Configure S3 event notification
    LAMBDA_ARN=$(aws lambda get-function --function-name $FUNCTION_NAME --query 'Configuration.FunctionArn' --output text)

    aws s3api put-bucket-notification-configuration \
        --bucket $BUCKET_NAME \
        --notification-configuration "{\"LambdaFunctionConfigurations\":[{\"LambdaFunctionArn\":\"$LAMBDA_ARN\",\"Events\":[\"s3:ObjectCreated:*\"]}]}"

    # Create API Gateway
    echo "Creating API Gateway..."
    API_NAME="CFM-API-$ENVIRONMENT"

    # Check if API already exists
    API_ID=$(aws apigateway get-rest-apis --query "items[?name=='$API_NAME'].id" --output text)

    if [[ -z "$API_ID" ]]; then
        echo "Creating new API Gateway: $API_NAME"
        API_ID=$(aws apigateway create-rest-api \
            --name "$API_NAME" \
            --description "API for Cloud File Manager ($ENVIRONMENT)" \
            --region $REGION \
            --query 'id' --output text)
    else
        echo "API Gateway already exists: $API_NAME"
    fi

    # Get root resource ID
    ROOT_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --query 'items[?path==`/`].id' --output text)

    # Create 'files' resource if it doesn't exist
    FILES_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --query "items[?path=='/files'].id" --output text)

    if [[ -z "$FILES_RESOURCE_ID" ]]; then
        echo "Creating 'files' resource..."
        FILES_RESOURCE_ID=$(aws apigateway create-resource \
            --rest-api-id $API_ID \
            --parent-id $ROOT_RESOURCE_ID \
            --path-part "files" \
            --query 'id' --output text)
    fi

    # Create or update POST method for file upload
    echo "Configuring API Gateway methods..."

    # Check if POST method exists
    POST_METHOD=$(aws apigateway get-method --rest-api-id $API_ID --resource-id $FILES_RESOURCE_ID --http-method POST 2>/dev/null || echo "")

    if [[ -z "$POST_METHOD" ]]; then
        echo "Creating POST method for /files..."
        aws apigateway put-method \
            --rest-api-id $API_ID \
            --resource-id $FILES_RESOURCE_ID \
            --http-method POST \
            --authorization-type NONE

        aws apigateway put-integration \
            --rest-api-id $API_ID \
            --resource-id $FILES_RESOURCE_ID \
            --http-method POST \
            --type AWS_PROXY \
            --integration-http-method POST \
            --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations"
    fi

    # Create additional resources and methods
    # (This is abbreviated - in a real script you would create all required resources)

    # Create 'search' resource
    SEARCH_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --query "items[?path=='/search'].id" --output text)

    if [[ -z "$SEARCH_RESOURCE_ID" ]]; then
        echo "Creating 'search' resource..."
        SEARCH_RESOURCE_ID=$(aws apigateway create-resource \
            --rest-api-id $API_ID \
            --parent-id $ROOT_RESOURCE_ID \
            --path-part "search" \
            --query 'id' --output text)
    fi

    # Create GET method for search
    GET_SEARCH_METHOD=$(aws apigateway get-method --rest-api-id $API_ID --resource-id $SEARCH_RESOURCE_ID --http-method GET 2>/dev/null || echo "")

    if [[ -z "$GET_SEARCH_METHOD" ]]; then
        echo "Creating GET method for /search..."
        aws apigateway put-method \
            --rest-api-id $API_ID \
            --resource-id $SEARCH_RESOURCE_ID \
            --http-method GET \
            --authorization-type NONE

        aws apigateway put-integration \
            --rest-api-id $API_ID \
            --resource-id $SEARCH_RESOURCE_ID \
            --http-method GET \
            --type AWS_PROXY \
            --integration-http-method POST \
            --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations"
    fi

    # Deploy API
    echo "Deploying API Gateway..."
    aws apigateway create-deployment \
        --rest-api-id $API_ID \
        --stage-name $ENVIRONMENT

    # Add permission for API Gateway to invoke Lambda
    aws lambda add-permission \
        --function-name $FUNCTION_NAME \
        --statement-id apigateway-trigger \
        --action lambda:InvokeFunction \
        --principal apigateway.amazonaws.com \
        --source-arn "arn:aws:execute-api:$REGION:$(aws sts get-caller-identity --query 'Account' --output text):$API_ID/*" \
        2>/dev/null || true  # Ignore if permission already exists

    # Get the API URL
    API_URL="https://$API_ID.execute-api.$REGION.amazonaws.com/$ENVIRONMENT"

    echo "Manual deployment completed!"
    echo "API URL: $API_URL"
fi

echo "Deployment completed successfully!"