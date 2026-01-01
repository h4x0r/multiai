//! FreeModelScanner - Discovers free LLM models from multiple sources.
//!
//! Sources:
//! - OpenRouter: /api/v1/models (pricing.prompt=0 means free)
//! - Models.dev: /api.json (cost.input=0, cost.output=0 means free)

use moka::future::Cache;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// A free model discovered from an API source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FreeModel {
    pub id: String,
    pub provider: String,
    pub endpoint: String,
    pub source: Source,
}

/// Source of the free model information.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    OpenRouter,
    ModelsDev,
}

/// Scanner configuration.
#[derive(Clone)]
pub struct FreeModelScanner {
    client: Client,
    openrouter_url: String,
    models_dev_url: String,
    cache: Cache<String, Arc<Vec<FreeModel>>>,
}

impl FreeModelScanner {
    const DEFAULT_OPENROUTER_URL: &'static str = "https://openrouter.ai/api/v1/models";
    const DEFAULT_MODELS_DEV_URL: &'static str = "https://models.dev/api.json";

    pub fn new() -> Self {
        let cache = Cache::builder()
            .time_to_live(Duration::from_secs(300))
            .build();

        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("Failed to create HTTP client"),
            openrouter_url: Self::DEFAULT_OPENROUTER_URL.to_string(),
            models_dev_url: Self::DEFAULT_MODELS_DEV_URL.to_string(),
            cache,
        }
    }

    pub fn with_openrouter_url(mut self, url: &str) -> Self {
        self.openrouter_url = url.to_string();
        self
    }

    pub fn with_models_dev_url(mut self, url: &str) -> Self {
        self.models_dev_url = url.to_string();
        self
    }

    pub fn with_cache_ttl_secs(mut self, secs: u64) -> Self {
        self.cache = Cache::builder()
            .time_to_live(Duration::from_secs(secs))
            .build();
        self
    }

    /// Fetch free models from OpenRouter API.
    pub async fn fetch_openrouter(&self) -> Result<Vec<FreeModel>, reqwest::Error> {
        let response = self.client.get(&self.openrouter_url).send().await?;
        let status = response.status();

        if !status.is_success() {
            return Err(response.error_for_status().unwrap_err());
        }

        let data: Value = response.json().await?;
        let models = data["data"].as_array().cloned().unwrap_or_default();

        Ok(self.filter_openrouter_free(&models))
    }

    /// Fetch free models from models.dev API.
    pub async fn fetch_models_dev(&self) -> Result<Vec<FreeModel>, reqwest::Error> {
        let response = self.client.get(&self.models_dev_url).send().await?;
        let status = response.status();

        if !status.is_success() {
            return Err(response.error_for_status().unwrap_err());
        }

        let data: HashMap<String, Value> = response.json().await?;
        Ok(self.filter_models_dev_free(&data))
    }

    /// Filter OpenRouter models to only free ones.
    pub fn filter_openrouter_free(&self, models: &[Value]) -> Vec<FreeModel> {
        models
            .iter()
            .filter_map(|model| {
                let id = model["id"].as_str()?;
                let pricing = &model["pricing"];

                let prompt_price = pricing["prompt"].as_str()
                    .and_then(|p| p.parse::<f64>().ok())
                    .unwrap_or(1.0);
                let completion_price = pricing["completion"].as_str()
                    .and_then(|p| p.parse::<f64>().ok())
                    .unwrap_or(1.0);

                if prompt_price == 0.0 && completion_price == 0.0 {
                    Some(FreeModel {
                        id: id.to_string(),
                        provider: "openrouter".to_string(),
                        endpoint: "https://openrouter.ai/api/v1".to_string(),
                        source: Source::OpenRouter,
                    })
                } else {
                    None
                }
            })
            .collect()
    }

    /// Filter models.dev data to only free models.
    fn filter_models_dev_free(&self, data: &HashMap<String, Value>) -> Vec<FreeModel> {
        let mut free_models = Vec::new();

        for (provider_id, provider_data) in data {
            let api_endpoint = provider_data["api"].as_str().unwrap_or("");
            let models = match provider_data["models"].as_object() {
                Some(m) => m,
                None => continue,
            };

            for (model_id, model_info) in models {
                let cost = &model_info["cost"];
                let input_cost = cost["input"].as_f64().unwrap_or(1.0);
                let output_cost = cost["output"].as_f64().unwrap_or(1.0);

                if input_cost == 0.0 && output_cost == 0.0 {
                    free_models.push(FreeModel {
                        id: model_id.clone(),
                        provider: provider_id.clone(),
                        endpoint: api_endpoint.to_string(),
                        source: Source::ModelsDev,
                    });
                }
            }
        }

        free_models
    }

    /// Get all free models from all sources (with caching).
    pub async fn get_free_models(&self, force_refresh: bool) -> Vec<FreeModel> {
        const CACHE_KEY: &str = "all_free_models";

        if !force_refresh {
            if let Some(cached) = self.cache.get(CACHE_KEY).await {
                return (*cached).clone();
            }
        }

        let mut all_free = Vec::new();

        // Fetch from OpenRouter
        if let Ok(models) = self.fetch_openrouter().await {
            all_free.extend(models);
        }

        // Fetch from models.dev
        if let Ok(models) = self.fetch_models_dev().await {
            all_free.extend(models);
        }

        // Cache results
        self.cache.insert(CACHE_KEY.to_string(), Arc::new(all_free.clone())).await;

        all_free
    }
}

impl Default for FreeModelScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fetches_free_models_from_openrouter() {
        let mut server = mockito::Server::new_async().await;

        let openrouter_response = serde_json::json!({
            "data": [
                {"id": "meta-llama/llama-3:free", "pricing": {"prompt": "0", "completion": "0"}},
                {"id": "openai/gpt-4", "pricing": {"prompt": "0.03", "completion": "0.06"}},
            ]
        });

        let mock = server
            .mock("GET", "/api/v1/models")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(openrouter_response.to_string())
            .create_async()
            .await;

        let scanner = FreeModelScanner::new()
            .with_openrouter_url(&format!("{}/api/v1/models", server.url()));

        let free_models = scanner.fetch_openrouter().await.unwrap();

        mock.assert_async().await;
        assert_eq!(free_models.len(), 1);
        assert_eq!(free_models[0].id, "meta-llama/llama-3:free");
        assert_eq!(free_models[0].source, Source::OpenRouter);
    }

    #[tokio::test]
    async fn fetches_free_models_from_models_dev() {
        let mut server = mockito::Server::new_async().await;

        let models_dev_response = serde_json::json!({
            "zai-coding-plan": {
                "name": "Z.AI Coding Plan",
                "api": "https://api.z.ai/v1",
                "models": {
                    "glm-4.7": {"name": "GLM-4.7", "cost": {"input": 0, "output": 0}},
                    "glm-4.6": {"name": "GLM-4.6", "cost": {"input": 0.5, "output": 1.0}},
                }
            }
        });

        let mock = server
            .mock("GET", "/api.json")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(models_dev_response.to_string())
            .create_async()
            .await;

        let scanner = FreeModelScanner::new()
            .with_models_dev_url(&format!("{}/api.json", server.url()));

        let free_models = scanner.fetch_models_dev().await.unwrap();

        mock.assert_async().await;
        assert_eq!(free_models.len(), 1);
        assert_eq!(free_models[0].id, "glm-4.7");
        assert_eq!(free_models[0].endpoint, "https://api.z.ai/v1");
        assert_eq!(free_models[0].source, Source::ModelsDev);
    }

    #[tokio::test]
    async fn handles_api_failure_gracefully() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("GET", "/api/v1/models")
            .with_status(500)
            .create_async()
            .await;

        let scanner = FreeModelScanner::new()
            .with_openrouter_url(&format!("{}/api/v1/models", server.url()));

        let result = scanner.fetch_openrouter().await;

        mock.assert_async().await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn filters_only_free_models_from_openrouter() {
        let scanner = FreeModelScanner::new();

        let models = vec![
            serde_json::json!({"id": "free-model", "pricing": {"prompt": "0", "completion": "0"}}),
            serde_json::json!({"id": "paid-model", "pricing": {"prompt": "0.01", "completion": "0.02"}}),
            serde_json::json!({"id": "half-free", "pricing": {"prompt": "0", "completion": "0.01"}}),
        ];

        let free = scanner.filter_openrouter_free(&models);

        assert_eq!(free.len(), 1);
        assert_eq!(free[0].id, "free-model");
    }

    #[tokio::test]
    async fn caches_results_with_ttl() {
        let mut server = mockito::Server::new_async().await;

        let response = serde_json::json!({
            "data": [
                {"id": "test:free", "pricing": {"prompt": "0", "completion": "0"}},
            ]
        });

        let mock = server
            .mock("GET", "/api/v1/models")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response.to_string())
            .expect(1)
            .create_async()
            .await;

        let scanner = FreeModelScanner::new()
            .with_openrouter_url(&format!("{}/api/v1/models", server.url()))
            .with_cache_ttl_secs(300);

        let _ = scanner.get_free_models(false).await;
        let _ = scanner.get_free_models(false).await;

        mock.assert_async().await;
    }
}
