// src/components/FileDetails.tsx
import React, { useState, useEffect } from 'react';
import {
    Button, Card, Badge, Spinner, Alert, Row, Col,
    Tabs, Tab, Table, ListGroup, Modal
} from 'react-bootstrap';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { format } from 'date-fns';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://kjbhwt25fh.execute-api.us-west-2.amazonaws.com/prod';

interface FileDetails {
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    uploadDate: string;
    fileExtension: string;
    documentType?: string;
    securityStatus?: string;
    processingStatus?: string;
    downloadUrl?: string;
    contentCategory?: string;
    textContent?: string;
    contentLabels?: string[];
    contentEntities?: string[];
    contentKeywords?: string[];
    formFields?: Array<{ key: string; value: string }>;
    keyPhrases?: string[];
    textInImage?: string[];
}

interface FormField {
    key: string;
    value: string;
}

interface FileDetailsProps {
    userId: string;
}

const FileDetails: React.FC<FileDetailsProps> = ({ userId }) => {
    const { fileId } = useParams<{ fileId: string }>();
    const navigate = useNavigate();

    const [fileDetails, setFileDetails] = useState<FileDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [activeTab, setActiveTab] = useState('overview');
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [similarFiles, setSimilarFiles] = useState<any[]>([]);
    const [loadingSimilar, setLoadingSimilar] = useState(false);

    // Load file details
    useEffect(() => {
        const fetchFileDetails = async () => {
            try {
                setLoading(true);
                setError('');

                // Fetch file details
                const response = await axios.get(`${API_BASE_URL}/files/${fileId}`, {
                    params: { userId }
                });

                setFileDetails(response.data);

                // Fetch similar files if this is a document
                if (response.data.contentCategory === 'document' || response.data.contentKeywords?.length > 0) {
                    fetchSimilarFiles(response.data);
                }
            } catch (err) {
                setError(`Failed to load file details: ${err instanceof Error ? err.message : 'Unknown error'}`);
                console.error('Error loading file details:', err);
            } finally {
                setLoading(false);
            }
        };

        if (fileId) {
            fetchFileDetails();
        }
    }, [fileId, userId]);

    // Fetch similar files based on content keywords
    const fetchSimilarFiles = async (fileData: FileDetails) => {
        if (!fileData.contentKeywords?.length) return;

        try {
            setLoadingSimilar(true);

            // Use the most relevant keyword for search
            const keyword = fileData.contentKeywords[0];

            const response = await axios.get(`${API_BASE_URL}/search`, {
                params: {
                    userId,
                    keyword,
                    limit: 5
                }
            });

            // Filter out the current file and limit to 4 similar files
            const similar = (response.data.results?.files || [])
                .filter((file: any) => file.fileId !== fileId)
                .slice(0, 4);

            setSimilarFiles(similar);
        } catch (error) {
            console.error('Error fetching similar files:', error);
        } finally {
            setLoadingSimilar(false);
        }
    };

    // Download file
    const handleDownload = async () => {
        if (!fileDetails?.downloadUrl) return;

        try {
            setDownloading(true);

            // Use the pre-signed URL to download the file
            window.open(fileDetails.downloadUrl, '_blank');

        } catch (err) {
            setError(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            console.error('Download error:', err);
        } finally {
            setDownloading(false);
        }
    };

    // Format file size to readable string
    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Get file icon based on type
    const getFileIcon = (): string => {
        if (!fileDetails) return 'bi-file';

        const { fileType, documentType } = fileDetails;

        // Check document type first
        if (documentType) {
            switch (documentType.toLowerCase()) {
                case 'invoice': return 'bi-receipt';
                case 'resume': return 'bi-person-badge';
                case 'contract': return 'bi-file-earmark-text';
                case 'report': return 'bi-file-earmark-bar-graph';
                case 'letter': return 'bi-envelope';
                case 'form': return 'bi-file-earmark-check';
                case 'receipt': return 'bi-receipt-cutoff';
                case 'presentation': return 'bi-easel';
                case 'article': return 'bi-newspaper';
                case 'legal': return 'bi-file-earmark-ruled';
                case 'financial': return 'bi-cash-stack';
                case 'technical': return 'bi-gear';
                case 'memo': return 'bi-sticky';
            }
        }

        // Fall back to file type
        if (fileType.includes('image')) return 'bi-file-image';
        if (fileType.includes('pdf')) return 'bi-file-pdf';
        if (fileType.includes('word') || fileType.includes('document')) return 'bi-file-word';
        if (fileType.includes('spreadsheet') || fileType.includes('excel')) return 'bi-file-excel';
        if (fileType.includes('presentation') || fileType.includes('powerpoint')) return 'bi-file-ppt';
        if (fileType.includes('text')) return 'bi-file-text';

        return 'bi-file';
    };

    // Get file type badge color
    const getFileTypeBadge = (): string => {
        if (!fileDetails) return 'secondary';

        const { fileType } = fileDetails;

        if (fileType.includes('image')) return 'primary';
        if (fileType.includes('pdf')) return 'danger';
        if (fileType.includes('word') || fileType.includes('document')) return 'info';
        if (fileType.includes('spreadsheet') || fileType.includes('excel')) return 'success';
        if (fileType.includes('presentation') || fileType.includes('powerpoint')) return 'warning';

        return 'secondary';
    };

    // Get security status color
    const getSecurityStatusColor = (status?: string): string => {
        switch (status) {
            case 'clean': return 'success';
            case 'infected': return 'danger';
            case 'pending': return 'warning';
            default: return 'secondary';
        }
    };

    // Can the file be previewed?
    const canPreview = (): boolean => {
        if (!fileDetails) return false;

        // Check if file is an image, PDF, or text
        return fileDetails.fileType.includes('image') ||
            fileDetails.fileType.includes('pdf') ||
            fileDetails.fileType.includes('text') ||
            (fileDetails.textContent?.length || 0) > 0;
    };

    // Sort form fields into categories
    const categorizeFormFields = (fields: FormField[] = []): Record<string, FormField[]> => {
        const categories: Record<string, FormField[]> = {
            'Financial': [],
            'Personal': [],
            'Date': [],
            'Contact': [],
            'Other': []
        };

        fields.forEach(field => {
            const key = field.key.toLowerCase();

            if (key.includes('total') || key.includes('amount') || key.includes('price') ||
                key.includes('cost') || key.includes('tax') || key.includes('payment') ||
                key.includes('invoice') || key.includes('balance')) {
                categories['Financial'].push(field);
            } else if (key.includes('name') || key.includes('birth') || key.includes('gender') ||
                key.includes('age') || key.includes('ssn') || key.includes('id')) {
                categories['Personal'].push(field);
            } else if (key.includes('date') || key.includes('time') || key.includes('when')) {
                categories['Date'].push(field);
            } else if (key.includes('email') || key.includes('phone') || key.includes('address') ||
                key.includes('contact') || key.includes('fax')) {
                categories['Contact'].push(field);
            } else {
                categories['Other'].push(field);
            }
        });

        // Remove empty categories
        return Object.fromEntries(
            Object.entries(categories).filter(([_, fields]) => fields.length > 0)
        );
    };

    // Show preview modal
    const handleShowPreview = () => {
        setShowPreviewModal(true);
    };

    // Render file preview based on type
    const renderPreview = () => {
        if (!fileDetails) return null;

        if (fileDetails.fileType.includes('image') && fileDetails.downloadUrl) {
            return (
                <div className="text-center">
                    <img
                        src={fileDetails.downloadUrl}
                        alt={fileDetails.fileName}
                        className="img-fluid mx-auto"
                        style={{ maxHeight: '80vh' }}
                    />
                </div>
            );
        }

        if (fileDetails.textContent) {
            return (
                <div className="p-3 bg-light" style={{ maxHeight: '80vh', overflow: 'auto' }}>
          <pre className="mb-0" style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
            {fileDetails.textContent}
          </pre>
                </div>
            );
        }

        return (
            <div className="text-center p-5">
                <i className={`${getFileIcon()} display-1 text-muted`}></i>
                <p className="mt-3">Preview not available for this file type.</p>
                <Button
                    variant="primary"
                    onClick={handleDownload}
                    disabled={downloading}
                >
                    {downloading ? (
                        <>
                            <Spinner animation="border" size="sm" className="me-2" />
                            Downloading...
                        </>
                    ) : (
                        <>
                            <i className="bi bi-download me-2"></i>
                            Download to View
                        </>
                    )}
                </Button>
            </div>
        );
    };

    return (
        <div className="my-4">
            {loading ? (
                <div className="text-center p-5">
                    <Spinner animation="border" role="status">
                        <span className="visually-hidden">Loading...</span>
                    </Spinner>
                    <p className="mt-3 text-muted">Loading file details...</p>
                </div>
            ) : error ? (
                <Alert variant="danger">{error}</Alert>
            ) : fileDetails ? (
                <>
                    <div className="d-flex justify-content-between align-items-start mb-4">
                        <div>
                            <h2 className="mb-0 d-flex align-items-center">
                                <i className={`${getFileIcon()} me-2`}></i>
                                {fileDetails.fileName}
                            </h2>
                            <div className="mt-2">
                                <Badge bg={getFileTypeBadge()} className="me-2">
                                    {fileDetails.fileExtension?.toUpperCase() || 'FILE'}
                                </Badge>

                                {fileDetails.documentType && (
                                    <Badge bg="secondary" text="dark" className="bg-light border me-2">
                                        {fileDetails.documentType}
                                    </Badge>
                                )}

                                {fileDetails.securityStatus && (
                                    <Badge
                                        bg={getSecurityStatusColor(fileDetails.securityStatus)}
                                        className="me-2"
                                    >
                                        <i className={`bi bi-${fileDetails.securityStatus === 'clean' ? 'shield-check' :
                                            fileDetails.securityStatus === 'infected' ? 'shield-x' :
                                                'shield-exclamation'} me-1`}></i>
                                        {fileDetails.securityStatus}
                                    </Badge>
                                )}

                                {fileDetails.processingStatus === 'completed' && (
                                    <Badge bg="info">
                                        <i className="bi bi-check-circle me-1"></i>
                                        Processed
                                    </Badge>
                                )}
                            </div>
                        </div>

                        <div className="d-flex gap-2">
                            <Button
                                variant="outline-secondary"
                                onClick={() => navigate('/')}
                            >
                                <i className="bi bi-arrow-left me-1"></i> Back to Files
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleDownload}
                                disabled={downloading || !fileDetails.downloadUrl}
                            >
                                {downloading ? (
                                    <>
                                        <Spinner animation="border" size="sm" className="me-2" />
                                        Downloading...
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-download me-1"></i> Download
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    <Row>
                        <Col lg={4} xl={3} className="mb-4">
                            <Card className="mb-4">
                                <Card.Body>
                                    <h5 className="mb-3">File Information</h5>
                                    <Table className="mb-0">
                                        <tbody>
                                        <tr>
                                            <th className="border-0 ps-0 w-50">Size</th>
                                            <td className="border-0 pe-0">{formatFileSize(fileDetails.fileSize)}</td>
                                        </tr>
                                        <tr>
                                            <th className="ps-0">Uploaded</th>
                                            <td className="pe-0">{format(new Date(fileDetails.uploadDate), 'PPP pp')}</td>
                                        </tr>
                                        <tr>
                                            <th className="ps-0">Type</th>
                                            <td className="pe-0">{fileDetails.fileType}</td>
                                        </tr>
                                        {fileDetails.documentType && (
                                            <tr>
                                                <th className="ps-0">Document Type</th>
                                                <td className="pe-0">{fileDetails.documentType}</td>
                                            </tr>
                                        )}
                                        {fileDetails.securityStatus && (
                                            <tr>
                                                <th className="ps-0">Security Status</th>
                                                <td className="pe-0">
                                                    <Badge bg={getSecurityStatusColor(fileDetails.securityStatus)}>
                                                        {fileDetails.securityStatus}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        )}
                                        <tr>
                                            <th className="ps-0">File ID</th>
                                            <td className="pe-0">
                                                <code className="small">{fileDetails.fileId}</code>
                                            </td>
                                        </tr>
                                        </tbody>
                                    </Table>
                                </Card.Body>
                            </Card>

                            {(canPreview() || fileDetails.downloadUrl) && (
                                <Card className="mb-4">
                                    <Card.Body className="text-center">
                                        <i className={`${getFileIcon()} display-3 mb-3 d-block mx-auto text-muted`}></i>
                                        {canPreview() && (
                                            <Button
                                                variant="outline-primary"
                                                className="w-100 mb-2"
                                                onClick={handleShowPreview}
                                            >
                                                <i className="bi bi-eye me-2"></i> Preview
                                            </Button>
                                        )}
                                        {fileDetails.downloadUrl && (
                                            <Button
                                                variant="primary"
                                                className="w-100"
                                                onClick={handleDownload}
                                                disabled={downloading}
                                            >
                                                <i className="bi bi-download me-2"></i> Download
                                            </Button>
                                        )}
                                    </Card.Body>
                                </Card>
                            )}

                            {similarFiles.length > 0 && (
                                <Card>
                                    <Card.Header>
                                        <h5 className="mb-0">Similar Files</h5>
                                    </Card.Header>
                                    <ListGroup variant="flush">
                                        {loadingSimilar ? (
                                            <ListGroup.Item className="text-center py-4">
                                                <Spinner animation="border" size="sm" />
                                            </ListGroup.Item>
                                        ) : (
                                            similarFiles.map(file => (
                                                <ListGroup.Item key={file.fileId} action as={Link} to={`/files/${file.fileId}`}>
                                                    <div className="d-flex align-items-center">
                                                        <i className="bi bi-file-earmark me-2 text-muted"></i>
                                                        <div className="text-truncate">{file.fileName}</div>
                                                    </div>
                                                    <div className="small text-muted ms-4 mt-1">
                                                        {file.documentType || file.fileExtension?.toUpperCase()} • {formatFileSize(file.fileSize)}
                                                    </div>
                                                </ListGroup.Item>
                                            ))
                                        )}
                                    </ListGroup>
                                </Card>
                            )}
                        </Col>

                        <Col lg={8} xl={9}>
                            <Card>
                                <Tabs
                                    activeKey={activeTab}
                                    onSelect={(k) => setActiveTab(k || 'overview')}
                                    className="px-3 pt-3"
                                >
                                    <Tab eventKey="overview" title="Overview">
                                        <Card.Body>
                                            <Row>
                                                {fileDetails.contentLabels && fileDetails.contentLabels.length > 0 && (
                                                    <Col md={6} className="mb-4">
                                                        <h5 className="mb-3">Content Labels</h5>
                                                        <div className="d-flex flex-wrap gap-1">
                                                            {fileDetails.contentLabels.map((label, index) => (
                                                                <Badge
                                                                    key={index}
                                                                    bg="light"
                                                                    text="dark"
                                                                    className="border px-2 py-1 mb-1"
                                                                >
                                                                    {label}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    </Col>
                                                )}

                                                {fileDetails.contentEntities && fileDetails.contentEntities.length > 0 && (
                                                    <Col md={6} className="mb-4">
                                                        <h5 className="mb-3">Entities</h5>
                                                        <div className="d-flex flex-wrap gap-1">
                                                            {fileDetails.contentEntities.map((entity, index) => (
                                                                <Badge
                                                                    key={index}
                                                                    bg="info"
                                                                    className="bg-info-subtle text-dark border border-info-subtle px-2 py-1 mb-1"
                                                                >
                                                                    {entity}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    </Col>
                                                )}
                                            </Row>

                                            {fileDetails.keyPhrases && fileDetails.keyPhrases.length > 0 && (
                                                <div className="mb-4">
                                                    <h5 className="mb-3">Key Phrases</h5>
                                                    <div className="d-flex flex-wrap gap-1">
                                                        {fileDetails.keyPhrases.map((phrase, index) => (
                                                            <Badge
                                                                key={index}
                                                                bg="primary"
                                                                className="bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 mb-1"
                                                            >
                                                                {phrase}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {fileDetails.textInImage && fileDetails.textInImage.length > 0 && (
                                                <div className="mb-4">
                                                    <h5 className="mb-3">Text in Image</h5>
                                                    <Card className="bg-light">
                                                        <Card.Body>
                                                            {fileDetails.textInImage.map((text, index) => (
                                                                <p key={index} className="mb-1">{text}</p>
                                                            ))}
                                                        </Card.Body>
                                                    </Card>
                                                </div>
                                            )}

                                            {fileDetails.formFields && fileDetails.formFields.length > 0 && (
                                                <div className="mb-4">
                                                    <h5 className="mb-3">Form Fields</h5>
                                                    <Row>
                                                        {Object.entries(categorizeFormFields(fileDetails.formFields)).map(([category, fields]) => (
                                                            <Col md={6} key={category} className="mb-3">
                                                                <Card>
                                                                    <Card.Header className="py-2">
                                                                        <h6 className="mb-0">{category}</h6>
                                                                    </Card.Header>
                                                                    <ListGroup variant="flush">
                                                                        {fields.map((field, index) => (
                                                                            <ListGroup.Item key={index} className="d-flex justify-content-between">
                                                                                <span className="text-muted">{field.key}</span>
                                                                                <span className="fw-medium">{field.value}</span>
                                                                            </ListGroup.Item>
                                                                        ))}
                                                                    </ListGroup>
                                                                </Card>
                                                            </Col>
                                                        ))}
                                                    </Row>
                                                </div>
                                            )}

                                            {fileDetails.textContent && (
                                                <div>
                                                    <h5 className="mb-3">Content Preview</h5>
                                                    <Card className="bg-light">
                                                        <Card.Body>
                              <pre className="mb-0" style={{ whiteSpace: 'pre-wrap', maxHeight: '300px', overflow: 'auto' }}>
                                {fileDetails.textContent.length > 1000
                                    ? fileDetails.textContent.substring(0, 1000) + '...'
                                    : fileDetails.textContent}
                              </pre>
                                                        </Card.Body>
                                                    </Card>
                                                    {fileDetails.textContent.length > 1000 && (
                                                        <div className="text-center mt-3">
                                                            <Button
                                                                variant="outline-secondary"
                                                                size="sm"
                                                                onClick={handleShowPreview}
                                                            >
                                                                View Full Content
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </Card.Body>
                                    </Tab>

                                    <Tab eventKey="metadata" title="Metadata">
                                        <Card.Body>
                                            <Table striped bordered>
                                                <thead>
                                                <tr>
                                                    <th>Property</th>
                                                    <th>Value</th>
                                                </tr>
                                                </thead>
                                                <tbody>
                                                {Object.entries(fileDetails).map(([key, value]) => {
                                                    // Skip these properties to avoid clutter
                                                    if (['downloadUrl', 'textContent', 'contentLabels', 'contentEntities',
                                                        'contentKeywords', 'formFields', 'keyPhrases', 'textInImage'].includes(key)) {
                                                        return null;
                                                    }

                                                    // Format the value based on its type
                                                    let formattedValue;
                                                    if (typeof value === 'string') {
                                                        if (key === 'uploadDate') {
                                                            formattedValue = format(new Date(value), 'PPP pp');
                                                        } else {
                                                            formattedValue = value;
                                                        }
                                                    } else if (typeof value === 'number') {
                                                        if (key === 'fileSize') {
                                                            formattedValue = formatFileSize(value);
                                                        } else {
                                                            formattedValue = value.toString();
                                                        }
                                                    } else if (Array.isArray(value)) {
                                                        formattedValue = value.join(', ');
                                                    } else if (value === null || value === undefined) {
                                                        formattedValue = '-';
                                                    } else {
                                                        formattedValue = JSON.stringify(value);
                                                    }

                                                    return (
                                                        <tr key={key}>
                                                            <td>{key}</td>
                                                            <td>{formattedValue}</td>
                                                        </tr>
                                                    );
                                                })}
                                                </tbody>
                                            </Table>
                                        </Card.Body>
                                    </Tab>
                                </Tabs>
                            </Card>
                        </Col>
                    </Row>

                    {/* Preview Modal */}
                    <Modal
                        show={showPreviewModal}
                        onHide={() => setShowPreviewModal(false)}
                        size="lg"
                        centered
                    >
                        <Modal.Header closeButton>
                            <Modal.Title>
                                <i className={`${getFileIcon()} me-2`}></i>
                                {fileDetails.fileName}
                            </Modal.Title>
                        </Modal.Header>
                        <Modal.Body className="p-0">
                            {renderPreview()}
                        </Modal.Body>
                        <Modal.Footer>
                            <Button variant="secondary" onClick={() => setShowPreviewModal(false)}>
                                Close
                            </Button>
                            {fileDetails.downloadUrl && (
                                <Button
                                    variant="primary"
                                    onClick={handleDownload}
                                    disabled={downloading}
                                >
                                    <i className="bi bi-download me-2"></i>
                                    Download
                                </Button>
                            )}
                        </Modal.Footer>
                    </Modal>
                </>
            ) : (
                <Alert variant="danger">File not found</Alert>
            )}
        </div>
    );
};

export default FileDetails;