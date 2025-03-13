from setuptools import setup, find_packages

setup(
    name="cloud_file_manager",
    version="1.0.0",
    packages=find_packages(),
    include_package_data=True,
    install_requires=[
        "boto3>=1.28.0",
        "flask>=2.3.0",
        "flask-cors>=4.0.0",
        "python-dotenv>=1.0.0",
        "pydantic>=2.4.0",
        "dataclasses-json>=0.6.7",
    ],
    entry_points={
        "console_scripts": [
            "cfm=cloud_file_manager.app:main",
        ],
    },
    python_requires=">=3.9",
    author="",
    author_email="",
    description="Cloud File Manager with ML Metadata Analysis",
    keywords="file, storage, aws, ml, metadata",
    url="",
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.9",
    ],
)