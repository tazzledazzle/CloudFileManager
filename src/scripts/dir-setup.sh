# Create the project directory
mkdir -p CloudFileManager/src/main/kotlin/com/cfm
mkdir -p CloudFileManager/src/test/kotlin/com/cfm

# Navigate to the project directory
cd CloudFileManager

# Create subdirectories for different components
mkdir -p src/main/kotlin/com/cfm/api
mkdir -p src/main/kotlin/com/cfm/storage
mkdir -p src/main/kotlin/com/cfm/metadata
mkdir -p src/main/kotlin/com/cfm/search
mkdir -p src/main/kotlin/com/cfm/security
mkdir -p src/main/kotlin/com/cfm/model

# Create resource directories
mkdir -p src/main/resources
mkdir -p src/test/resources

# Create a directory for AWS Lambda functions
mkdir -p lambdas