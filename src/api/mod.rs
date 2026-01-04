//! OpenAI-compatible API for free LLM routing.
//!
//! Endpoints:
//! - GET /health - Health check
//! - GET /v1/models - List free models
//! - POST /v1/chat/completions - Chat completions
//! - GET /v1/inspect - Get captured transactions
//! - DELETE /v1/inspect - Clear captured transactions

mod handlers;
mod types;

use axum::{
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post, put},
    Router,
};
use rust_embed::Embed;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

use crate::chat::ChatDb;
use crate::chat_api::{create_chat_router, ChatState};
use crate::inspector::TrafficInspector;
use crate::scanner::FreeModelScanner;

// Re-export commonly used types
pub use handlers::{
    build_upstream_url, find_target_model, get_api_key_for_model, normalize_model_name,
};
pub use types::*;

#[derive(Embed)]
#[folder = "static/"]
struct StaticAssets;

/// Application state shared across handlers.
#[derive(Clone)]
pub struct AppState {
    pub scanner: FreeModelScanner,
    pub inspector: TrafficInspector,
    pub chat: Arc<ChatState>,
}

impl AppState {
    /// Create AppState with Ollama integration
    pub fn with_ollama(ollama_url: &str) -> Self {
        let chat_db = ChatDb::in_memory().expect("Failed to create chat database");
        Self {
            scanner: FreeModelScanner::new().with_ollama_url(ollama_url),
            inspector: TrafficInspector::new(),
            chat: Arc::new(ChatState::new(chat_db)),
        }
    }
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

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(handlers::health_check))
        .route("/v1/models", get(handlers::list_models))
        .route("/v1/models/grouped", get(handlers::list_models_grouped))
        .route("/v1/chat/completions", post(handlers::chat_completions))
        .route("/v1/inspect", get(handlers::get_inspect))
        .route("/v1/inspect", delete(handlers::clear_inspect))
        .route("/api/settings", get(handlers::get_settings))
        .route("/api/settings", put(handlers::update_settings))
        .with_state(Arc::new(state))
        .merge(chat_router)
        .fallback(static_handler)
        .layer(cors)
}

/// Serve embedded static files
async fn static_handler(uri: axum::http::Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match StaticAssets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();
            ([(header::CONTENT_TYPE, mime)], content.data.into_owned()).into_response()
        }
        None => {
            // Fallback to index.html for SPA routing
            match StaticAssets::get("index.html") {
                Some(content) => {
                    ([(header::CONTENT_TYPE, "text/html".to_string())], content.data.into_owned()).into_response()
                }
                None => (StatusCode::NOT_FOUND, "Not Found").into_response(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::{FreeModel, Source};
    use axum_test::TestServer;
    use serde_json::json;

    // =========================================================================
    // normalize_model_name() tests
    // =========================================================================

    #[test]
    fn normalize_handles_common_version_numbers() {
        assert_eq!(normalize_model_name("glm-4-7-free"), "GLM 4.7");
        assert_eq!(normalize_model_name("minimax-m-2-1"), "Minimax M 2.1");
    }

    #[test]
    fn normalize_handles_arbitrary_version_numbers() {
        assert_eq!(normalize_model_name("model-3-2"), "Model 3.2");
        assert_eq!(normalize_model_name("llama-1-5"), "Llama 1.5");
        assert_eq!(normalize_model_name("gpt-7-0"), "GPT 7.0");
    }

    #[test]
    fn normalize_handles_three_digit_versions() {
        assert_eq!(normalize_model_name("model-1-2-3"), "Model 1.2.3");
    }

    #[test]
    fn normalize_removes_free_suffix_and_provider_prefix() {
        assert_eq!(normalize_model_name("opencode/model-free"), "Model");
        assert_eq!(normalize_model_name("openrouter/model-free"), "Model");
    }

    #[test]
    fn normalize_title_cases_words() {
        assert_eq!(normalize_model_name("grok-code-fast"), "Grok Code Fast");
    }

    // =========================================================================
    // Helper function tests
    // =========================================================================

    #[test]
    fn find_target_model_returns_first_for_auto() {
        let models = vec![
            FreeModel {
                id: "model-a".to_string(),
                provider: "provider".to_string(),
                endpoint: "http://example.com".to_string(),
                source: Source::OpenRouter,
            },
            FreeModel {
                id: "model-b".to_string(),
                provider: "provider".to_string(),
                endpoint: "http://example.com".to_string(),
                source: Source::OpenRouter,
            },
        ];

        let result = find_target_model("auto", &models);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "model-a");
    }

    #[test]
    fn find_target_model_returns_matching_model() {
        let models = vec![
            FreeModel {
                id: "model-a".to_string(),
                provider: "provider".to_string(),
                endpoint: "http://example.com".to_string(),
                source: Source::OpenRouter,
            },
            FreeModel {
                id: "model-b".to_string(),
                provider: "provider".to_string(),
                endpoint: "http://example.com".to_string(),
                source: Source::OpenRouter,
            },
        ];

        let result = find_target_model("model-b", &models);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "model-b");
    }

    #[test]
    fn find_target_model_returns_error_for_missing_model() {
        let models = vec![FreeModel {
            id: "model-a".to_string(),
            provider: "provider".to_string(),
            endpoint: "http://example.com".to_string(),
            source: Source::OpenRouter,
        }];

        let result = find_target_model("gpt-4", &models);
        assert!(result.is_err());
    }

    #[test]
    fn find_target_model_returns_error_for_empty_models() {
        let models: Vec<FreeModel> = vec![];
        let result = find_target_model("auto", &models);
        assert!(result.is_err());
    }

    #[test]
    fn build_upstream_url_uses_correct_path_for_ollama() {
        let model = FreeModel {
            id: "llama2".to_string(),
            provider: "ollama".to_string(),
            endpoint: "http://localhost:11434".to_string(),
            source: Source::Ollama,
        };
        let url = build_upstream_url(&model);
        assert_eq!(url, "http://localhost:11434/v1/chat/completions");
    }

    #[test]
    fn build_upstream_url_uses_correct_path_for_cloud_providers() {
        let model = FreeModel {
            id: "gpt-3.5".to_string(),
            provider: "openrouter".to_string(),
            endpoint: "https://openrouter.ai/api/v1".to_string(),
            source: Source::OpenRouter,
        };
        let url = build_upstream_url(&model);
        assert_eq!(url, "https://openrouter.ai/api/v1/chat/completions");
    }

    // =========================================================================
    // Integration Tests
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

        let _ = server
            .post("/v1/chat/completions")
            .json(&json!({
                "model": "auto",
                "messages": [{"role": "user", "content": "Hello"}]
            }))
            .await;

        let response = server.get("/v1/inspect").await;
        let body: serde_json::Value = response.json();
        let transactions = body["transactions"].as_array().unwrap();

        assert!(transactions.len() >= 1, "Expected at least 1 transaction, got {}", transactions.len());
    }

    #[tokio::test]
    async fn health_check_returns_ok() {
        let app = create_router();
        let server = TestServer::new(app).unwrap();

        let response = server.get("/health").await;

        response.assert_status_ok();
        response.assert_json(&json!({
            "app": "multiai",
            "status": "ok",
            "version": "0.1.0"
        }));
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

        let status = response.status_code();
        assert!(status.is_success() || status.as_u16() == 503);
    }

    #[tokio::test]
    async fn grouped_models_returns_models_by_name() {
        let app = create_router();
        let server = TestServer::new(app).unwrap();

        let response = server.get("/v1/models/grouped").await;

        response.assert_status_ok();
        let body: serde_json::Value = response.json();

        assert!(body["models"].is_array());

        if let Some(models) = body["models"].as_array() {
            for model in models {
                assert!(model["name"].is_string(), "Model should have name");
                assert!(model["providers"].is_array(), "Model should have providers array");

                if let Some(providers) = model["providers"].as_array() {
                    if providers.len() > 1 {
                        let first_source = providers[0]["source"].as_str().unwrap_or("");
                        if providers.iter().any(|p| p["source"] == "open_code_zen") {
                            assert_eq!(first_source, "open_code_zen", "Zen should be listed first");
                        }
                    }
                }
            }
        }
    }
}
