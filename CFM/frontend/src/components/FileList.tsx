// src/components/FileList.tsx
import React, { useState, useEffect } from 'react';
import { Table, Button, Card, Badge, Spinner, Alert, Dropdown, InputGroup, FormControl, Row, Col } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { format } from 'date-fns';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://kjbhwt25fh.execute-api.us-west-2.amazonaws.com/prod';

interface FileItem {
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    uploadDate: string;
    fileExtension: string;
    documentType?: string;
    securityStatus?: string;
    processingStatus?: string;
}

interface FilterOptions {
    documentType?: string;
    fileExtension?: string;
    dateRange?: string;
}

interface FileListProps {
    userId: string;
}

const FileList: React.FC<FileListProps> = ({ userId }) => {
    const [files, setFiles] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastEvaluatedKey, setLastEvaluatedKey] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filters, setFilters] = useState<FilterOptions>({});
    const [sortBy, setSortBy] = useState<'date' | 'name' | 'type' | 'size'>('date');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

    // Document types for filter dropdown
    const documentTypes = [
        'invoice', 'resume', 'contract', 'report', 'letter',
        'form', 'receipt', 'certificate', 'manual', 'presentation',
        'article', 'proposal', 'specification', 'legal', 'financial',
        'academic', 'technical', 'creative', 'memo', 'other'
    ];

    // File extensions for filter dropdown
    const fileExtensions = [
        'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
        'jpg', 'png', 'gif', 'txt', 'csv', 'json', 'zip'
    ];

    // Format file size to readable string
    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Get file type badge color
    const getFileTypeBadge = (fileType: string): string => {
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

    // Get document type icon
    const getDocumentTypeIcon = (docType?: string): string => {
        switch (docType?.toLowerCase()) {
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
            default: return 'bi-file-earmark';
        }
    };

    // Load files from API
    const loadFiles = async (nextKey?: string, isNewSearch: boolean = false) => {
        try {
            const isLoadingMore = !!nextKey && !isNewSearch;

            if (isLoadingMore) {
                setLoadingMore(true);
            } else {
                setLoading(true);
            }

            setError('');

            // Build query params
            let url = `${API_BASE_URL}/files?userId=${userId}&limit=20`;

            if (nextKey) {
                url += `&lastKey=${encodeURIComponent(nextKey)}`;
            }

            // Add search query if present
            if (searchQuery) {
                // Use enhanced search if query has multiple words or special characters
                const useEnhancedSearch = searchQuery.includes(' ') ||
                    /[?!.]/.test(searchQuery) ||
                    searchQuery.length > 10;

                if (useEnhancedSearch) {
                    url = `${API_BASE_URL}/nl-search?userId=${userId}&q=${encodeURIComponent(searchQuery)}&limit=20`;
                } else {
                    url += `&q=${encodeURIComponent(searchQuery)}`;
                }
            }

            // Add filters
            if (filters.documentType) {
                url += `&documentType=${encodeURIComponent(filters.documentType)}`;
            }

            if (filters.fileExtension) {
                url += `&fileExtension=${encodeURIComponent(filters.fileExtension)}`;
            }

            if (filters.dateRange) {
                const now = new Date();
                let fromDate;

                switch (filters.dateRange) {
                    case 'today':
                        fromDate = new Date();
                        fromDate.setHours(0, 0, 0, 0);
                        break;
                    case 'week':
                        fromDate = new Date();
                        fromDate.setDate(fromDate.getDate() - 7);
                        break;
                    case 'month':
                        fromDate = new Date();
                        fromDate.setMonth(fromDate.getMonth() - 1);
                        break;
                    case 'year':
                        fromDate = new Date();
                        fromDate.setFullYear(fromDate.getFullYear() - 1);
                        break;
                }

                if (fromDate) {
                    url += `&from=${fromDate.toISOString()}`;
                }
            }

            const response = await axios.get(url);

            // Handle responses from both standard list and search endpoints
            let responseFiles = [];
            let responsePagination = null;

            if (response.data.files) {
                // Standard list endpoint
                responseFiles = response.data.files;
                responsePagination = response.data.pagination;
            } else if (response.data.results?.files) {
                // Search endpoint
                responseFiles = response.data.results.files;
                responsePagination = {
                    lastEvaluatedKey: response.data.results.lastEvaluatedKey,
                    hasMore: response.data.results.hasMore
                };
            }

            // Sort files
            const sortedFiles = sortFiles(responseFiles, sortBy, sortDirection);

            if (isLoadingMore && !isNewSearch) {
                // Append new files to existing ones
                setFiles(prevFiles => {
                    const combinedFiles = [...prevFiles, ...sortedFiles];
                    return sortFiles(combinedFiles, sortBy, sortDirection);
                });
            } else {
                setFiles(sortedFiles);
            }

            // Update pagination state
            setHasMore(responsePagination?.hasMore || false);
            setLastEvaluatedKey(responsePagination?.lastEvaluatedKey || null);
        } catch (err) {
            setError(`Failed to load files: ${err instanceof Error ? err.message : 'Unknown error'}`);
            console.error('Error loading files:', err);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    // Sort files based on current sort settings
    const sortFiles = (filesToSort: FileItem[], sortField: string, direction: 'asc' | 'desc'): FileItem[] => {
        return [...filesToSort].sort((a, b) => {
            let comparison = 0;

            switch (sortField) {
                case 'name':
                    comparison = a.fileName.localeCompare(b.fileName);
                    break;
                case 'date':
                    comparison = new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime();
                    break;
                case 'type':
                    comparison = (a.documentType || '').localeCompare(b.documentType || '');
                    if (comparison === 0) {
                        comparison = (a.fileExtension || '').localeCompare(b.fileExtension || '');
                    }
                    break;
                case 'size':
                    comparison = (a.fileSize || 0) - (b.fileSize || 0);
                    break;
                default:
                    comparison = 0;
            }

            return direction === 'asc' ? comparison : -comparison;
        });
    };

    // Toggle sort direction or change sort field
    const handleSort = (field: 'date' | 'name' | 'type' | 'size') => {
        if (sortBy === field) {
            // Toggle direction
            setSortDirection(current => current === 'asc' ? 'desc' : 'asc');
        } else {
            // Change field and reset to descending for date, ascending for others
            setSortBy(field);
            setSortDirection(field === 'date' ? 'desc' : 'asc');
        }

        // Apply sort to current files
        setFiles(current => sortFiles(current, field, sortBy === field && sortDirection === 'asc' ? 'desc' : 'asc'));
    };

    // Update filters
    const updateFilter = (key: keyof FilterOptions, value: string | undefined) => {
        setFilters(prev => ({
            ...prev,
            [key]: value
        }));
    };

    // Clear all filters and search
    const clearFilters = () => {
        setFilters({});
        setSearchQuery('');
        loadFiles(undefined, true);
    };

    // Handle search input
    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        loadFiles(undefined, true);
    };

    // Load files on component mount and when filters change
    useEffect(() => {
        loadFiles(undefined, true);
    }, [userId, filters]);

    // Handle "Load More" click
    const handleLoadMore = () => {
        if (lastEvaluatedKey) {
            loadFiles(lastEvaluatedKey);
        }
    };

    return (
        <div className="my-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2 className="mb-0">My Files</h2>
                <Link to="/upload" className="btn btn-primary">
                    <i className="bi bi-plus-lg me-1"></i> Upload Files
                </Link>
            </div>

            <Card className="mb-4">
                <Card.Body>
                    <Row>
                        <Col md={6}>
                            <form onSubmit={handleSearch}>
                                <InputGroup>
                                    <FormControl
                                        placeholder="Search files..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                    <Button variant="outline-secondary" type="submit">
                                        <i className="bi bi-search"></i>
                                    </Button>
                                </InputGroup>
                            </form>
                            <div className="mt-2 small text-muted">
                                Try natural language search like "contracts from last month" or "images with people"
                            </div>
                        </Col>
                        <Col md={6}>
                            <div className="d-flex gap-2 justify-content-md-end mt-3 mt-md-0">
                                <Dropdown>
                                    <Dropdown.Toggle variant="outline-secondary" size="sm">
                                        <i className="bi bi-file-earmark me-1"></i>
                                        {filters.documentType || 'Document Type'}
                                    </Dropdown.Toggle>
                                    <Dropdown.Menu style={{ maxHeight: '300px', overflow: 'auto' }}>
                                        <Dropdown.Item onClick={() => updateFilter('documentType', undefined)}>
                                            All Types
                                        </Dropdown.Item>
                                        <Dropdown.Divider />
                                        {documentTypes.map(type => (
                                            <Dropdown.Item
                                                key={type}
                                                onClick={() => updateFilter('documentType', type)}
                                                active={filters.documentType === type}
                                            >
                                                <i className={`${getDocumentTypeIcon(type)} me-2`}></i> {type.charAt(0).toUpperCase() + type.slice(1)}
                                            </Dropdown.Item>
                                        ))}
                                    </Dropdown.Menu>
                                </Dropdown>

                                <Dropdown>
                                    <Dropdown.Toggle variant="outline-secondary" size="sm">
                                        <i className="bi bi-file-earmark-text me-1"></i>
                                        {filters.fileExtension ? `.${filters.fileExtension}` : 'File Format'}
                                    </Dropdown.Toggle>
                                    <Dropdown.Menu style={{ maxHeight: '300px', overflow: 'auto' }}>
                                        <Dropdown.Item onClick={() => updateFilter('fileExtension', undefined)}>
                                            All Formats
                                        </Dropdown.Item>
                                        <Dropdown.Divider />
                                        {fileExtensions.map(ext => (
                                            <Dropdown.Item
                                                key={ext}
                                                onClick={() => updateFilter('fileExtension', ext)}
                                                active={filters.fileExtension === ext}
                                            >
                                                .{ext}
                                            </Dropdown.Item>
                                        ))}
                                    </Dropdown.Menu>
                                </Dropdown>

                                <Dropdown>
                                    <Dropdown.Toggle variant="outline-secondary" size="sm">
                                        <i className="bi bi-calendar me-1"></i>
                                        {filters.dateRange ?
                                            filters.dateRange === 'today' ? 'Today' :
                                                filters.dateRange === 'week' ? 'Last 7 days' :
                                                    filters.dateRange === 'month' ? 'Last 30 days' :
                                                        'Last 12 months'
                                            : 'Date Range'}
                                    </Dropdown.Toggle>
                                    <Dropdown.Menu>
                                        <Dropdown.Item onClick={() => updateFilter('dateRange', undefined)}>
                                            All Time
                                        </Dropdown.Item>
                                        <Dropdown.Divider />
                                        <Dropdown.Item
                                            onClick={() => updateFilter('dateRange', 'today')}
                                            active={filters.dateRange === 'today'}
                                        >
                                            Today
                                        </Dropdown.Item>
                                        <Dropdown.Item
                                            onClick={() => updateFilter('dateRange', 'week')}
                                            active={filters.dateRange === 'week'}
                                        >
                                            Last 7 days
                                        </Dropdown.Item>
                                        <Dropdown.Item
                                            onClick={() => updateFilter('dateRange', 'month')}
                                            active={filters.dateRange === 'month'}
                                        >
                                            Last 30 days
                                        </Dropdown.Item>
                                        <Dropdown.Item
                                            onClick={() => updateFilter('dateRange', 'year')}
                                            active={filters.dateRange === 'year'}
                                        >
                                            Last 12 months
                                        </Dropdown.Item>
                                    </Dropdown.Menu>
                                </Dropdown>

                                {(filters.documentType || filters.fileExtension || filters.dateRange || searchQuery) && (
                                    <Button
                                        variant="outline-danger"
                                        size="sm"
                                        onClick={clearFilters}
                                    >
                                        <i className="bi bi-x-lg"></i> Clear
                                    </Button>
                                )}
                            </div>
                        </Col>
                    </Row>
                </Card.Body>
            </Card>

            {error && <Alert variant="danger">{error}</Alert>}

            <Card>
                {loading && !loadingMore ? (
                    <div className="text-center p-5">
                        <Spinner animation="border" role="status">
                            <span className="visually-hidden">Loading...</span>
                        </Spinner>
                        <p className="mt-3 text-muted">Loading your files...</p>
                    </div>
                ) : files.length === 0 ? (
                    <div className="text-center p-5">
                        {searchQuery || filters.documentType || filters.fileExtension || filters.dateRange ? (
                            <div>
                                <i className="bi bi-search display-1 text-muted"></i>
                                <p className="h5 mt-3">No files match your search criteria</p>
                                <p className="text-muted mb-3">Try adjusting your search terms or filters</p>
                                <Button variant="outline-primary" onClick={clearFilters}>Clear All Filters</Button>
                            </div>
                        ) : (
                            <div>
                                <i className="bi bi-cloud-upload display-1 text-muted"></i>
                                <p className="h5 mt-3">You haven't uploaded any files yet</p>
                                <p className="text-muted mb-3">Get started by uploading your first file</p>
                                <Link to="/upload" className="btn btn-primary">Upload Files</Link>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        <Table hover responsive className="mb-0">
                            <thead>
                            <tr>
                                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                                    File Name
                                    {sortBy === 'name' && (
                                        <i className={`bi ms-1 ${sortDirection === 'asc' ? 'bi-sort-alpha-down' : 'bi-sort-alpha-up'}`}></i>
                                    )}
                                </th>
                                <th onClick={() => handleSort('type')} style={{ cursor: 'pointer' }}>
                                    Type
                                    {sortBy === 'type' && (
                                        <i className={`bi ms-1 ${sortDirection === 'asc' ? 'bi-sort-alpha-down' : 'bi-sort-alpha-up'}`}></i>
                                    )}
                                </th>
                                <th onClick={() => handleSort('size')} style={{ cursor: 'pointer' }}>
                                    Size
                                    {sortBy === 'size' && (
                                        <i className={`bi ms-1 ${sortDirection === 'asc' ? 'bi-sort-numeric-down' : 'bi-sort-numeric-up'}`}></i>
                                    )}
                                </th>
                                <th onClick={() => handleSort('date')} style={{ cursor: 'pointer' }}>
                                    Uploaded
                                    {sortBy === 'date' && (
                                        <i className={`bi ms-1 ${sortDirection === 'asc' ? 'bi-sort-down' : 'bi-sort-up'}`}></i>
                                    )}
                                </th>
                                <th>Status</th>
                                <th className="text-end">Actions</th>
                            </tr>
                            </thead>
                            <tbody>
                            {files.map(file => (
                                <tr key={file.fileId}>
                                    <td>
                                        <Link to={`/files/${file.fileId}`} className="text-decoration-none d-flex align-items-center">
                                            <i className={`${getDocumentTypeIcon(file.documentType)} me-2 text-secondary`}></i>
                                            <span className="text-truncate" style={{ maxWidth: '300px' }}>
                          {file.fileName}
                        </span>
                                        </Link>
                                    </td>
                                    <td>
                                        <div className="d-flex align-items-center">
                                            <Badge bg={getFileTypeBadge(file.fileType)} className="me-2">
                                                {file.fileExtension?.toUpperCase() || 'FILE'}
                                            </Badge>
                                            {file.documentType && (
                                                <small className="text-muted">{file.documentType}</small>
                                            )}
                                        </div>
                                    </td>
                                    <td>{formatFileSize(file.fileSize)}</td>
                                    <td>
                                        <div>
                                            {format(new Date(file.uploadDate), 'MMM d, yyyy')}
                                            <div className="small text-muted">
                                                {format(new Date(file.uploadDate), 'h:mm a')}
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        {file.securityStatus && (
                                            <Badge
                                                bg={getSecurityStatusColor(file.securityStatus)}
                                                className="me-1"
                                                title={`Security: ${file.securityStatus}`}
                                            >
                                                <i className={`bi bi-${file.securityStatus === 'clean' ? 'shield-check' :
                                                    file.securityStatus === 'infected' ? 'shield-x' :
                                                        'shield-exclamation'} me-1`}></i>
                                                {file.securityStatus}
                                            </Badge>
                                        )}
                                        {file.processingStatus === 'completed' && (
                                            <Badge
                                                bg="info"
                                                title="Processing complete"
                                            >
                                                <i className="bi bi-check-circle me-1"></i>
                                                processed
                                            </Badge>
                                        )}
                                    </td>
                                    <td className="text-end">
                                        <Link to={`/files/${file.fileId}`} className="btn btn-sm btn-outline-primary me-2">
                                            View
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </Table>

                        {hasMore && (
                            <div className="text-center p-3">
                                <Button
                                    variant="outline-primary"
                                    onClick={handleLoadMore}
                                    disabled={loadingMore}
                                >
                                    {loadingMore ? (
                                        <>
                                            <Spinner animation="border" size="sm" className="me-2" />
                                            Loading...
                                        </>
                                    ) : 'Load More'}
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </Card>
        </div>
    );
};

export default FileList;