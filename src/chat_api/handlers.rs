//! HTTP handlers for the Chat API.

use super::types::*;
use super::ChatState;
use crate::chat::MessageRole;
use crate::document::{extract_text, DocumentType};
use crate::export::{export_chat, ExportChat, ExportFormat, ExportMessage};
use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use std::sync::{Arc, MutexGuard};

/// Helper to lock the database, returning a 500 error response on failure.
#[allow(clippy::result_large_err)] // Response is large but error path is rare
fn lock_db(state: &ChatState) -> Result<MutexGuard<'_, crate::chat::ChatDb>, Response> {
    state.db.lock().map_err(|e| {
        ApiError::internal(format!("Database lock error: {}", e)).into_response()
    })
}

pub async fn list_chats(State(state): State<Arc<ChatState>>) -> impl IntoResponse {
    let db = match lock_db(&state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match db.list_chats() {
        Ok(chats) => {
            let summaries: Vec<ChatSummary> = chats
                .into_iter()
                .map(|c| ChatSummary {
                    id: c.id,
                    title: c.title,
                    updated_at: c.updated_at.to_rfc3339(),
                })
                .collect();

            Json(ChatsListResponse { chats: summaries }).into_response()
        }
        Err(e) => ApiError::internal(e.to_string()).into_response(),
    }
}

pub async fn create_chat(
    State(state): State<Arc<ChatState>>,
    Json(request): Json<CreateChatRequest>,
) -> impl IntoResponse {
    let db = match lock_db(&state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };
    let id = uuid::Uuid::new_v4().to_string();
    let title = request.title.unwrap_or_else(|| "New Chat".to_string());

    match db.create_chat(&id, &title) {
        Ok(_) => (StatusCode::CREATED, Json(CreateChatResponse { id })).into_response(),
        Err(e) => ApiError::internal(e.to_string()).into_response(),
    }
}

pub async fn get_chat(
    State(state): State<Arc<ChatState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = match lock_db(&state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match db.get_chat(&id) {
        Ok(Some(chat)) => {
            let messages = db.get_messages(&id).unwrap_or_default();

            let message_responses: Vec<MessageResponse> = messages
                .into_iter()
                .map(|m| MessageResponse {
                    id: m.id,
                    role: m.role.to_string(),
                    content: m.content,
                    created_at: m.created_at.to_rfc3339(),
                })
                .collect();

            Json(ChatDetailResponse {
                id: chat.id,
                title: chat.title,
                created_at: chat.created_at.to_rfc3339(),
                updated_at: chat.updated_at.to_rfc3339(),
                messages: message_responses,
            })
            .into_response()
        }
        Ok(None) => ApiError::not_found("Chat not found").into_response(),
        Err(e) => ApiError::internal(e.to_string()).into_response(),
    }
}

pub async fn delete_chat(
    State(state): State<Arc<ChatState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = match lock_db(&state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match db.delete_chat(&id) {
        Ok(deleted) => {
            if deleted {
                Json(DeleteResponse { deleted: true }).into_response()
            } else {
                ApiError::not_found("Chat not found").into_response()
            }
        }
        Err(e) => ApiError::internal(e.to_string()).into_response(),
    }
}

pub async fn update_chat(
    State(state): State<Arc<ChatState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateChatRequest>,
) -> impl IntoResponse {
    let db = match lock_db(&state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match db.update_chat_title(&id, &request.title) {
        Ok(updated) => {
            if updated {
                Json(DeleteResponse { deleted: true }).into_response()
            } else {
                ApiError::not_found("Chat not found").into_response()
            }
        }
        Err(e) => ApiError::internal(e.to_string()).into_response(),
    }
}

pub async fn send_message(
    State(state): State<Arc<ChatState>>,
    Path(chat_id): Path<String>,
    Json(request): Json<SendMessageRequest>,
) -> impl IntoResponse {
    let db = match lock_db(&state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    // Verify chat exists
    match db.get_chat(&chat_id) {
        Ok(Some(_)) => {}
        Ok(None) => return ApiError::not_found("Chat not found").into_response(),
        Err(e) => return ApiError::internal(e.to_string()).into_response(),
    }

    let msg_id = uuid::Uuid::new_v4().to_string();

    match db.add_message(&msg_id, &chat_id, MessageRole::User, &request.content) {
        Ok(message) => (
            StatusCode::CREATED,
            Json(SendMessageResponse {
                id: message.id,
                role: message.role.to_string(),
                content: message.content,
                created_at: message.created_at.to_rfc3339(),
            }),
        )
            .into_response(),
        Err(e) => ApiError::internal(e.to_string()).into_response(),
    }
}

pub async fn delete_message(
    State(state): State<Arc<ChatState>>,
    Path((chat_id, msg_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = match lock_db(&state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    // Verify chat exists
    match db.get_chat(&chat_id) {
        Ok(Some(_)) => {}
        Ok(None) => return ApiError::not_found("Chat not found").into_response(),
        Err(e) => return ApiError::internal(e.to_string()).into_response(),
    }

    match db.delete_message(&msg_id) {
        Ok(deleted) => {
            if deleted {
                Json(DeleteResponse { deleted: true }).into_response()
            } else {
                ApiError::not_found("Message not found").into_response()
            }
        }
        Err(e) => ApiError::internal(e.to_string()).into_response(),
    }
}

pub async fn upload_document(
    State(state): State<Arc<ChatState>>,
    Path(chat_id): Path<String>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // Verify chat exists
    {
        let db = match lock_db(&state) {
            Ok(guard) => guard,
            Err(response) => return response,
        };
        match db.get_chat(&chat_id) {
            Ok(Some(_)) => {}
            Ok(None) => return ApiError::not_found("Chat not found").into_response(),
            Err(e) => return ApiError::internal(e.to_string()).into_response(),
        }
    }

    // Process multipart form
    let mut file_data: Option<(String, Vec<u8>)> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            let filename = field.file_name().unwrap_or("unknown").to_string();
            match field.bytes().await {
                Ok(data) => {
                    file_data = Some((filename, data.to_vec()));
                    break;
                }
                Err(e) => {
                    return ApiError::bad_request(format!("Failed to read file: {}", e))
                        .into_response()
                }
            }
        }
    }

    let (filename, data) = match file_data {
        Some(f) => f,
        None => return ApiError::bad_request("No file provided").into_response(),
    };

    // Detect document type from extension
    let extension = filename.rsplit('.').next().unwrap_or("");

    let doc_type = match DocumentType::from_extension(extension) {
        Some(dt) => dt,
        None => {
            return ApiError::bad_request(format!("Unsupported file type: .{}", extension))
                .into_response()
        }
    };

    // Extract text from document
    let extracted = match extract_text(&data, doc_type) {
        Ok(doc) => doc,
        Err(e) => {
            return ApiError::unprocessable(format!("Failed to extract text: {}", e))
                .into_response()
        }
    };

    // Create message with extracted text
    let msg_id = uuid::Uuid::new_v4().to_string();
    let content = format!("[Uploaded: {}]\n\n{}", filename, extracted.text);

    let db = match lock_db(&state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };
    match db.add_message(&msg_id, &chat_id, MessageRole::User, &content) {
        Ok(message) => (
            StatusCode::CREATED,
            Json(UploadResponse {
                id: message.id,
                role: message.role.to_string(),
                content: message.content,
                filename,
                doc_type: format!("{:?}", doc_type),
                word_count: extracted.word_count,
                created_at: message.created_at.to_rfc3339(),
            }),
        )
            .into_response(),
        Err(e) => ApiError::internal(e.to_string()).into_response(),
    }
}

pub async fn export_chat_handler(
    State(state): State<Arc<ChatState>>,
    Path(chat_id): Path<String>,
    Query(query): Query<ExportQuery>,
) -> impl IntoResponse {
    let db = match lock_db(&state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    // Get chat
    let chat = match db.get_chat(&chat_id) {
        Ok(Some(c)) => c,
        Ok(None) => return ApiError::not_found("Chat not found").into_response(),
        Err(e) => return ApiError::internal(e.to_string()).into_response(),
    };

    // Get messages
    let messages = db.get_messages(&chat_id).unwrap_or_default();

    // Determine format
    let format_str = query.format.as_deref().unwrap_or("md");
    let format = match ExportFormat::from_extension(format_str) {
        Some(f) => f,
        None => {
            return ApiError::bad_request(format!(
                "Unsupported format: {}. Use pdf, docx, or md",
                format_str
            ))
            .into_response()
        }
    };

    // Build export chat structure
    let export = ExportChat {
        title: chat.title.clone(),
        created_at: chat.created_at.to_rfc3339(),
        messages: messages
            .into_iter()
            .map(|m| ExportMessage {
                role: m.role.to_string(),
                content: m.content,
                created_at: m.created_at.to_rfc3339(),
            })
            .collect(),
    };

    // Generate export
    match export_chat(&export, format) {
        Ok(data) => {
            let filename = format!(
                "{}.{}",
                chat.title
                    .chars()
                    .take(50)
                    .collect::<String>()
                    .replace(' ', "_"),
                format.extension()
            );

            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, format.content_type()),
                    (
                        header::CONTENT_DISPOSITION,
                        &format!("attachment; filename=\"{}\"", filename),
                    ),
                ],
                data,
            )
                .into_response()
        }
        Err(e) => ApiError::internal(format!("Export failed: {}", e)).into_response(),
    }
}
