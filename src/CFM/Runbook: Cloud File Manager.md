# Cloud File Manager Runbook

## Prerequisites
- AWS Account with free tier access
- AWS CLI installed and configured
- Python 3.9 or later
- Node.js 14.x or later
- AWS CDK CLI installed (`npm install -g aws-cdk`)

## Initial Setup

1. Create and activate a virtual environment:
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

2. Install required dependencies:
```bash
pip install aws-cdk-lib constructs pytest
```

3. Create project structure:
```bash
mkdir -p lambda/{upload,analyzer,search}
touch lambda/upload/index.py
touch lambda/analyzer/index.py
touch lambda/search/index.py
```

4. Bootstrap AWS CDK in your account:
```bash
cdk bootstrap
```

## Deployment

1. Review and update configurations in `cdk.json` if needed
2. Deploy the stack:
```bash
cdk deploy
```

3. Note the outputs (API Gateway URL, S3 bucket name)

## Monitoring

1. Set up CloudWatch Alarms:
   - Lambda function errors
   - API Gateway 4xx/5xx errors
   - S3 bucket size
   - DynamoDB consumed capacity

2. Create CloudWatch Dashboard:
```bash
aws cloudwatch create-dashboard --dashboard-name FileManagerDashboard --dashboard-body file://dashboard.json
```

## Maintenance

### Backup Procedures
1. DynamoDB Backup:
```bash
aws dynamodb create-backup --table-name MetadataTable --backup-name backup-$(date +%Y%m%d)
```

2. S3 Bucket Backup:
```bash
aws s3 sync s3://source-bucket s3://backup-bucket
```

### Troubleshooting

1. Lambda Function Issues:
   - Check CloudWatch Logs
   - Review permissions
   - Verify environment variables

2. API Gateway Issues:
   - Check CloudWatch Logs
   - Verify CORS settings
   - Test endpoints with Postman

3. Storage Issues:
   - Monitor S3 metrics
   - Check DynamoDB capacity
   - Review file upload patterns

## Cleanup

1. Delete all objects in S3 bucket:
```bash
aws s3 rm s3://bucket-name --recursive
```

2. Destroy the stack:
```bash
cdk destroy
```

## Security Procedures

1. Regular Tasks:
   - Review IAM roles and permissions
   - Check CloudTrail logs
   - Update dependencies
   - Scan for exposed secrets

2. Incident Response:
   - Isolate affected resources
   - Review logs
   - Revoke/rotate credentials if needed
   - Document and report incidents