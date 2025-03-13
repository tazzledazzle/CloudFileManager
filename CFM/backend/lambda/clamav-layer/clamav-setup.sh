#!/bin/bash
# Script to build and deploy a ClamAV Lambda Layer

set -e

LAYER_NAME="clamav-layer"
TEMP_DIR="/tmp/clamav-layer"
S3_BUCKET="your-deployment-bucket"  # Replace with your bucket
REGION="us-east-1"  # Replace with your region

echo "Building ClamAV Lambda Layer..."

# Create temporary directory structure
rm -rf ${TEMP_DIR}
mkdir -p ${TEMP_DIR}/bin
mkdir -p ${TEMP_DIR}/lib
mkdir -p ${TEMP_DIR}/lib64
mkdir -p ${TEMP_DIR}/var/lib/clamav

# Change to the temporary directory
cd ${TEMP_DIR}

# Option 1: Download pre-compiled binaries (simplest approach)
echo "Downloading pre-compiled ClamAV binaries..."
# Note: This is a placeholder. You would need to find/host compatible binaries
# curl -L -o clamav.tar.gz https://your-hosting-site.com/clamav-lambda-binaries.tar.gz
# tar -xzf clamav.tar.gz
# cp -r ./clamav/* .

# Option 2: Compile from source using Amazon Linux 2 container
echo "Setting up Docker build environment..."
cat > Dockerfile << 'EOL'
FROM amazonlinux:2

# Install build dependencies
RUN yum update -y && \
    yum groupinstall -y "Development Tools" && \
    yum install -y \
    wget \
    openssl-devel \
    libcurl-devel \
    bzip2-devel \
    json-c-devel \
    libxml2-devel \
    ncurses-devel \
    file-devel \
    zlib-devel \
    valgrind \
    check \
    check-devel \
    libtool-ltdl-devel && \
    yum clean all

# Download and compile ClamAV
WORKDIR /tmp
RUN wget https://www.clamav.net/downloads/production/clamav-0.103.7.tar.gz && \
    tar -xzf clamav-0.103.7.tar.gz && \
    cd clamav-0.103.7 && \
    ./configure \
    --disable-largefile \
    --disable-mempool \
    --disable-clamdtop \
    --disable-milter \
    --disable-clamonacc \
    --disable-xml \
    --disable-bzip2 \
    --without-xml \
    --without-zlib \
    --without-libcurl \
    --without-libbz2 \
    --without-libjson \
    --without-pcre \
    --without-libncurses-prefix \
    --without-iconv && \
    make -j4 && \
    make install

# Package binaries
RUN mkdir -p /output/bin /output/lib /output/lib64 /output/var/lib/clamav && \
    cp /usr/local/bin/clamscan /output/bin/ && \
    cp /usr/local/bin/freshclam /output/bin/ && \
    cp /usr/local/lib/libclamav.so* /output/lib/ && \
    cp /usr/local/lib/libclammspack.so* /output/lib/ && \
    cp /usr/local/lib/libclamunrar.so* /output/lib/

# Download virus definitions
WORKDIR /output/var/lib/clamav
RUN wget http://database.clamav.net/main.cvd && \
    wget http://database.clamav.net/daily.cvd && \
    wget http://database.clamav.net/bytecode.cvd

VOLUME ["/output"]
EOL

# Build the Docker image
echo "Building Docker image for ClamAV compilation..."
docker build -t clamav-builder .

# Extract compiled binaries
echo "Extracting compiled binaries..."
docker run --rm -v ${TEMP_DIR}:/mnt clamav-builder cp -r /output/* /mnt/

# Create the layer ZIP file
echo "Creating Lambda Layer ZIP file..."
cd ${TEMP_DIR}
zip -r9 ../clamav-layer.zip .

# Deploy the layer to AWS
echo "Deploying Lambda Layer to AWS..."
aws lambda publish-layer-version \
    --layer-name ${LAYER_NAME} \
    --description "ClamAV Antivirus Scanner" \
    --license-info "GPL-2.0" \
    --zip-file fileb://../clamav-layer.zip \
    --compatible-runtimes python3.8 python3.9 \
    --region ${REGION}

# Alternative: Upload to S3 first
# aws s3 cp ../clamav-layer.zip s3://${S3_BUCKET}/layers/
# aws lambda publish-layer-version \
#     --layer-name ${LAYER_NAME} \
#     --description "ClamAV Antivirus Scanner" \
#     --content S3Bucket=${S3_BUCKET},S3Key=layers/clamav-layer.zip \
#     --compatible-runtimes python3.8 python3.9 \
#     --region ${REGION}

echo "Layer deployment complete!"

# Create a function to update virus definitions
echo "Creating virus definition updater function..."

mkdir -p virus-updater
cd virus-updater

cat > index.py << 'EOL'
import os
import subprocess
import boto3
import time
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client('s3')
DEFINITIONS_BUCKET = os.environ['DEFINITIONS_BUCKET']

def handler(event, context):
    """Update virus definitions and upload to S3"""
    try:
        # Set up paths
        db_dir = '/tmp/clamav-db'
        os.makedirs(db_dir, exist_ok=True)
        os.chdir(db_dir)

        # Run freshclam to update definitions
        logger.info("Updating virus definitions...")
        freshclam_conf = '/tmp/freshclam.conf'
        with open(freshclam_conf, 'w') as f:
            f.write("DatabaseDirectory /tmp/clamav-db\n")
            f.write("DatabaseMirror database.clamav.net\n")

        result = subprocess.run(
            ['/opt/bin/freshclam', '-v', '--config-file=' + freshclam_conf],
            capture_output=True,
            text=True
        )

        logger.info(f"Freshclam output: {result.stdout}")
        if result.returncode != 0:
            logger.error(f"Freshclam error: {result.stderr}")

        # Upload updated definitions to S3
        for file in ['main.cvd', 'daily.cvd', 'bytecode.cvd']:
            if os.path.exists(file):
                logger.info(f"Uploading {file} to S3...")
                s3.upload_file(
                    file,
                    DEFINITIONS_BUCKET,
                    f"virus-definitions/{file}",
                    ExtraArgs={'ACL': 'public-read'}
                )

        return {
            'statusCode': 200,
            'body': 'Virus definitions updated successfully'
        }

    except Exception as e:
        logger.error(f"Error updating virus definitions: {str(e)}")
        return {
            'statusCode': 500,
            'body': f"Error: {str(e)}"
        }
EOL

# Create ZIP for updater function
zip -r9 ../virus-updater.zip index.py

# Deploy the updater function (manual configuration in AWS console would be needed as well)
echo "Virus definition updater function created (virus-updater.zip)"
echo "Deploy this function manually and configure it with the ClamAV layer"

echo "Setup complete!"