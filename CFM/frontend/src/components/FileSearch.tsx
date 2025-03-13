// src/components/FileSearch.tsx
import React, { useState, useEffect } from 'react';
import {
    Form, Button, Card, Badge, Spinner, Alert,
    ListGroup, InputGroup, Row, Col, Tabs, Tab
} from 'react-bootstrap';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { format } from 'date-fns';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://kjbhwt25fh.execute-api.us-west-2.amazonaws.com/prod';

interface SearchResult {
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    uploadDate: string;
    fileExtension: string;
    documentType?: string;
    securityStatus?: string;
    relevanceScore?: number;
    highlights?: string[];
    keyPhrases?: string[];
}

interface SearchQueryAnalysis {
    intent?: string;
    keyPhrases?: string[];
    entities?: Array<{ type: string; text: string }>;
    mainConcept?: string;
}

interface FileSearchProps {
    userId: string;
}

const FileSearch: React.FC<FileSearchProps> = ({ userId }) => {
    const navigate = useNavigate();
    const location = useLocation();

    // Parse query parameters
    const queryParams = new URLSearchParams(location.search);
    const initialQuery = queryParams.get('q') || '';
    const initialSearchType = queryParams.get('type') as 'basic' | 'natural' | 'semantic' || 'natural';

    const [searchQuery, setSearchQuery] = useState(initialQuery);
    const [searchType, setSearchType] = useState<'basic' | 'natural' | 'semantic'>(initialSearchType);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [resultCount, setResultCount] = useState(0);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [queryAnalysis, setQueryAnalysis] = useState<SearchQueryAnalysis | null>(null);
    const [activeTab, setActiveTab] = useState<string>('results');
    const [recentSearches, setRecentSearches] = useState<string[]>([]);

    // Load recent searches from localStorage
    useEffect(() => {
        const savedSearches = localStorage.getItem('recentSearches');
        if (savedSearches) {
            setRecentSearches(JSON.parse(savedSearches));
        }
    }, []);

    // Save a search to recent searches
    const saveSearch = (query: string) => {
        if (!query.trim()) return;

        const updatedSearches = [query, ...recentSearches.filter(s => s !== query)].slice(0, 10);
        setRecentSearches(updatedSearches);
        localStorage.setItem('recentSearches', JSON.stringify(updatedSearches));
    };

    // Clear recent searches
    const clearRecentSearches = () => {
        setRecentSearches([]);
        localStorage.removeItem('recentSearches');
    };

    // Use a search from history
    const useRecentSearch = (query: string) => {
        setSearchQuery(query);
        handleSearch(query);
    };

    // Perform search
    const handleSearch = async (query = searchQuery) => {
        if (!query.trim()) return;

        try {
            setLoading(true);
            setError('');

            // Update URL with search parameters
            navigate({
                pathname: '/search',
                search: `?q=${encodeURIComponent(query)}&type=${searchType}`
            });

            // Save search to history
            saveSearch(query);

            // Determine which endpoint to use based on search type
            let endpoint;
            if (searchType === 'basic') {
                endpoint = `${API_BASE_URL}/search`;
            } else if (searchType === 'natural') {
                endpoint = `${API_BASE_URL}/nl-search`;
            } else {
                endpoint = `${API_BASE_URL}/nl-search`; // semantic search is also handled by nl-search
            }

            const response = await axios.get(endpoint, {
                params: {
                    userId,
                    q: query,
                    searchType,
                    limit: 50
                }
            });

            // Process results
            if (response.data.results) {
                setResults(response.data.results.files || []);
                setResultCount(response.data.results.count || 0);
            } else {
                setResults([]);
                setResultCount(0);
            }

            // Process suggestions if available
            if (response.data.suggestions) {
                setSuggestions(response.data.suggestions);
            } else {
                setSuggestions([]);
            }

            // Process query analysis if available
            if (response.data.analysis) {
                setQueryAnalysis(response.data.analysis);
                setActiveTab('analysis'); // Show analysis tab for natural language searches
            } else {
                setQueryAnalysis(null);
                setActiveTab('results');
            }
        } catch (err) {
            setError(`Search failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            console.error('Search error:', err);
        } finally {
            setLoading(false);
        }
    };

    // Handle form submission
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleSearch();
    };

    // Use a suggested search
    const useSuggestion = (suggestion: string) => {
        setSearchQuery(suggestion);
        handleSearch(suggestion);
    };

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

    // Highlight text with search terms
    const highlightText = (text: string, searchTerms: string[]): React.ReactNode => {
        if (!searchTerms.length) return text;

        const regex = new RegExp(`(${searchTerms.join('|')})`, 'gi');
        const parts = text.split(regex);

        return parts.map((part, i) =>
            regex.test(part) ? <mark key={i}>{part}</mark> : part
        );
    };

    // Run search on initial load if query is provided
    useEffect(() => {
        if (initialQuery) {
            handleSearch(initialQuery);
        }
    }, []);

    return (
        <div className="my-4">
            <h2 className="mb-4">Search Files</h2>

            <Row>
                <Col lg={4} xl={3} className="mb-4">
                    <Card className="mb-4">
                        <Card.Header>
                            <h5 className="mb-0">Search Options</h5>
                        </Card.Header>
                        <Card.Body>
                            <Form onSubmit={handleSubmit}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Search Type</Form.Label>
                                    <div>
                                        <Form.Check
                                            inline
                                            type="radio"
                                            id="basic-search"
                                            label="Basic"
                                            name="searchType"
                                            checked={searchType === 'basic'}
                                            onChange={() => setSearchType('basic')}
                                        />
                                        <Form.Check
                                            inline
                                            type="radio"
                                            id="natural-search"
                                            label="Natural Language"
                                            name="searchType"
                                            checked={searchType === 'natural'}
                                            onChange={() => setSearchType('natural')}
                                        />
                                        <Form.Check
                                            inline
                                            type="radio"
                                            id="semantic-search"
                                            label="Semantic"
                                            name="searchType"
                                            checked={searchType === 'semantic'}
                                            onChange={() => setSearchType('semantic')}
                                        />
                                    </div>
                                    <Form.Text className="text-muted">
                                        {searchType === 'basic' ?
                                            'Search by keywords and exact matches' :
                                            searchType === 'natural' ?
                                                'Use natural language like "contracts from last month"' :
                                                'Find conceptually similar content even with different wording'}
                                    </Form.Text>
                                </Form.Group>

                                <Form.Group className="mb-3">
                                    <Form.Label>Search Query</Form.Label>
                                    <InputGroup>
                                        <Form.Control
                                            type="text"
                                            placeholder={searchType === 'basic' ?
                                                "Enter keywords..." :
                                                "Ask a question or describe what you're looking for..."}
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                        <Button
                                            variant="primary"
                                            type="submit"
                                            disabled={loading || !searchQuery.trim()}
                                        >
                                            <i className="bi bi-search"></i>
                                        </Button>
                                    </InputGroup>
                                </Form.Group>
                            </Form>

                            {recentSearches.length > 0 && (
                                <div className="mt-4">
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <h6 className="mb-0">Recent Searches</h6>
                                        <Button
                                            variant="link"
                                            className="p-0 btn-sm text-muted"
                                            onClick={clearRecentSearches}
                                        >
                                            Clear
                                        </Button>
                                    </div>
                                    <ListGroup variant="flush" className="border-top">
                                        {recentSearches.map((query, index) => (
                                            <ListGroup.Item
                                                key={index}
                                                action
                                                className="px-0 py-2 d-flex justify-content-between align-items-center"
                                                onClick={() => useRecentSearch(query)}
                                            >
                                                <div className="text-truncate">{query}</div>
                                                <i className="bi bi-arrow-return-left text-muted"></i>
                                            </ListGroup.Item>
                                        ))}
                                    </ListGroup>
                                </div>
                            )}

                            {suggestions.length > 0 && (
                                <div className="mt-4">
                                    <h6 className="mb-2">Try these searches:</h6>
                                    <ListGroup variant="flush" className="border-top">
                                        {suggestions.map((suggestion, index) => (
                                            <ListGroup.Item
                                                key={index}
                                                action
                                                className="px-0 py-2 d-flex justify-content-between align-items-center"
                                                onClick={() => useSuggestion(suggestion)}
                                            >
                                                <div className="text-truncate">{suggestion}</div>
                                                <i className="bi bi-search text-muted"></i>
                                            </ListGroup.Item>
                                        ))}
                                    </ListGroup>
                                </div>
                            )}

                            <div className="mt-4">
                                <h6 className="mb-2">Search Tips</h6>
                                <ul className="small ps-3">
                                    <li>Use natural language to find specific document types</li>
                                    <li>Include date ranges like "from last month"</li>
                                    <li>Specify people or organizations by name</li>
                                    <li>Try specific phrases in quotes for exact matches</li>
                                    <li>Combine multiple concepts with AND/OR</li>
                                </ul>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>

                <Col lg={8} xl={9}>
                    {error && <Alert variant="danger">{error}</Alert>}

                    {loading ? (
                        <div className="text-center p-5">
                            <Spinner animation="border" role="status">
                                <span className="visually-hidden">Searching...</span>
                            </Spinner>
                            <p className="mt-3 text-muted">Searching your files...</p>
                        </div>
                    ) : searchQuery && (
                        <div>
                            <Card className="mb-4">
                                <Card.Body>
                                    <div className="d-flex justify-content-between align-items-start">
                                        <div>
                                            <h5 className="mb-2">Search Results</h5>
                                            <p className="text-muted mb-0">
                                                Found {resultCount} results for "{searchQuery}"
                                            </p>
                                        </div>
                                        <Button
                                            variant="outline-secondary"
                                            size="sm"
                                            onClick={() => navigate('/')}
                                        >
                                            <i className="bi bi-arrow-left me-1"></i> Back to Files
                                        </Button>
                                    </div>
                                </Card.Body>
                            </Card>

                            {(queryAnalysis || results.length > 0) && (
                                <Tabs
                                    activeKey={activeTab}
                                    onSelect={(k) => setActiveTab(k || 'results')}
                                    className="mb-4"
                                >
                                    <Tab eventKey="results" title="Results">
                                        {results.length === 0 ? (
                                            <Card>
                                                <Card.Body className="text-center p-5">
                                                    <i className="bi bi-search display-1 text-muted"></i>
                                                    <p className="h5 mt-3">No files match your search</p>
                                                    <p className="text-muted mb-0">Try different search terms or options</p>
                                                </Card.Body>
                                            </Card>
                                        ) : (
                                            <div>
                                                {results.map(result => (
                                                    <Card key={result.fileId} className="mb-3">
                                                        <Card.Body>
                                                            <Link to={`/files/${result.fileId}`} className="text-decoration-none">
                                                                <h5 className="mb-1 d-flex align-items-center">
                                                                    <i className={`${getDocumentTypeIcon(result.documentType)} me-2 text-secondary`}></i>
                                                                    {highlightText(result.fileName, queryAnalysis?.keyPhrases || [searchQuery])}
                                                                </h5>
                                                            </Link>

                                                            <div className="d-flex gap-2 mb-3">
                                                                <Badge bg={getFileTypeBadge(result.fileType)}>
                                                                    {result.fileExtension?.toUpperCase() || 'FILE'}
                                                                </Badge>

                                                                {result.documentType && (
                                                                    <Badge bg="secondary" text="dark" className="bg-light border">
                                                                        {result.documentType}
                                                                    </Badge>
                                                                )}

                                                                <small className="text-muted">
                                                                    {formatFileSize(result.fileSize)} • {format(new Date(result.uploadDate), 'MMM d, yyyy')}
                                                                </small>

                                                                {result.relevanceScore !== undefined && (
                                                                    <Badge bg="info" className="ms-auto">
                                                                        Relevance: {(result.relevanceScore * 100).toFixed(0)}%
                                                                    </Badge>
                                                                )}
                                                            </div>

                                                            {result.highlights && result.highlights.length > 0 && (
                                                                <div className="mb-2">
                                                                    {result.highlights.map((highlight, i) => (
                                                                        <div key={i} className="text-muted mb-1 small">
                                                                            <i className="bi bi-quote me-1"></i>
                                                                            {highlightText(highlight, queryAnalysis?.keyPhrases || [searchQuery])}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {result.keyPhrases && result.keyPhrases.length > 0 && (
                                                                <div className="d-flex gap-1 flex-wrap">
                                                                    {result.keyPhrases.slice(0, 6).map((phrase, i) => (
                                                                        <Badge
                                                                            key={i}
                                                                            bg="light"
                                                                            text="dark"
                                                                            className="text-muted border"
                                                                            style={{ fontSize: '0.75rem' }}
                                                                        >
                                                                            {phrase}
                                                                        </Badge>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </Card.Body>
                                                    </Card>
                                                ))}
                                            </div>
                                        )}
                                    </Tab>

                                    {queryAnalysis && (
                                        <Tab eventKey="analysis" title="Analysis">
                                            <Card>
                                                <Card.Body>
                                                    <h5 className="mb-3">Query Analysis</h5>

                                                    <p className="mb-3">
                                                        <strong>Intent:</strong> {queryAnalysis.intent === 'find'
                                                        ? 'Find documents matching criteria'
                                                        : queryAnalysis.intent === 'count'
                                                            ? 'Count matching documents'
                                                            : 'Summarize or analyze content'}
                                                    </p>

                                                    {queryAnalysis.mainConcept && (
                                                        <p className="mb-3">
                                                            <strong>Main Topic:</strong> {queryAnalysis.mainConcept}
                                                        </p>
                                                    )}

                                                    {queryAnalysis.keyPhrases && queryAnalysis.keyPhrases.length > 0 && (
                                                        <div className="mb-3">
                                                            <strong>Key Phrases:</strong>
                                                            <div className="d-flex flex-wrap gap-1 mt-2">
                                                                {queryAnalysis.keyPhrases.map((phrase, i) => (
                                                                    <Badge key={i} bg="primary">
                                                                        {phrase}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {queryAnalysis.entities && queryAnalysis.entities.length > 0 && (
                                                        <div>
                                                            <strong>Entities:</strong>
                                                            <ListGroup variant="flush" className="mt-2">
                                                                {queryAnalysis.entities.map((entity, i) => (
                                                                    <ListGroup.Item key={i} className="d-flex justify-content-between align-items-center">
                                                                        <span>{entity.text}</span>
                                                                        <Badge bg="secondary">{entity.type}</Badge>
                                                                    </ListGroup.Item>
                                                                ))}
                                                            </ListGroup>
                                                        </div>
                                                    )}
                                                </Card.Body>
                                            </Card>
                                        </Tab>
                                    )}
                                </Tabs>
                            )}
                        </div>
                    )}

                    {!loading && !searchQuery && (
                        <Card>
                            <Card.Body className="text-center py-5">
                                <i className="bi bi-search display-1 text-muted"></i>
                                <h3 className="mt-4">Search Your Files</h3>
                                <p className="text-muted mb-4 col-md-8 mx-auto">
                                    Type your search query in the search box to find files.
                                    You can use natural language queries like "contracts from last month" or
                                    "reports mentioning quarterly earnings".
                                </p>
                                <div className="row justify-content-center">
                                    <div className="col-md-8">
                                        <Form onSubmit={handleSubmit}>
                                            <InputGroup>
                                                <Form.Control
                                                    size="lg"
                                                    type="text"
                                                    placeholder="What are you looking for?"
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                />
                                                <Button variant="primary" type="submit">
                                                    <i className="bi bi-search me-1"></i> Search
                                                </Button>
                                            </InputGroup>
                                        </Form>
                                    </div>
                                </div>
                            </Card.Body>
                        </Card>
                    )}
                </Col>
            </Row>
        </div>
    );
};

export default FileSearch;