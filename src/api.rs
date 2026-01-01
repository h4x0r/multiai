//! OpenAI-compatible API for free LLM routing.
//!
//! Endpoints:
//! - GET /health - Health check
//! - GET /v1/models - List free models
//! - POST /v1/chat/completions - Chat completions
//! - GET /v1/inspect - Get captured transactions
//! - DELETE /v1/inspect - Clear captured transactions

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::chat::ChatDb;
use crate::chat_api::{create_chat_router, ChatState};
use crate::inspector::{CapturedRequest, CapturedResponse, TrafficInspector};
use crate::scanner::{FreeModel, FreeModelScanner, Source};

/// Application state shared across handlers.
#[derive(Clone)]
pub struct AppState {
    pub scanner: FreeModelScanner,
    pub inspector: TrafficInspector,
    pub chat: Arc<ChatState>,
}

impl Default for AppState {
    fn default() -> Self {
        let chat_db = ChatDb::in_memory().expect("Failed to create chat database");
        Self {
            scanner: FreeModelScanner::new(),
            inspector: TrafficInspector::new(),
            chat: Arc::new(ChatState::new(chat_db)),
        }
    }
}

/// Create the API router.
pub fn create_router() -> Router {
    create_router_with_state(AppState::default())
}

/// Create the API router with custom state.
pub fn create_router_with_state(state: AppState) -> Router {
    let chat_router = create_chat_router(state.chat.clone());

    Router::new()
        .route("/health", get(health_check))
        .route("/v1/models", get(list_models))
        .route("/v1/chat/completions", post(chat_completions))
        .route("/v1/inspect", get(get_inspect))
        .route("/v1/inspect", delete(clear_inspect))
        .with_state(Arc::new(state))
        .merge(chat_router)
}

// ============================================================================
// Request/Response types
// ============================================================================

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct ModelsResponse {
    object: &'static str,
    data: Vec<ModelInfo>,
}

#[derive(Serialize)]
struct ModelInfo {
    id: String,
    object: &'static str,
    created: i64,
    owned_by: String,
}

#[derive(Deserialize, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(default)]
    temperature: Option<f32>,
    #[serde(default)]
    max_tokens: Option<u32>,
    #[serde(default)]
    stream: bool,
}

#[derive(Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatResponse {
    id: String,
    object: &'static str,
    created: i64,
    model: String,
    choices: Vec<ChatChoice>,
    usage: Usage,
}

#[derive(Serialize)]
struct ChatChoice {
    index: u32,
    message: ChatMessage,
    finish_reason: String,
}

#[derive(Serialize)]
struct Usage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    message: String,
    r#type: String,
}

// ============================================================================
// Handlers
// ============================================================================

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn list_models(State(state): State<Arc<AppState>>) -> Json<ModelsResponse> {
    let free_models = state.scanner.get_free_models(false).await;

    let data: Vec<ModelInfo> = free_models
        .into_iter()
        .map(|m| ModelInfo {
            id: m.id,
            object: "model",
            created: chrono::Utc::now().timestamp(),
            owned_by: m.provider,
        })
        .collect();

    Json(ModelsResponse {
        object: "list",
        data,
    })
}

async fn chat_completions(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ChatRequest>,
) -> Response {
    // Start capturing the transaction
    let captured_request = CapturedRequest {
        method: "POST".to_string(),
        url: "/v1/chat/completions".to_string(),
        headers: vec![("Content-Type".to_string(), "application/json".to_string())],
        body: Some(serde_json::to_value(&request).unwrap_or_default()),
    };
    let mut transaction = state.inspector.start_transaction(captured_request);

    let free_models = state.scanner.get_free_models(false).await;

    if free_models.is_empty() {
        let error_response = ErrorResponse {
            error: ErrorDetail {
                message: "No free models available".to_string(),
                r#type: "service_unavailable".to_string(),
            },
        };
        // Capture error response
        state.inspector.complete_transaction(
            &mut transaction,
            CapturedResponse {
                status: 503,
                headers: vec![],
                body: Some(serde_json::to_value(&error_response).unwrap_or_default()),
            },
        );
        state.inspector.store(transaction);

        return (StatusCode::SERVICE_UNAVAILABLE, Json(error_response)).into_response();
    }

    // Find target model
    let target: Option<&FreeModel> = if request.model == "auto" {
        free_models.first()
    } else {
        free_models.iter().find(|m| m.id == request.model)
    };

    let target = match target {
        Some(t) => t,
        None => {
            let error_response = ErrorResponse {
                error: ErrorDetail {
                    message: format!("'{}' is not a free model", request.model),
                    r#type: "invalid_request".to_string(),
                },
            };
            state.inspector.complete_transaction(
                &mut transaction,
                CapturedResponse {
                    status: 400,
                    headers: vec![],
                    body: Some(serde_json::to_value(&error_response).unwrap_or_default()),
                },
            );
            state.inspector.store(transaction);

            return (StatusCode::BAD_REQUEST, Json(error_response)).into_response();
        }
    };

    // Get API key from environment
    let api_key = match target.source {
        Source::OpenRouter => std::env::var("OPENROUTER_API_KEY").ok(),
        Source::ModelsDev => std::env::var("OPENCODE_ZEN_API_KEY").ok(),
    };

    let api_key = match api_key {
        Some(k) => k,
        None => {
            let error_response = ErrorResponse {
                error: ErrorDetail {
                    message: format!("No API key configured for {:?}", target.source),
                    r#type: "configuration_error".to_string(),
                },
            };
            state.inspector.complete_transaction(
                &mut transaction,
                CapturedResponse {
                    status: 503,
                    headers: vec![],
                    body: Some(serde_json::to_value(&error_response).unwrap_or_default()),
                },
            );
            state.inspector.store(transaction);

            return (StatusCode::SERVICE_UNAVAILABLE, Json(error_response)).into_response();
        }
    };

    // Forward request to upstream
    let client = reqwest::Client::new();
    let upstream_url = format!("{}/chat/completions", target.endpoint);

    let upstream_request = serde_json::json!({
        "model": target.id,
        "messages": request.messages,
        "temperature": request.temperature,
        "max_tokens": request.max_tokens,
        "stream": request.stream,
    });

    match client
        .post(&upstream_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&upstream_request)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            match response.json::<serde_json::Value>().await {
                Ok(body) => {
                    state.inspector.complete_transaction(
                        &mut transaction,
                        CapturedResponse {
                            status: status.as_u16(),
                            headers: vec![],
                            body: Some(body.clone()),
                        },
                    );
                    state.inspector.store(transaction);

                    (StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK), Json(body)).into_response()
                }
                Err(_) => {
                    let error_response = ErrorResponse {
                        error: ErrorDetail {
                            message: "Failed to parse upstream response".to_string(),
                            r#type: "upstream_error".to_string(),
                        },
                    };
                    state.inspector.complete_transaction(
                        &mut transaction,
                        CapturedResponse {
                            status: 502,
                            headers: vec![],
                            body: Some(serde_json::to_value(&error_response).unwrap_or_default()),
                        },
                    );
                    state.inspector.store(transaction);

                    (StatusCode::BAD_GATEWAY, Json(error_response)).into_response()
                }
            }
        }
        Err(e) => {
            let error_response = ErrorResponse {
                error: ErrorDetail {
                    message: format!("Upstream request failed: {}", e),
                    r#type: "upstream_error".to_string(),
                },
            };
            state.inspector.complete_transaction(
                &mut transaction,
                CapturedResponse {
                    status: 502,
                    headers: vec![],
                    body: Some(serde_json::to_value(&error_response).unwrap_or_default()),
                },
            );
            state.inspector.store(transaction);

            (StatusCode::BAD_GATEWAY, Json(error_response)).into_response()
        }
    }
}

// ============================================================================
// Inspect Handlers
// ============================================================================

#[derive(Deserialize)]
struct InspectQuery {
    format: Option<String>,
}

#[derive(Serialize)]
struct InspectResponse {
    transactions: Vec<crate::inspector::CapturedTransaction>,
    count: usize,
}

#[derive(Serialize)]
struct ClearResponse {
    cleared: bool,
    count: usize,
}

async fn get_inspect(
    State(state): State<Arc<AppState>>,
    Query(query): Query<InspectQuery>,
) -> Json<serde_json::Value> {
    match query.format.as_deref() {
        Some("har") => Json(state.inspector.export_har()),
        _ => {
            let transactions = state.inspector.get_all();
            let count = transactions.len();
            Json(serde_json::json!({
                "transactions": transactions,
                "count": count
            }))
        }
    }
}

async fn clear_inspect(State(state): State<Arc<AppState>>) -> Json<ClearResponse> {
    let count = state.inspector.get_all().len();
    state.inspector.clear();
    Json(ClearResponse { cleared: true, count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum_test::TestServer;
    use serde_json::json;

    // =========================================================================
    // Inspector Integration Tests (TDD - RED first)
    // =========================================================================

    #[tokio::test]
    async fn inspect_endpoint_returns_empty_initially() {
        let app = create_router();
        let server = TestServer::new(app).unwrap();

        let response = server.get("/v1/inspect").await;

        response.assert_status_ok();
        let body: serde_json::Value = response.json();
        assert!(body["transactions"].is_array());
        assert_eq!(body["transactions"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn inspect_endpoint_returns_har_format() {
        let app = create_router();
        let server = TestServer::new(app).unwrap();

        let response = server.get("/v1/inspect?format=har").await;

        response.assert_status_ok();
        let body: serde_json::Value = response.json();
        assert_eq!(body["log"]["version"], "1.2");
        assert!(body["log"]["entries"].is_array());
    }

    #[tokio::test]
    async fn delete_inspect_clears_transactions() {
        let app = create_router();
        let server = TestServer::new(app).unwrap();

        let response = server.delete("/v1/inspect").await;

        response.assert_status_ok();
        let body: serde_json::Value = response.json();
        assert_eq!(body["cleared"], true);
    }

    #[tokio::test]
    async fn chat_request_is_captured_by_inspector() {
        let state = AppState::default();
        let app = create_router_with_state(state.clone());
        let server = TestServer::new(app).unwrap();

        // Make a chat request (will fail due to no API key, but should still be captured)
        let _ = server
            .post("/v1/chat/completions")
            .json(&json!({
                "model": "auto",
                "messages": [{"role": "user", "content": "Hello"}]
            }))
            .await;

        // Check inspector captured it
        let response = server.get("/v1/inspect").await;
        let body: serde_json::Value = response.json();
        let transactions = body["transactions"].as_array().unwrap();

        // Should have captured at least one transaction
        assert!(transactions.len() >= 1, "Expected at least 1 transaction, got {}", transactions.len());
    }

    #[tokio::test]
    async fn health_check_returns_ok() {
        let app = create_router();
        let server = TestServer::new(app).unwrap();

        let response = server.get("/health").await;

        response.assert_status_ok();
        response.assert_json(&json!({"status": "ok"}));
    }

    #[tokio::test]
    async fn list_models_returns_openai_format() {
        let app = create_router();
        let server = TestServer::new(app).unwrap();

        let response = server.get("/v1/models").await;

        response.assert_status_ok();
        let body: serde_json::Value = response.json();
        assert_eq!(body["object"], "list");
        assert!(body["data"].is_array());
    }

    #[tokio::test]
    async fn chat_completions_rejects_non_free_model() {
        let app = create_router();
        let server = TestServer::new(app).unwrap();

        let response = server
            .post("/v1/chat/completions")
            .json(&json!({
                "model": "gpt-4",
                "messages": [{"role": "user", "content": "Hello"}]
            }))
            .await;

        // Either 400 (not a free model) or 503 (no free models available)
        let status = response.status_code();
        assert!(status.is_client_error() || status.as_u16() == 503);
    }

    #[tokio::test]
    async fn chat_completions_auto_selects_free_model() {
        let app = create_router();
        let server = TestServer::new(app).unwrap();

        let response = server
            .post("/v1/chat/completions")
            .json(&json!({
                "model": "auto",
                "messages": [{"role": "user", "content": "Hello"}]
            }))
            .await;

        // Either succeeds, 503 (no models), or 503 (no API key)
        let status = response.status_code();
        assert!(status.is_success() || status.as_u16() == 503);
    }
}
