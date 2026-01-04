//! Request and response types for the OpenAI-compatible API.

use crate::scanner::Source;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub app: &'static str,
    pub version: &'static str,
}

#[derive(Serialize)]
pub struct ModelsResponse {
    pub object: &'static str,
    pub data: Vec<ModelInfo>,
}

#[derive(Serialize)]
pub struct GroupedModelsResponse {
    pub models: Vec<GroupedModel>,
}

#[derive(Serialize)]
pub struct GroupedModel {
    pub name: String,
    pub providers: Vec<ProviderOption>,
}

#[derive(Serialize)]
pub struct ProviderOption {
    pub id: String,
    pub source: Source,
    pub endpoint: String,
}

#[derive(Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub object: &'static str,
    pub created: i64,
    pub owned_by: String,
}

#[derive(Deserialize, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub stream: bool,
}

#[derive(Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct InspectQuery {
    pub format: Option<String>,
}

#[derive(Serialize)]
pub struct ClearResponse {
    pub cleared: bool,
    pub count: usize,
}

#[derive(Serialize)]
pub struct SettingsResponse {
    pub openrouter_configured: bool,
    pub opencode_zen_configured: bool,
}

#[derive(Deserialize)]
pub struct UpdateSettingsRequest {
    pub openrouter_api_key: Option<String>,
    pub opencode_zen_api_key: Option<String>,
}
