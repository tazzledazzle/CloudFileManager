package com.cfm.search

import com.cfm.metadata.MetadataService
import com.cfm.model.FileModel
import kotlinx.serialization.json.Json
import java.util.*

/**
 * Service for searching files based on metadata and content
 */
class SearchService(private val metadataService: MetadataService) {

    /**
     * Searches for files based on a search query and optional filters
     *
     * @param query The search query
     * @param filters Optional filters to apply
     * @return List of matching files
     */
    suspend fun searchFiles(query: String, filters: SearchFilters = SearchFilters()): List<FileModel> {
        // Get all files that match the basic criteria
        val files = metadataService.searchFiles(
            searchTerm = query,
            tags = filters.tags,
            mimeTypes = filters.mimeTypes
        )

        // Apply additional filtering and ranking
        return filterAndRankResults(files, query, filters)
    }

    /**
     * Applies additional filtering and ranks search results
     *
     * @param files The initial list of files
     * @param query The search query
     * @param filters The search filters
     * @return Filtered and ranked list of files
     */
    private fun filterAndRankResults(
        files: List<FileModel>,
        query: String,
        filters: SearchFilters
    ): List<FileModel> {
        // Apply date filters
        var filteredFiles = files.filter { file ->
            val uploadTime = try {
                Date.from(java.time.Instant.parse(file.uploadedAt))
            } catch (e: Exception) {
                Date()
            }

            val afterFilter = filters.uploadedAfter?.let { uploadTime.after(it) } ?: true
            val beforeFilter = filters.uploadedBefore?.let { uploadTime.before(it) } ?: true

            afterFilter && beforeFilter
        }

        // Apply size filters
        filteredFiles = filteredFiles.filter { file ->
            val minSizeFilter = filters.minSize?.let { file.size >= it } ?: true
            val maxSizeFilter = filters.maxSize?.let { file.size <= it } ?: true

            minSizeFilter && maxSizeFilter
        }

        // Apply category filters if specified
        if (filters.categories.isNotEmpty()) {
            filteredFiles = filteredFiles.filter { file ->
                file.metadata.categories.any { category ->
                    filters.categories.any { it.equals(category, ignoreCase = true) }
                }
            }
        }

        // Calculate relevance score for each file and sort by it
        return filteredFiles.map { file ->
            val relevanceScore = calculateRelevanceScore(file, query)
            Pair(file, relevanceScore)
        }
            .sortedByDescending { it.second }
            .map { it.first }
    }

    /**
     * Calculates a relevance score for a file based on how well it matches the query
     *
     * @param file The file model
     * @param query The search query
     * @return A relevance score (higher is better)
     */
    private fun calculateRelevanceScore(file: FileModel, query: String): Double {
        if (query.isEmpty()) {
            return 1.0 // No query means all files are equally relevant
        }

        var score = 0.0
        val lowerQuery = query.lowercase()
        val queryTerms = lowerQuery.split(Regex("\\s+"))

        // Check filename match (highest weight)
        val fileNameLower = file.name.lowercase()
        if (fileNameLower.contains(lowerQuery)) {
            score += 10.0
        }

        // Add points for each query term in the filename
        queryTerms.forEach { term ->
            if (fileNameLower.contains(term)) {
                score += 5.0
            }
        }

        // Check tags match
        file.tags.forEach { tag ->
            if (tag.lowercase().contains(lowerQuery)) {
                score += 3.0
            }

            queryTerms.forEach { term ->
                if (tag.lowercase().contains(term)) {
                    score += 1.5
                }
            }
        }

        // Check categories match
        file.metadata.categories.forEach { category ->
            if (category.lowercase().contains(lowerQuery)) {
                score += 3.0
            }

            queryTerms.forEach { term ->
                if (category.lowercase().contains(term)) {
                    score += 1.5
                }
            }
        }

        // Check extracted text match
        file.metadata.extractedText?.let { text ->
            val lowerText = text.lowercase()

            // Add points for exact matches
            val exactMatches = lowerQuery.toRegex().findAll(lowerText).count()
            score += exactMatches * 2.0

            // Add points for individual term matches
            queryTerms.forEach { term ->
                val termMatches = term.toRegex().findAll(lowerText).count()
                score += termMatches * 0.5
            }
        }

        // Check entity matches
        file.metadata.entities.forEach { entity ->
            if (entity.text.lowercase().contains(lowerQuery)) {
                score += 2.0
            }

            queryTerms.forEach { term ->
                if (entity.text.lowercase().contains(term)) {
                    score += 1.0
                }
            }
        }

        return score
    }
}

/**
 * Filters that can be applied to search results
 */
data class SearchFilters(
    val tags: List<String> = emptyList(),
    val categories: List<String> = emptyList(),
    val mimeTypes: List<String> = emptyList(),
    val uploadedAfter: Date? = null,
    val uploadedBefore: Date? = null,
    val minSize: Long? = null,
    val maxSize: Long? = null
)