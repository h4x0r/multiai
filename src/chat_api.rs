//! Chat API endpoints for the web UI.
//!
//! Endpoints:
//! - GET /api/chats - List all chats
//! - POST /api/chats - Create new chat
//! - GET /api/chats/:id - Get chat with messages
//! - DELETE /api/chats/:id - Delete chat
//! - PATCH /api/chats/:id - Update chat title
//! - POST /api/chats/:id/messages - Send message
//! - DELETE /api/chats/:id/messages/:mid - Delete message

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

use crate::chat::{ChatDb, MessageRole};

/// Shared chat database state.
pub struct ChatState {
    pub db: Mutex<ChatDb>,
}

impl ChatState {
    pub fn new(db: ChatDb) -> Self {
        Self { db: Mutex::new(db) }
    }
}

/// Create the chat API router (nested under /api).
pub fn create_chat_router(state: Arc<ChatState>) -> Router<()> {
    Router::new()
        .route("/api/chats", get(list_chats))
        .route("/api/chats", post(create_chat))
        .route("/api/chats/{id}", get(get_chat))
        .route("/api/chats/{id}", delete(delete_chat))
        .route("/api/chats/{id}", patch(update_chat))
        .route("/api/chats/{id}/messages", post(send_message))
        .route("/api/chats/{id}/messages/{mid}", delete(delete_message))
        .with_state(state)
}

// ============================================================================
// Request/Response types
// ============================================================================

#[derive(Serialize)]
struct ChatsListResponse {
    chats: Vec<ChatSummary>,
}

#[derive(Serialize)]
struct ChatSummary {
    id: String,
    title: String,
    updated_at: String,
}

#[derive(Deserialize)]
struct CreateChatRequest {
    title: Option<String>,
}

#[derive(Serialize)]
struct CreateChatResponse {
    id: String,
}

#[derive(Serialize)]
struct ChatDetailResponse {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    messages: Vec<MessageResponse>,
}

#[derive(Serialize)]
struct MessageResponse {
    id: String,
    role: String,
    content: String,
    created_at: String,
}

#[derive(Deserialize)]
struct UpdateChatRequest {
    title: String,
}

#[derive(Deserialize)]
struct SendMessageRequest {
    content: String,
}

#[derive(Serialize)]
struct SendMessageResponse {
    id: String,
    role: String,
    content: String,
    created_at: String,
}

#[derive(Serialize)]
struct DeleteResponse {
    deleted: bool,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

// ============================================================================
// Handlers
// ============================================================================

async fn list_chats(State(state): State<Arc<ChatState>>) -> impl IntoResponse {
    let db = state.db.lock().unwrap();

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
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn create_chat(
    State(state): State<Arc<ChatState>>,
    Json(request): Json<CreateChatRequest>,
) -> impl IntoResponse {
    let db = state.db.lock().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let title = request.title.unwrap_or_else(|| "New Chat".to_string());

    match db.create_chat(&id, &title) {
        Ok(_) => (StatusCode::CREATED, Json(CreateChatResponse { id })).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn get_chat(
    State(state): State<Arc<ChatState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.lock().unwrap();

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
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Chat not found".to_string(),
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn delete_chat(
    State(state): State<Arc<ChatState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = state.db.lock().unwrap();

    match db.delete_chat(&id) {
        Ok(deleted) => {
            if deleted {
                Json(DeleteResponse { deleted: true }).into_response()
            } else {
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: "Chat not found".to_string(),
                    }),
                )
                    .into_response()
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn update_chat(
    State(state): State<Arc<ChatState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateChatRequest>,
) -> impl IntoResponse {
    let db = state.db.lock().unwrap();

    match db.update_chat_title(&id, &request.title) {
        Ok(updated) => {
            if updated {
                Json(DeleteResponse { deleted: true }).into_response()
            } else {
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: "Chat not found".to_string(),
                    }),
                )
                    .into_response()
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn send_message(
    State(state): State<Arc<ChatState>>,
    Path(chat_id): Path<String>,
    Json(request): Json<SendMessageRequest>,
) -> impl IntoResponse {
    let db = state.db.lock().unwrap();

    // Verify chat exists
    match db.get_chat(&chat_id) {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Chat not found".to_string(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
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
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn delete_message(
    State(state): State<Arc<ChatState>>,
    Path((chat_id, msg_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let db = state.db.lock().unwrap();

    // Verify chat exists
    match db.get_chat(&chat_id) {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Chat not found".to_string(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    }

    match db.delete_message(&msg_id) {
        Ok(deleted) => {
            if deleted {
                Json(DeleteResponse { deleted: true }).into_response()
            } else {
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: "Message not found".to_string(),
                    }),
                )
                    .into_response()
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum_test::TestServer;
    use serde_json::json;

    fn test_state() -> Arc<ChatState> {
        let db = ChatDb::in_memory().unwrap();
        Arc::new(ChatState::new(db))
    }

    // =========================================================================
    // Tests for Chat API endpoints
    // =========================================================================

    #[tokio::test]
    async fn list_chats_returns_empty_initially() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        let response = server.get("/api/chats").await;

        response.assert_status_ok();
        let body: serde_json::Value = response.json();
        assert!(body["chats"].is_array());
        assert_eq!(body["chats"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn create_chat_returns_id() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        let response = server
            .post("/api/chats")
            .json(&json!({"title": "Test Chat"}))
            .await;

        response.assert_status(StatusCode::CREATED);
        let body: serde_json::Value = response.json();
        assert!(body["id"].is_string());
    }

    #[tokio::test]
    async fn create_chat_with_default_title() {
        let state = test_state();
        let app = create_chat_router(state.clone());
        let server = TestServer::new(app).unwrap();

        let response = server.post("/api/chats").json(&json!({})).await;

        response.assert_status(StatusCode::CREATED);

        // List and verify title
        let list_response = server.get("/api/chats").await;
        let body: serde_json::Value = list_response.json();
        assert_eq!(body["chats"][0]["title"], "New Chat");
    }

    #[tokio::test]
    async fn get_chat_returns_details() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        // Create chat
        let create_response = server
            .post("/api/chats")
            .json(&json!({"title": "Test Chat"}))
            .await;
        let chat_id = create_response.json::<serde_json::Value>()["id"]
            .as_str()
            .unwrap()
            .to_string();

        // Get chat
        let response = server.get(&format!("/api/chats/{}", chat_id)).await;

        response.assert_status_ok();
        let body: serde_json::Value = response.json();
        assert_eq!(body["title"], "Test Chat");
        assert!(body["messages"].is_array());
    }

    #[tokio::test]
    async fn get_nonexistent_chat_returns_404() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        let response = server.get("/api/chats/nonexistent").await;

        response.assert_status(StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_chat_removes_it() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        // Create chat
        let create_response = server
            .post("/api/chats")
            .json(&json!({"title": "Test Chat"}))
            .await;
        let chat_id = create_response.json::<serde_json::Value>()["id"]
            .as_str()
            .unwrap()
            .to_string();

        // Delete chat
        let delete_response = server.delete(&format!("/api/chats/{}", chat_id)).await;
        delete_response.assert_status_ok();

        // Verify deleted
        let get_response = server.get(&format!("/api/chats/{}", chat_id)).await;
        get_response.assert_status(StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn update_chat_title() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        // Create chat
        let create_response = server
            .post("/api/chats")
            .json(&json!({"title": "Original"}))
            .await;
        let chat_id = create_response.json::<serde_json::Value>()["id"]
            .as_str()
            .unwrap()
            .to_string();

        // Update title
        let update_response = server
            .patch(&format!("/api/chats/{}", chat_id))
            .json(&json!({"title": "Updated"}))
            .await;
        update_response.assert_status_ok();

        // Verify updated
        let get_response = server.get(&format!("/api/chats/{}", chat_id)).await;
        let body: serde_json::Value = get_response.json();
        assert_eq!(body["title"], "Updated");
    }

    #[tokio::test]
    async fn send_message_creates_user_message() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        // Create chat
        let create_response = server.post("/api/chats").json(&json!({})).await;
        let chat_id = create_response.json::<serde_json::Value>()["id"]
            .as_str()
            .unwrap()
            .to_string();

        // Send message
        let msg_response = server
            .post(&format!("/api/chats/{}/messages", chat_id))
            .json(&json!({"content": "Hello!"}))
            .await;

        msg_response.assert_status(StatusCode::CREATED);
        let body: serde_json::Value = msg_response.json();
        assert_eq!(body["role"], "user");
        assert_eq!(body["content"], "Hello!");
    }

    #[tokio::test]
    async fn send_message_to_nonexistent_chat_returns_404() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        let response = server
            .post("/api/chats/nonexistent/messages")
            .json(&json!({"content": "Hello!"}))
            .await;

        response.assert_status(StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_message_removes_it() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        // Create chat
        let create_response = server.post("/api/chats").json(&json!({})).await;
        let chat_id = create_response.json::<serde_json::Value>()["id"]
            .as_str()
            .unwrap()
            .to_string();

        // Send message
        let msg_response = server
            .post(&format!("/api/chats/{}/messages", chat_id))
            .json(&json!({"content": "Hello!"}))
            .await;
        let msg_id = msg_response.json::<serde_json::Value>()["id"]
            .as_str()
            .unwrap()
            .to_string();

        // Delete message
        let delete_response = server
            .delete(&format!("/api/chats/{}/messages/{}", chat_id, msg_id))
            .await;
        delete_response.assert_status_ok();

        // Verify deleted
        let get_response = server.get(&format!("/api/chats/{}", chat_id)).await;
        let body: serde_json::Value = get_response.json();
        assert_eq!(body["messages"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn chats_listed_in_updated_order() {
        let state = test_state();
        let app = create_chat_router(state);
        let server = TestServer::new(app).unwrap();

        // Create two chats
        let resp1 = server
            .post("/api/chats")
            .json(&json!({"title": "First"}))
            .await;
        let chat1_id = resp1.json::<serde_json::Value>()["id"]
            .as_str()
            .unwrap()
            .to_string();

        let resp2 = server
            .post("/api/chats")
            .json(&json!({"title": "Second"}))
            .await;
        let _chat2_id = resp2.json::<serde_json::Value>()["id"]
            .as_str()
            .unwrap()
            .to_string();

        // Update first chat to make it more recent
        server
            .patch(&format!("/api/chats/{}", chat1_id))
            .json(&json!({"title": "First Updated"}))
            .await;

        // List chats
        let list_response = server.get("/api/chats").await;
        let body: serde_json::Value = list_response.json();
        let chats = body["chats"].as_array().unwrap();

        assert_eq!(chats.len(), 2);
        assert_eq!(chats[0]["title"], "First Updated"); // Most recently updated
    }
}
