import datetime
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional

from cloud_file_manager.metadata.metadata_service import MetadataService
from cloud_file_manager.models.file_models import FileModel

logger = logging.getLogger(__name__)


@dataclass
class SearchFilters:
    """
    Filters that can be applied to search results
    """
    tags: List[str] = None
    categories: List[str] = None
    mime_types: List[str] = None
    uploaded_after: Optional[datetime] = None
    uploaded_before: Optional[datetime] = None
    min_size: Optional[int] = None
    max_size: Optional[int] = None

    def __post_init__(self):
        # Initialize empty lists
        if self.tags is None:
            self.tags = []
        if self.categories is None:
            self.categories = []
        if self.mime_types is None:
            self.mime_types = []


class SearchService:
    """Service for searching files based on metadata and content"""

    def __init__(self, metadata_service: MetadataService):
        self.metadata_service = metadata_service

    def search_files(self, query: str, filters: Optional[SearchFilters] = None) -> List[FileModel]:
        """
        Searches for files based on a search query and optional filters

        Args:
            query: The search query
            filters: Optional filters to apply

        Returns:
            List of matching files
        """
        # Initialize filters if not provided
        if filters is None:
            filters = SearchFilters()

        # Get all files that match the basic criteria
        files = self.metadata_service.search_files(
            search_term=query,
            tags=filters.tags,
            mime_types=filters.mime_types
        )

        # Apply additional filtering and ranking
        return self._filter_and_rank_results(files, query, filters)

    def _filter_and_rank_results(
            self, files: List[FileModel], query: str, filters: SearchFilters
    ) -> List[FileModel]:
        """
        Applies additional filtering and ranks search results

        Args:
            files: The initial list of files
            query: The search query
            filters: The search filters

        Returns:
            Filtered and ranked list of files
        """
        # Apply date filters
        filtered_files = []
        for file in files:
            try:
                upload_time = datetime.fromisoformat(file.uploaded_at)
            except (ValueError, TypeError):
                upload_time = datetime.now()

            after_filter = True
            if filters.uploaded_after:
                after_filter = upload_time >= filters.uploaded_after

            before_filter = True
            if filters.uploaded_before:
                before_filter = upload_time <= filters.uploaded_before

            if after_filter and before_filter:
                filtered_files.append(file)

        # Apply size filters
        size_filtered_files = []
        for file in filtered_files:
            min_size_filter = True
            if filters.min_size is not None:
                min_size_filter = file.size >= filters.min_size

            max_size_filter = True
            if filters.max_size is not None:
                max_size_filter = file.size <= filters.max_size

            if min_size_filter and max_size_filter:
                size_filtered_files.append(file)

        # Apply category filters if specified
        if filters.categories:
            category_filtered_files = []
            for file in size_filtered_files:
                if any(
                        category.lower() in [c.lower() for c in file.metadata.categories]
                        for category in filters.categories
                ):
                    category_filtered_files.append(file)
            result_files = category_filtered_files
        else:
            result_files = size_filtered_files

        # Calculate relevance score for each file and sort by it
        scored_files = [
            (file, self._calculate_relevance_score(file, query))
            for file in result_files
        ]
        scored_files.sort(key=lambda x: x[1], reverse=True)

        return [file for file, _ in scored_files]

    def _calculate_relevance_score(self, file: FileModel, query: str) -> float:
        """
        Calculates a relevance score for a file based on how well it matches the query

        Args:
            file: The file model
            query: The search query

        Returns:
            A relevance score (higher is better)
        """
        if not query:
            return 1.0  # No query means all files are equally relevant

        score = 0.0
        query_lower = query.lower()
        query_terms = re.split(r'\s+', query_lower)

        # Check filename match (highest weight)
        file_name_lower = file.name.lower()
        if query_lower in file_name_lower:
            score += 10.0

        # Add points for each query term in the filename
        for term in query_terms:
            if term in file_name_lower:
                score += 5.0

        # Check tags match
        for tag in file.tags:
            tag_lower = tag.lower()
            if query_lower in tag_lower:
                score += 3.0

            for term in query_terms:
                if term in tag_lower:
                    score += 1.5

        # Check categories match
        for category in file.metadata.categories:
            category_lower = category.lower()
            if query_lower in category_lower:
                score += 3.0

            for term in query_terms:
                if term in category_lower:
                    score += 1.5

        # Check extracted text match
        if file.metadata.extracted_text:
            text_lower = file.metadata.extracted_text.lower()

            # Add points for exact matches
            exact_matches = len(re.findall(re.escape(query_lower), text_lower))
            score += exact_matches * 2.0

            # Add points for individual term matches
            for term in query_terms:
                term_matches = len(re.findall(re.escape(term), text_lower))
                score += term_matches * 0.5

        # Check entity matches
        for entity in file.metadata.entities:
            entity_text_lower = entity.text.lower()
            if query_lower in entity_text_lower:
                score += 2.0

            for term in query_terms:
                if term in entity_text_lower:
                    score += 1.0

        return score