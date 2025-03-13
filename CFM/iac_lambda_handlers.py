from aws_cdk import (
    Stack,
    aws_s3 as s3,
    aws_dynamodb as dynamodb,
    aws_lambda as lambda_,
    aws_apigateway as apigw,
    aws_iam as iam,
    RemovalPolicy,
    Duration,
)
from constructs import Construct

class FileManagerStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Create S3 bucket
        storage_bucket = s3.Bucket(
            self, "StorageBucket",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            cors=[s3.CorsRule(
                allowed_methods=[s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
                allowed_origins=["*"],
                allowed_headers=["*"]
            )]
        )

        # Create DynamoDB table
        metadata_table = dynamodb.Table(
            self, "MetadataTable",
            partition_key=dynamodb.Attribute(
                name="file_id",
                type=dynamodb.AttributeType.STRING
            ),
            removal_policy=RemovalPolicy.DESTROY,
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST
        )

        # Create Lambda functions
        upload_handler = lambda_.Function(
            self, "UploadHandler",
            runtime=lambda_.Runtime.PYTHON_3_9,
            code=lambda_.Code.from_asset("lambda/upload"),
            handler="index.handler",
            environment={
                "BUCKET_NAME": storage_bucket.bucket_name,
                "TABLE_NAME": metadata_table.table_name
            },
            timeout=Duration.seconds(30)
        )

        metadata_analyzer = lambda_.Function(
            self, "MetadataAnalyzer",
            runtime=lambda_.Runtime.PYTHON_3_9,
            code=lambda_.Code.from_asset("lambda/analyzer"),
            handler="index.handler",
            environment={
                "TABLE_NAME": metadata_table.table_name
            },
            timeout=Duration.minutes(5)
        )

        search_handler = lambda_.Function(
            self, "SearchHandler",
            runtime=lambda_.Runtime.PYTHON_3_9,
            code=lambda_.Code.from_asset("lambda/search"),
            handler="index.handler",
            environment={
                "TABLE_NAME": metadata_table.table_name
            },
            timeout=Duration.seconds(30)
        )

        # Grant permissions
        storage_bucket.grant_read_write(upload_handler)
        storage_bucket.grant_read(metadata_analyzer)
        metadata_table.grant_read_write_data(upload_handler)
        metadata_table.grant_read_write_data(metadata_analyzer)
        metadata_table.grant_read_data(search_handler)

        # Create API Gateway
        api = apigw.RestApi(
            self, "FileManagerApi",
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=["*"],
                allow_methods=["GET", "POST", "PUT", "DELETE"],
                allow_headers=["*"]
            )
        )

        files = api.root.add_resource("files")
        files.add_method("POST", apigw.LambdaIntegration(upload_handler))
        files.add_method("GET", apigw.LambdaIntegration(search_handler))
        
        # Add Rekognition and Textract permissions to metadata analyzer
        metadata_analyzer.add_to_role_policy(iam.PolicyStatement(
            actions=[
                "rekognition:DetectLabels",
                "rekognition:DetectText",
                "textract:DetectDocumentText",
                "textract:AnalyzeDocument"
            ],
            resources=["*"]
        ))