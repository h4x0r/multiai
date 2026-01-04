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
//! - POST /api/chats/:id/upload - Upload document (PDF, DOCX, TXT)
//! - GET /api/chats/:id/export - Export chat (PDF, DOCX, MD)

mod handlers;
#[cfg(test)]
mod tests;
mod types;

use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use std::sync::{Arc, Mutex};

use crate::chat::ChatDb;

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
        .route("/api/chats", get(handlers::list_chats))
        .route("/api/chats", post(handlers::create_chat))
        .route("/api/chats/{id}", get(handlers::get_chat))
        .route("/api/chats/{id}", delete(handlers::delete_chat))
        .route("/api/chats/{id}", patch(handlers::update_chat))
        .route("/api/chats/{id}/messages", post(handlers::send_message))
        .route(
            "/api/chats/{id}/messages/{mid}",
            delete(handlers::delete_message),
        )
        .route("/api/chats/{id}/upload", post(handlers::upload_document))
        .route(
            "/api/chats/{id}/export",
            get(handlers::export_chat_handler),
        )
        .with_state(state)
}
