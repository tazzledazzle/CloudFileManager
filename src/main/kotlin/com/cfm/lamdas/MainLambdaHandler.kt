package com.cfm.lambda

import com.amazonaws.services.lambda.runtime.Context
import com.amazonaws.services.lambda.runtime.RequestHandler
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent
import com.amazonaws.services.lambda.runtime.events.S3Event
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Main Lambda handler that routes requests to the appropriate specialized handler
 * This simplifies deployment by using a single Lambda function for multiple event types
 */
class MainLambdaHandler : RequestHandler<Any, Any> {

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    // Initialize specialized handlers
    private val uploadHandler = UploadHandler()
    private val searchHandler = SearchHandler()
    private val extractionHandler = MetadataExtractionHandler()

    override fun handleRequest(input: Any, context: Context): Any {
        val logger = context.logger
        logger.log("Input: $input")

        return when (input) {
            // Handle API Gateway requests
            is APIGatewayProxyRequestEvent -> {
                val path = input.path ?: ""
                val method = input.httpMethod

                when {
                    // Route to upload handler
                    (path == "/files" && method == "POST") ||
                            (path.matches(Regex("/files/[^/]+")) && method == "DELETE") -> {
                        uploadHandler.handleRequest(input, context)
                    }

                    // Route to search handler
                    (path == "/search" && method == "GET") ||
                            (path.matches(Regex("/files/[^/]+")) && method == "GET") ||
                            (path.matches(Regex("/files/[^/]+/download")) && method == "GET") ||
                            (path.matches(Regex("/files/[^/]+/tags")) && method == "PUT") -> {
                        searchHandler.handleRequest(input, context)
                    }

                    // Handle unknown paths
                    else -> {
                        APIGatewayProxyResponseEvent()
                            .withStatusCode(404)
                            .withBody(json.encodeToString(mapOf("error" to "Not found")))
                    }
                }
            }

            // Handle S3 events (for metadata extraction)
            is S3Event -> {
                extractionHandler.handleRequest(input, context)
            }

            // Handle unknown event types
            else -> {
                logger.log("Unsupported event type: ${input.javaClass.name}")
                "Unsupported event type: ${input.javaClass.name}"
            }
        }
    }
}