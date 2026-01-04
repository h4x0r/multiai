//! Integration tests for Chat API endpoints.

use super::*;
use axum::http::StatusCode;
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

// =========================================================================
// Upload Tests
// =========================================================================

#[tokio::test]
async fn upload_text_file_creates_message() {
    use axum_test::multipart::{MultipartForm, Part};

    let state = test_state();
    let app = create_chat_router(state);
    let server = TestServer::new(app).unwrap();

    // Create chat
    let create_response = server.post("/api/chats").json(&json!({})).await;
    let chat_id = create_response.json::<serde_json::Value>()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Upload text file
    let part = Part::bytes(b"Hello from uploaded file!".to_vec())
        .file_name("test.txt")
        .mime_type("text/plain");
    let form = MultipartForm::new().add_part("file", part);

    let response = server
        .post(&format!("/api/chats/{}/upload", chat_id))
        .multipart(form)
        .await;

    response.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = response.json();
    assert!(body["content"]
        .as_str()
        .unwrap()
        .contains("Hello from uploaded file!"));
    assert_eq!(body["doc_type"], "Text");
}

#[tokio::test]
async fn upload_to_nonexistent_chat_returns_404() {
    use axum_test::multipart::{MultipartForm, Part};

    let state = test_state();
    let app = create_chat_router(state);
    let server = TestServer::new(app).unwrap();

    let part = Part::bytes(b"Hello".to_vec())
        .file_name("test.txt")
        .mime_type("text/plain");
    let form = MultipartForm::new().add_part("file", part);

    let response = server
        .post("/api/chats/nonexistent/upload")
        .multipart(form)
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn upload_unsupported_file_returns_error() {
    use axum_test::multipart::{MultipartForm, Part};

    let state = test_state();
    let app = create_chat_router(state);
    let server = TestServer::new(app).unwrap();

    // Create chat
    let create_response = server.post("/api/chats").json(&json!({})).await;
    let chat_id = create_response.json::<serde_json::Value>()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Upload unsupported file type
    let part = Part::bytes(b"binary data".to_vec())
        .file_name("image.jpg")
        .mime_type("image/jpeg");
    let form = MultipartForm::new().add_part("file", part);

    let response = server
        .post(&format!("/api/chats/{}/upload", chat_id))
        .multipart(form)
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = response.json();
    assert!(body["error"].as_str().unwrap().contains("Unsupported"));
}

// =========================================================================
// Export Tests
// =========================================================================

#[tokio::test]
async fn export_chat_as_markdown() {
    let state = test_state();
    let app = create_chat_router(state);
    let server = TestServer::new(app).unwrap();

    // Create chat with message
    let create_response = server
        .post("/api/chats")
        .json(&json!({"title": "Export Test"}))
        .await;
    let chat_id = create_response.json::<serde_json::Value>()["id"]
        .as_str()
        .unwrap()
        .to_string();

    server
        .post(&format!("/api/chats/{}/messages", chat_id))
        .json(&json!({"content": "Hello world"}))
        .await;

    // Export as markdown
    let response = server
        .get(&format!("/api/chats/{}/export?format=md", chat_id))
        .await;

    response.assert_status_ok();
    let body = response.text();
    assert!(body.contains("# Export Test"));
    assert!(body.contains("Hello world"));
}

#[tokio::test]
async fn export_chat_as_pdf() {
    let state = test_state();
    let app = create_chat_router(state);
    let server = TestServer::new(app).unwrap();

    // Create chat
    let create_response = server
        .post("/api/chats")
        .json(&json!({"title": "PDF Test"}))
        .await;
    let chat_id = create_response.json::<serde_json::Value>()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Export as PDF
    let response = server
        .get(&format!("/api/chats/{}/export?format=pdf", chat_id))
        .await;

    response.assert_status_ok();
    let body = response.as_bytes();
    assert!(body.starts_with(b"%PDF-")); // PDF version may vary
}

#[tokio::test]
async fn export_chat_as_docx() {
    let state = test_state();
    let app = create_chat_router(state);
    let server = TestServer::new(app).unwrap();

    // Create chat
    let create_response = server
        .post("/api/chats")
        .json(&json!({"title": "DOCX Test"}))
        .await;
    let chat_id = create_response.json::<serde_json::Value>()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Export as DOCX
    let response = server
        .get(&format!("/api/chats/{}/export?format=docx", chat_id))
        .await;

    response.assert_status_ok();
    let body = response.as_bytes();
    // DOCX is a ZIP file
    assert_eq!(&body[0..4], b"PK\x03\x04");
}

#[tokio::test]
async fn export_nonexistent_chat_returns_404() {
    let state = test_state();
    let app = create_chat_router(state);
    let server = TestServer::new(app).unwrap();

    let response = server.get("/api/chats/nonexistent/export").await;

    response.assert_status(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn export_invalid_format_returns_error() {
    let state = test_state();
    let app = create_chat_router(state);
    let server = TestServer::new(app).unwrap();

    // Create chat
    let create_response = server.post("/api/chats").json(&json!({})).await;
    let chat_id = create_response.json::<serde_json::Value>()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Try invalid format
    let response = server
        .get(&format!("/api/chats/{}/export?format=xyz", chat_id))
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = response.json();
    assert!(body["error"].as_str().unwrap().contains("Unsupported format"));
}

// =========================================================================
// Error Handling Tests
// =========================================================================

#[tokio::test]
async fn list_chats_returns_500_when_mutex_poisoned() {
    use std::panic;

    let state = test_state();

    // Poison the mutex by panicking while holding the lock
    let state_clone = state.clone();
    let handle = std::thread::spawn(move || {
        let _guard = state_clone.db.lock().unwrap();
        panic!("intentional panic to poison mutex");
    });

    // Wait for the thread to finish (it will panic)
    let _ = handle.join();

    // Now the mutex is poisoned - the handler should return 500, not panic
    let app = create_chat_router(state);
    let server = TestServer::new(app).unwrap();

    let response = server.get("/api/chats").await;

    response.assert_status(StatusCode::INTERNAL_SERVER_ERROR);
    let body: serde_json::Value = response.json();
    assert!(body["error"].as_str().unwrap().contains("lock"));
}
