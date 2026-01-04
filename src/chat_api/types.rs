//! Request and response types for the Chat API.

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct ChatsListResponse {
    pub chats: Vec<ChatSummary>,
}

#[derive(Serialize)]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
pub struct CreateChatRequest {
    pub title: Option<String>,
}

#[derive(Serialize)]
pub struct CreateChatResponse {
    pub id: String,
}

#[derive(Serialize)]
pub struct ChatDetailResponse {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<MessageResponse>,
}

#[derive(Serialize)]
pub struct MessageResponse {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct UpdateChatRequest {
    pub title: String,
}

#[derive(Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Serialize)]
pub struct SendMessageResponse {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct DeleteResponse {
    pub deleted: bool,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Serialize)]
pub struct UploadResponse {
    pub id: String,
    pub role: String,
    pub content: String,
    pub filename: String,
    pub doc_type: String,
    pub word_count: usize,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct ExportQuery {
    pub format: Option<String>,
}

/// Structured API error with status code and message.
/// Provides ergonomic constructors for common HTTP error responses.
pub struct ApiError {
    pub status: axum::http::StatusCode,
    pub message: String,
}

impl ApiError {
    /// Create a 404 Not Found error.
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            status: axum::http::StatusCode::NOT_FOUND,
            message: msg.into(),
        }
    }

    /// Create a 400 Bad Request error.
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }

    /// Create a 500 Internal Server Error.
    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            message: msg.into(),
        }
    }

    /// Create a 422 Unprocessable Entity error.
    pub fn unprocessable(msg: impl Into<String>) -> Self {
        Self {
            status: axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            message: msg.into(),
        }
    }
}

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            axum::Json(ErrorResponse {
                error: self.message,
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    #[test]
    fn api_error_not_found_has_correct_status() {
        let error = ApiError::not_found("Resource not found");
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn api_error_bad_request_has_correct_status() {
        let error = ApiError::bad_request("Invalid input");
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn api_error_internal_has_correct_status() {
        let error = ApiError::internal("Something went wrong");
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn api_error_unprocessable_has_correct_status() {
        let error = ApiError::unprocessable("Cannot process");
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}
