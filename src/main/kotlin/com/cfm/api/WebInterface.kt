package com.cfm.api

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.html.*
import io.ktor.server.http.content.*
import io.ktor.server.routing.*
import kotlinx.html.*

/**
 * Configures the web interface for the file manager
 */
fun Application.configureWebInterface() {
    routing {
        // Serve static files from resources/static directory
        static("/static") {
            resources("static")
        }

        // Home page
        get("/") {
            call.respondHtml(HttpStatusCode.OK) {
                head {
                    title("Cloud File Manager")
                    meta(name = "viewport", content = "width=device-width, initial-scale=1.0")
                    // Include Bootstrap CSS
                    link(rel = "stylesheet", href = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css")
                    // Include custom CSS
                    style {
                        +"""
                        .header { background-color: #f8f9fa; padding: 20px 0; margin-bottom: 30px; }
                        .file-card { margin-bottom: 20px; }
                        .search-box { margin-bottom: 20px; }
                        .upload-section { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 30px; }
                        .file-details { margin-top: 20px; }
                        .tag { background-color: #e9ecef; padding: 3px 8px; border-radius: 3px; margin-right: 5px; }
                        """
                    }
                }
                body {
                    div("container") {
                        div("header text-center") {
                            h1 { +"Cloud File Manager" }
                            p("lead") { +"Intelligent file storage with ML metadata analysis" }
                        }

                        div("row") {
                            div("col-md-12") {
                                div("upload-section") {
                                    h3 { +"Upload Files" }
                                    form(action = "/files", method = FormMethod.post, encType = FormEncType.multipartFormData) {
                                        id = "uploadForm"
                                        div("mb-3") {
                                            label("form-label") {
                                                htmlFor = "fileInput"
                                                +"Select File"
                                            }
                                            input(type = InputType.file, classes = "form-control") {
                                                id = "fileInput"
                                                name = "file"
                                                required = true
                                            }
                                        }
                                        div("mb-3") {
                                            label("form-label") {
                                                htmlFor = "tagsInput"
                                                +"Tags (comma-separated)"
                                            }
                                            input(type = InputType.text, classes = "form-control") {
                                                id = "tagsInput"
                                                name = "tags"
                                                placeholder = "tag1, tag2, tag3"
                                            }
                                        }
                                        button(type = ButtonType.submit, classes = "btn btn-primary") {
                                            +"Upload"
                                        }
                                    }
                                    div("upload-progress mt-3 d-none") {
                                        div("progress") {
                                            div("progress-bar") {
                                                role = "progressbar"
                                                style = "width: 0%"
                                                attributes["aria-valuenow"] = "0"
                                                attributes["aria-valuemin"] = "0"
                                                attributes["aria-valuemax"] = "100"
                                            }
                                        }
                                        p("progress-text mt-2") { +"Uploading..." }
                                    }
                                }
                            }
                        }

                        div("row") {
                            div("col-md-12") {
                                div("search-box") {
                                    h3 { +"Search Files" }
                                    div("input-group") {
                                        input(type = InputType.text, classes = "form-control") {
                                            id = "searchInput"
                                            placeholder = "Search by name, content, tags..."
                                        }
                                        button(type = ButtonType.button, classes = "btn btn-outline-secondary") {
                                            id = "searchButton"
                                            +"Search"
                                        }
                                    }
                                    div("mt-2") {
                                        select("form-select") {
                                            id = "filterType"
                                            option { value = ""; +"All Types" }
                                            option { value = "image"; +"Images" }
                                            option { value = "document"; +"Documents" }
                                            option { value = "spreadsheet"; +"Spreadsheets" }
                                            option { value = "presentation"; +"Presentations" }
                                        }
                                    }
                                }
                            }
                        }

                        div("row file-list") {
                            // Files will be loaded here dynamically
                        }

                        // File details modal
                        div("modal fade") {
                            id = "fileDetailsModal"
                            tabIndex = "-1"
                            role = "dialog"
                            attributes["aria-labelledby"] = "fileDetailsModalLabel"
                            attributes["aria-hidden"] = "true"

                            div("modal-dialog modal-lg") {
                                div("modal-content") {
                                    div("modal-header") {
                                        h5("modal-title") {
                                            id = "fileDetailsModalLabel"
                                            +"File Details"
                                        }
                                        button(type = ButtonType.button, classes = "btn-close") {
                                            attributes["data-bs-dismiss"] = "modal"
                                            attributes["aria-label"] = "Close"
                                        }
                                    }
                                    div("modal-body") {
                                        // File details will be loaded here dynamically
                                    }
                                    div("modal-footer") {
                                        button(type = ButtonType.button, classes = "btn btn-secondary") {
                                            attributes["data-bs-dismiss"] = "modal"
                                            +"Close"
                                        }
                                        a(classes = "btn btn-primary", href = "#") {
                                            id = "downloadButton"
                                            +"Download"
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Include Bootstrap JS and other scripts
                    script(src = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js") {}
                    script(src = "https://code.jquery.com/jquery-3.6.0.min.js") {}
                    script {
                        unsafe {
                            +"""
                            $(document).ready(function() {
                                // Load files on page load
                                loadFiles();
                                
                                // Handle search button click
                                $('#searchButton').click(function() {
                                    loadFiles();
                                });
                                
                                // Handle search input enter key
                                $('#searchInput').keypress(function(e) {
                                    if (e.which === 13) {
                                        loadFiles();
                                    }
                                });
                                
                                // Handle filter change
                                $('#filterType').change(function() {
                                    loadFiles();
                                });
                                
                                // Handle file upload
                                $('#uploadForm').submit(function(e) {
                                    e.preventDefault();
                                    
                                    var formData = new FormData();
                                    var fileInput = $('#fileInput')[0];
                                    
                                    if (fileInput.files.length === 0) {
                                        alert('Please select a file to upload');
                                        return;
                                    }
                                    
                                    formData.append('file', fileInput.files[0]);
                                    formData.append('tags', $('#tagsInput').val());
                                    
                                    // Show progress bar
                                    $('.upload-progress').removeClass('d-none');
                                    
                                    $.ajax({
                                        url: '/files',
                                        type: 'POST',
                                        data: formData,
                                        processData: false,
                                        contentType: false,
                                        xhr: function() {
                                            var xhr = new window.XMLHttpRequest();
                                            xhr.upload.addEventListener('progress', function(e) {
                                                if (e.lengthComputable) {
                                                    var percent = Math.round((e.loaded / e.total) * 100);
                                                    $('.progress-bar').css('width', percent + '%');
                                                    $('.progress-bar').attr('aria-valuenow', percent);
                                                    $('.progress-text').text('Uploading... ' + percent + '%');
                                                }
                                            });
                                            return xhr;
                                        },
                                        success: function(data) {
                                            // Clear form
                                            $('#uploadForm')[0].reset();
                                            
                                            // Hide progress bar
                                            $('.upload-progress').addClass('d-none');
                                            
                                            // Show success message
                                            alert('File uploaded successfully!');
                                            
                                            // Reload files
                                            loadFiles();
                                        },
                                        error: function(xhr) {
                                            // Hide progress bar
                                            $('.upload-progress').addClass('d-none');
                                            
                                            // Show error message
                                            var errorMessage = 'Error uploading file';
                                            if (xhr.responseJSON && xhr.responseJSON.error) {
                                                errorMessage = xhr.responseJSON.error;
                                            }
                                            alert(errorMessage);
                                        }
                                    });
                                });
                                
                                // Function to load files
                                function loadFiles() {
                                    var query = $('#searchInput').val();
                                    var fileType = $('#filterType').val();
                                    
                                    var url = '/search?q=' + encodeURIComponent(query);
                                    if (fileType) {
                                        url += '&types=' + encodeURIComponent(fileType);
                                    }
                                    
                                    $.ajax({
                                        url: url,
                                        type: 'GET',
                                        success: function(data) {
                                            var fileList = $('.file-list');
                                            fileList.empty();
                                            
                                            if (data.length === 0) {
                                                fileList.append('<div class="col-12 text-center"><p>No files found</p></div>');
                                                return;
                                            }
                                            
                                            $.each(data, function(i, file) {
                                                var card = $('<div class="col-md-3 file-card">');
                                                var cardContent = $('<div class="card h-100">');
                                                
                                                // Determine icon based on MIME type
                                                var icon = 'bi-file';
                                                if (file.mimeType.startsWith('image/')) {
                                                    icon = 'bi-file-image';
                                                } else if (file.mimeType.includes('pdf')) {
                                                    icon = 'bi-file-pdf';
                                                } else if (file.mimeType.includes('spreadsheet')) {
                                                    icon = 'bi-file-spreadsheet';
                                                } else if (file.mimeType.includes('document')) {
                                                    icon = 'bi-file-text';
                                                }
                                                
                                                cardContent.append(
                                                    '<div class="card-body text-center">' +
                                                    '<i class="bi ' + icon + ' fs-1"></i>' +
                                                    '<h5 class="card-title mt-2">' + file.name + '</h5>' +
                                                    '<p class="card-text small">' + formatBytes(file.size) + '</p>' +
                                                    '<button class="btn btn-sm btn-outline-primary view-details" data-file-id="' + file.id + '">View Details</button>' +
                                                    '</div>'
                                                );
                                                
                                                card.append(cardContent);
                                                fileList.append(card);
                                            });
                                            
                                            // Handle view details button click
                                            $('.view-details').click(function() {
                                                var fileId = $(this).data('file-id');
                                                showFileDetails(fileId);
                                            });
                                        },
                                        error: function() {
                                            var fileList = $('.file-list');
                                            fileList.empty();
                                            fileList.append('<div class="col-12 text-center"><p>Error loading files</p></div>');
                                        }
                                    });
                                }
                                
                                // Function to show file details
                                function showFileDetails(fileId) {
                                    $.ajax({
                                        url: '/files/' + fileId,
                                        type: 'GET',
                                        success: function(file) {
                                            var modalBody = $('#fileDetailsModal .modal-body');
                                            modalBody.empty();
                                            
                                            // Set download button URL
                                            $('#downloadButton').attr('href', '/files/' + file.id + '/download');
                                            
                                            // Build details HTML
                                            var detailsHtml = '<div class="row">';
                                            
                                            // Basic file info
                                            detailsHtml += '<div class="col-md-6">';
                                            detailsHtml += '<h6>File Information</h6>';
                                            detailsHtml += '<ul class="list-group">';
                                            detailsHtml += '<li class="list-group-item"><strong>Name:</strong> ' + file.name + '</li>';
                                            detailsHtml += '<li class="list-group-item"><strong>Size:</strong> ' + formatBytes(file.size) + '</li>';
                                            detailsHtml += '<li class="list-group-item"><strong>Type:</strong> ' + file.mimeType + '</li>';
                                            detailsHtml += '<li class="list-group-item"><strong>Uploaded:</strong> ' + new Date(file.uploadedAt).toLocaleString() + '</li>';
                                            detailsHtml += '</ul>';
                                            detailsHtml += '</div>';
                                            
                                            // Metadata info
                                            detailsHtml += '<div class="col-md-6">';
                                            detailsHtml += '<h6>Metadata</h6>';
                                            detailsHtml += '<ul class="list-group">';
                                            
                                            // Content type
                                            detailsHtml += '<li class="list-group-item"><strong>Content Type:</strong> ' + file.metadata.contentType + '</li>';
                                            
                                            // Categories
                                            if (file.metadata.categories && file.metadata.categories.length > 0) {
                                                detailsHtml += '<li class="list-group-item"><strong>Categories:</strong> ';
                                                $.each(file.metadata.categories, function(i, category) {
                                                    detailsHtml += '<span class="tag">' + category + '</span>';
                                                });
                                                detailsHtml += '</li>';
                                            }
                                            
                                            // Tags
                                            if (file.tags && file.tags.length > 0) {
                                                detailsHtml += '<li class="list-group-item"><strong>Tags:</strong> ';
                                                $.each(file.tags, function(i, tag) {
                                                    detailsHtml += '<span class="tag">' + tag + '</span>';
                                                });
                                                detailsHtml += '</li>';
                                            }
                                            
                                            detailsHtml += '</ul>';
                                            detailsHtml += '</div>';
                                            
                                            // Extracted content section
                                            if (file.metadata.extractedText) {
                                                detailsHtml += '<div class="col-12 mt-3">';
                                                detailsHtml += '<h6>Extracted Content</h6>';
                                                detailsHtml += '<div class="card"><div class="card-body"><pre class="content-preview">' + 
                                                    file.metadata.extractedText.substring(0, 500) + 
                                                    (file.metadata.extractedText.length > 500 ? '...' : '') + 
                                                    '</pre></div></div>';
                                                detailsHtml += '</div>';
                                            }
                                            
                                            // Image metadata
                                            if (file.metadata.imageData) {
                                                detailsHtml += '<div class="col-12 mt-3">';
                                                detailsHtml += '<h6>Image Analysis</h6>';
                                                
                                                // Detected objects
                                                if (file.metadata.imageData.detectedObjects && file.metadata.imageData.detectedObjects.length > 0) {
                                                    detailsHtml += '<p><strong>Detected Objects:</strong></p>';
                                                    detailsHtml += '<ul>';
                                                    $.each(file.metadata.imageData.detectedObjects, function(i, obj) {
                                                        detailsHtml += '<li>' + obj.name + ' (' + Math.round(obj.confidence) + '% confidence)</li>';
                                                    });
                                                    detailsHtml += '</ul>';
                                                }
                                                
                                                detailsHtml += '</div>';
                                            }
                                            
                                            // Document metadata
                                            if (file.metadata.documentData) {
                                                detailsHtml += '<div class="col-12 mt-3">';
                                                detailsHtml += '<h6>Document Analysis</h6>';
                                                
                                                // Document type
                                                if (file.metadata.documentData.documentType) {
                                                    detailsHtml += '<p><strong>Document Type:</strong> ' + file.metadata.documentData.documentType + '</p>';
                                                }
                                                
                                                // Key-value pairs
                                                if (file.metadata.documentData.keyValuePairs && Object.keys(file.metadata.documentData.keyValuePairs).length > 0) {
                                                    detailsHtml += '<p><strong>Extracted Fields:</strong></p>';
                                                    detailsHtml += '<table class="table table-sm">';
                                                    detailsHtml += '<thead><tr><th>Field</th><th>Value</th></tr></thead>';
                                                    detailsHtml += '<tbody>';
                                                    
                                                    $.each(file.metadata.documentData.keyValuePairs, function(key, value) {
                                                        detailsHtml += '<tr><td>' + key + '</td><td>' + value + '</td></tr>';
                                                    });
                                                    
                                                    detailsHtml += '</tbody></table>';
                                                }
                                                
                                                detailsHtml += '</div>';
                                            }
                                            
                                            // Entities
                                            if (file.metadata.entities && file.metadata.entities.length > 0) {
                                                detailsHtml += '<div class="col-12 mt-3">';
                                                detailsHtml += '<h6>Extracted Entities</h6>';
                                                
                                                detailsHtml += '<table class="table table-sm">';
                                                detailsHtml += '<thead><tr><th>Text</th><th>Type</th><th>Confidence</th></tr></thead>';
                                                detailsHtml += '<tbody>';
                                                
                                                $.each(file.metadata.entities, function(i, entity) {
                                                    detailsHtml += '<tr><td>' + entity.text + '</td><td>' + entity.type + '</td><td>' + 
                                                        Math.round(entity.confidence * 100) + '%</td></tr>';
                                                });
                                                
                                                detailsHtml += '</tbody></table>';
                                                detailsHtml += '</div>';
                                            }
                                            
                                            detailsHtml += '</div>'; // Close row
                                            
                                            modalBody.html(detailsHtml);
                                            
                                            // Show modal
                                            var fileDetailsModal = new bootstrap.Modal(document.getElementById('fileDetailsModal'));
                                            fileDetailsModal.show();
                                        },
                                        error: function() {
                                            alert('Error loading file details');
                                        }
                                    });
                                }
                                
                                // Format bytes to human-readable size
                                function formatBytes(bytes, decimals = 2) {
                                    if (bytes === 0) return '0 Bytes';
                                    
                                    const k = 1024;
                                    const dm = decimals < 0 ? 0 : decimals;
                                    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
                                    
                                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                                    
                                    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
                                }
                            });
                            """
                        }
                    }
                }
            }
        }
    }
}