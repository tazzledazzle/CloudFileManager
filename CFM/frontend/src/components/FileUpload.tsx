// src/components/FileUpload.tsx
import React, { useState, useCallback } from 'react';
import { Form, Button, Card, Alert, ProgressBar, Row, Col } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://kjbhwt25fh.execute-api.us-west-2.amazonaws.com/prod';

interface FileUploadProps {
    userId: string;
}

const FileUpload: React.FC<FileUploadProps> = ({ userId }) => {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const navigate = useNavigate();

    // For drag and drop functionality
    const onDrop = useCallback((acceptedFiles: File[]) => {
        setSelectedFiles(prev => [...prev, ...acceptedFiles]);
        setError('');
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/*': [],
            'application/pdf': [],
            'text/plain': [],
            'application/msword': [],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [],
            'application/vnd.ms-excel': [],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [],
            'application/vnd.ms-powerpoint': [],
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': [],
        }
    });

    const removeFile = (index: number) => {
        const newFiles = [...selectedFiles];
        newFiles.splice(index, 1);
        setSelectedFiles(newFiles);
    };

    const handleUpload = async () => {
        if (selectedFiles.length === 0) {
            setError('Please select at least one file to upload');
            return;
        }

        try {
            setIsUploading(true);
            setUploadProgress({});
            setError('');
            setSuccess('');

            // Upload each file
            const results = await Promise.all(
                selectedFiles.map(async (file) => {
                    try {
                        // Create a new progress tracking entry for this file
                        setUploadProgress(prev => ({
                            ...prev,
                            [file.name]: 0
                        }));

                        // Read file as base64
                        const fileContent = await readFileAsBase64(file);

                        // Update progress to show reading is complete
                        setUploadProgress(prev => ({
                            ...prev,
                            [file.name]: 20
                        }));

                        // Prepare upload payload
                        const uploadData = {
                            fileName: file.name,
                            fileType: file.type,
                            fileContent: fileContent,
                            userId,
                        };

                        // Simulate progress during upload (real progress tracking would require xhr)
                        const progressInterval = setInterval(() => {
                            setUploadProgress(prev => {
                                const currentProgress = prev[file.name] || 0;
                                const newProgress = Math.min(currentProgress + 5, 90);
                                return {
                                    ...prev,
                                    [file.name]: newProgress
                                };
                            });
                        }, 300);

                        // Send upload request
                        const response = await axios.post(`${API_BASE_URL}/files`, uploadData);

                        clearInterval(progressInterval);

                        // Set progress to 100%
                        setUploadProgress(prev => ({
                            ...prev,
                            [file.name]: 100
                        }));

                        return {
                            fileName: file.name,
                            fileId: response.data.fileId,
                            success: true
                        };
                    } catch (err) {
                        console.error(`Error uploading ${file.name}:`, err);
                        return {
                            fileName: file.name,
                            success: false,
                            error: err instanceof Error ? err.message : 'Unknown error'
                        };
                    }
                })
            );

            // Check if all uploads were successful
            const allSuccessful = results.every(result => result.success);
            const successCount = results.filter(result => result.success).length;

            if (allSuccessful) {
                setSuccess(`All ${selectedFiles.length} files uploaded successfully!`);
            } else {
                setSuccess(`${successCount} of ${selectedFiles.length} files uploaded successfully.`);
                setError('Some files failed to upload. Please check the list below.');
            }

            // Reset file selection after short delay
            setTimeout(() => {
                if (allSuccessful) {
                    setSelectedFiles([]);
                    navigate('/');
                } else {
                    // Keep only the failed files in the list
                    const failedFiles = selectedFiles.filter((file, index) => !results[index].success);
                    setSelectedFiles(failedFiles);
                }
                setIsUploading(false);
            }, 2000);
        } catch (err) {
            setIsUploading(false);
            setError(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            console.error('Upload error:', err);
        }
    };

    // Helper function to read file as base64
    const readFileAsBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);

            reader.onload = () => {
                const result = reader.result as string;
                // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
                const base64Content = result.split(',')[1];
                resolve(base64Content);
            };

            reader.onerror = () => {
                reject(new Error('Error reading file'));
            };
        });
    };

    return (
        <div className="my-4">
            <h2 className="mb-4">Upload Files</h2>

            <Card className="p-4 mb-4">
                <div
                    {...getRootProps()}
                    className={`dropzone p-5 text-center border rounded ${isDragActive ? 'border-primary bg-light' : 'border-dashed'}`}
                    style={{ borderStyle: isDragActive ? 'solid' : 'dashed', cursor: 'pointer' }}
                >
                    <input {...getInputProps()} />
                    {isDragActive ? (
                        <p className="mb-0">Drop the files here...</p>
                    ) : (
                        <div>
                            <p className="mb-2">Drag & drop files here, or click to select files</p>
                            <small className="text-muted">
                                Supported file types: Documents, Images, Spreadsheets, Presentations
                            </small>
                        </div>
                    )}
                </div>

                {selectedFiles.length > 0 && (
                    <div className="mt-4">
                        <h5>Selected files ({selectedFiles.length}):</h5>
                        <div className="selected-files">
                            {selectedFiles.map((file, index) => (
                                <Card key={index} className="mb-2">
                                    <Card.Body className="py-2">
                                        <Row className="align-items-center">
                                            <Col xs={isUploading ? 8 : 10}>
                                                <div className="d-flex align-items-center">
                                                    <i className={`bi ${getFileIcon(file.type)} me-2`}></i>
                                                    <div>
                                                        <p className="mb-0 fw-medium text-truncate" style={{ maxWidth: '300px' }}>
                                                            {file.name}
                                                        </p>
                                                        <small className="text-muted">
                                                            {formatFileSize(file.size)}
                                                        </small>
                                                    </div>
                                                </div>
                                            </Col>
                                            {isUploading && (
                                                <Col xs={3}>
                                                    <ProgressBar
                                                        now={uploadProgress[file.name] || 0}
                                                        label={`${uploadProgress[file.name] || 0}%`}
                                                        variant={uploadProgress[file.name] === 100 ? "success" : "primary"}
                                                    />
                                                </Col>
                                            )}
                                            <Col xs={1} className="text-end">
                                                {!isUploading && (
                                                    <Button
                                                        variant="link"
                                                        className="p-0 text-danger"
                                                        onClick={() => removeFile(index)}
                                                    >
                                                        <i className="bi bi-trash"></i>
                                                    </Button>
                                                )}
                                            </Col>
                                        </Row>
                                    </Card.Body>
                                </Card>
                            ))}
                        </div>
                    </div>
                )}

                {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
                {success && <Alert variant="success" className="mt-3">{success}</Alert>}

                <div className="mt-4 d-flex justify-content-between">
                    <Button
                        variant="secondary"
                        onClick={() => navigate('/')}
                        disabled={isUploading}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleUpload}
                        disabled={selectedFiles.length === 0 || isUploading}
                    >
                        {isUploading ? 'Uploading...' : `Upload ${selectedFiles.length > 0 ? `(${selectedFiles.length})` : 'Files'}`}
                    </Button>
                </div>
            </Card>

            <Card className="p-4">
                <h5>About File Processing</h5>
                <p className="mb-2">After upload, your files will be automatically processed:</p>
                <ul className="mb-0">
                    <li>Files are scanned for viruses</li>
                    <li>Text and metadata are extracted</li>
                    <li>Documents are automatically classified</li>
                    <li>Content is indexed for advanced search</li>
                </ul>
                <p className="mt-3 mb-0 text-muted">
                    <i className="bi bi-info-circle me-1"></i>
                    Processing typically takes a few seconds but may take longer for larger files.
                </p>
            </Card>
        </div>
    );
};

// Helper functions
const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (fileType: string): string => {
    if (fileType.includes('image')) return 'bi-file-image';
    if (fileType.includes('pdf')) return 'bi-file-pdf';
    if (fileType.includes('word') || fileType.includes('document')) return 'bi-file-word';
    if (fileType.includes('spreadsheet') || fileType.includes('excel')) return 'bi-file-excel';
    if (fileType.includes('presentation') || fileType.includes('powerpoint')) return 'bi-file-ppt';
    if (fileType.includes('text')) return 'bi-file-text';
    return 'bi-file';
};

export default FileUpload;