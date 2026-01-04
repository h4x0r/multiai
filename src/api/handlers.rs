//! HTTP handlers for the OpenAI-compatible API.

use super::types::*;
use super::AppState;
use crate::config::Config;
use crate::error::MultiAiError;
use crate::http::create_client;
use crate::inspector::{CapturedRequest, CapturedResponse, TrafficInspector};
use crate::scanner::{FreeModel, Source};
use axum::{
    body::Body,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use futures::StreamExt;
use regex::Regex;
use std::sync::{Arc, LazyLock};

// ============================================================================
// Health and Models handlers
// ============================================================================

pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        app: "multiai",
        version: env!("CARGO_PKG_VERSION"),
    })
}

pub async fn list_models(State(state): State<Arc<AppState>>) -> Json<ModelsResponse> {
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

pub async fn list_models_grouped(State(state): State<Arc<AppState>>) -> Json<GroupedModelsResponse> {
    use std::collections::HashMap;

    let free_models = state.scanner.get_free_models(false).await;

    // Group models by normalized name
    let mut grouped: HashMap<String, Vec<ProviderOption>> = HashMap::new();

    for model in free_models {
        let name = normalize_model_name(&model.id);

        grouped.entry(name).or_default().push(ProviderOption {
            id: model.id,
            source: model.source,
            endpoint: model.endpoint,
        });
    }

    // Convert to vec and sort providers (Ollama > Zen > OpenRouter)
    let mut models: Vec<GroupedModel> = grouped
        .into_iter()
        .map(|(name, mut providers)| {
            providers.sort_by(|a, b| a.source.cmp(&b.source));
            GroupedModel { name, providers }
        })
        .collect();

    models.sort_by(|a, b| a.name.cmp(&b.name));

    Json(GroupedModelsResponse { models })
}

/// Normalize model ID to display name.
/// "glm-4-7-free" -> "GLM 4.7", "grok-code-fast-1" -> "Grok Code Fast 1"
pub fn normalize_model_name(id: &str) -> String {
    // Regex to match consecutive digit groups separated by spaces (version numbers)
    static VERSION_REGEX: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(\d+)((?:\s+\d+)+)").unwrap());

    // Known acronyms that should stay uppercase
    static ACRONYMS: &[&str] = &["glm", "gpt", "llm", "ai", "ml"];

    let name = id
        .replace("-free", "")
        .replace("opencode/", "")
        .replace("openrouter/", "");

    // Split by hyphens and title case
    let spaced = name
        .split('-')
        .map(|part| {
            if part.chars().all(|c| c.is_ascii_digit()) {
                part.to_string()
            } else if ACRONYMS.contains(&part.to_lowercase().as_str()) {
                part.to_uppercase()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    None => String::new(),
                    Some(first) => first.to_uppercase().chain(chars).collect(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    // Replace space-separated digits with dot-separated (e.g., "4 7" -> "4.7")
    VERSION_REGEX
        .replace_all(&spaced, |caps: &regex::Captures| {
            let first = &caps[1];
            let rest = &caps[2];
            format!("{}{}", first, rest.replace(' ', "."))
        })
        .to_string()
}

// ============================================================================
// Chat completions helpers
// ============================================================================

/// Find the target model from available free models.
pub fn find_target_model<'a>(
    requested: &str,
    models: &'a [FreeModel],
) -> Result<&'a FreeModel, MultiAiError> {
    if models.is_empty() {
        return Err(MultiAiError::NoModelsAvailable);
    }

    if requested == "auto" {
        return models.first().ok_or(MultiAiError::NoModelsAvailable);
    }

    models
        .iter()
        .find(|m| m.id == requested)
        .ok_or_else(|| MultiAiError::ModelNotFree(requested.to_string()))
}

/// Build the upstream URL for a model.
pub fn build_upstream_url(model: &FreeModel) -> String {
    if model.source == Source::Ollama {
        format!("{}/v1/chat/completions", model.endpoint)
    } else {
        format!("{}/chat/completions", model.endpoint)
    }
}

/// Get API key for a model's source, if required.
pub fn get_api_key_for_model(model: &FreeModel) -> Result<Option<String>, MultiAiError> {
    if model.source == Source::Ollama {
        return Ok(None);
    }

    let config = Config::load_with_env();
    config
        .get_api_key(&model.source)
        .map(Some)
        .ok_or_else(|| MultiAiError::ApiKeyMissing(format!("{:?}", model.source)))
}

/// Record an error in the inspector and return the error response.
pub fn record_error_response(
    inspector: &TrafficInspector,
    transaction: &mut crate::inspector::CapturedTransaction,
    error: &MultiAiError,
) -> Response {
    inspector.complete_transaction(
        transaction,
        CapturedResponse {
            status: error.status_code().as_u16(),
            headers: vec![],
            body: Some(serde_json::json!({
                "error": {
                    "message": error.to_string(),
                    "type": error.error_type()
                }
            })),
        },
    );
    inspector.store(transaction.clone());
    error.clone().into_response()
}

// ============================================================================
// Chat completions handler
// ============================================================================

pub async fn chat_completions(
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

    // Get free models and find target
    let free_models = state.scanner.get_free_models(false).await;
    let target = match find_target_model(&request.model, &free_models) {
        Ok(t) => t,
        Err(e) => return record_error_response(&state.inspector, &mut transaction, &e),
    };

    // Get API key
    let api_key = match get_api_key_for_model(target) {
        Ok(key) => key,
        Err(e) => return record_error_response(&state.inspector, &mut transaction, &e),
    };

    // Build upstream URL and request
    let client = create_client();
    let upstream_url = build_upstream_url(target);

    let upstream_request = serde_json::json!({
        "model": target.id,
        "messages": request.messages,
        "temperature": request.temperature,
        "max_tokens": request.max_tokens,
        "stream": request.stream,
    });

    let mut req = client
        .post(&upstream_url)
        .header("Content-Type", "application/json");

    if let Some(key) = &api_key {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    match req.json(&upstream_request).send().await {
        Ok(response) => {
            let status = response.status();

            if request.stream {
                state.inspector.complete_transaction(
                    &mut transaction,
                    CapturedResponse {
                        status: status.as_u16(),
                        headers: vec![("Content-Type".to_string(), "text/event-stream".to_string())],
                        body: Some(serde_json::json!({"streaming": true})),
                    },
                );
                state.inspector.store(transaction);

                let stream = response.bytes_stream().map(|result| {
                    result.map_err(std::io::Error::other)
                });
                let body = Body::from_stream(stream);

                Response::builder()
                    .status(StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK))
                    .header("Content-Type", "text/event-stream")
                    .header("Cache-Control", "no-cache")
                    .header("Connection", "keep-alive")
                    .body(body)
                    .unwrap()
                    .into_response()
            } else {
                let response_text = response.text().await.unwrap_or_default();
                match serde_json::from_str::<serde_json::Value>(&response_text) {
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
                    Err(e) => {
                        let error = MultiAiError::ParseError(format!(
                            "{} | Response: {}",
                            e,
                            &response_text[..response_text.len().min(500)]
                        ));
                        record_error_response(&state.inspector, &mut transaction, &error)
                    }
                }
            }
        }
        Err(e) => {
            let error = MultiAiError::UpstreamError(format!("Request failed: {}", e));
            record_error_response(&state.inspector, &mut transaction, &error)
        }
    }
}

// ============================================================================
// Inspect handlers
// ============================================================================

pub async fn get_inspect(
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

pub async fn clear_inspect(State(state): State<Arc<AppState>>) -> Json<ClearResponse> {
    let count = state.inspector.get_all().len();
    state.inspector.clear();
    Json(ClearResponse { cleared: true, count })
}

// ============================================================================
// Settings handlers
// ============================================================================

pub async fn get_settings() -> Json<SettingsResponse> {
    let config = Config::load_with_env();

    Json(SettingsResponse {
        openrouter_configured: config.api_keys.openrouter.is_some(),
        opencode_zen_configured: config.api_keys.opencode_zen.is_some(),
    })
}

pub async fn update_settings(
    Json(req): Json<UpdateSettingsRequest>,
) -> Result<Json<SettingsResponse>, (StatusCode, Json<serde_json::Value>)> {
    let mut config = Config::load().unwrap_or_default();

    if let Some(key) = req.openrouter_api_key {
        if key.is_empty() {
            config.api_keys.openrouter = None;
        } else {
            config.api_keys.openrouter = Some(key);
        }
    }

    if let Some(key) = req.opencode_zen_api_key {
        if key.is_empty() {
            config.api_keys.opencode_zen = None;
        } else {
            config.api_keys.opencode_zen = Some(key);
        }
    }

    if let Err(e) = config.save() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Failed to save settings: {}", e) })),
        ));
    }

    Ok(Json(SettingsResponse {
        openrouter_configured: config.api_keys.openrouter.is_some(),
        opencode_zen_configured: config.api_keys.opencode_zen.is_some(),
    }))
}
