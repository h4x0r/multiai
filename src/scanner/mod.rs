//! FreeModelScanner - Discovers free LLM models from multiple sources.
//!
//! Sources:
//! - OpenRouter: /api/v1/models (pricing.prompt=0 means free)
//! - OpenCode Zen: /zen/v1/models (parses pricing table for "Free" models)

#[cfg(test)]
mod tests;

use crate::http::{create_blocking_client, create_client, create_client_with_timeout, DETECTION_TIMEOUT};
use moka::future::Cache;
use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// Local Ollama instance (highest priority)
    Ollama,
    /// OpenCode Zen cloud API
    OpenCodeZen,
    /// OpenRouter cloud API
    OpenRouter,
}


/// Scanner configuration.
#[derive(Clone)]
pub struct FreeModelScanner {
    client: Client,
    openrouter_url: String,
    opencode_zen_api_url: String,
    opencode_zen_docs_url: String,
    ollama_url: Option<String>,
    cache: Cache<String, Arc<Vec<FreeModel>>>,
}

impl FreeModelScanner {
    const DEFAULT_OPENROUTER_URL: &'static str = "https://openrouter.ai/api/v1/models";
    const DEFAULT_OPENCODE_ZEN_API_URL: &'static str = "https://opencode.ai/zen/v1/models";
    const DEFAULT_OPENCODE_ZEN_DOCS_URL: &'static str = "https://opencode.ai/docs/zen";

    pub fn new() -> Self {
        let cache = Cache::builder()
            .time_to_live(Duration::from_secs(3600)) // 1 hour - model lists rarely change
            .build();

        Self {
            client: create_client(),
            openrouter_url: Self::DEFAULT_OPENROUTER_URL.to_string(),
            opencode_zen_api_url: Self::DEFAULT_OPENCODE_ZEN_API_URL.to_string(),
            opencode_zen_docs_url: Self::DEFAULT_OPENCODE_ZEN_DOCS_URL.to_string(),
            ollama_url: None,
            cache,
        }
    }

    /// Set the Ollama endpoint URL (e.g., "http://127.0.0.1:11434")
    pub fn with_ollama_url(mut self, url: &str) -> Self {
        self.ollama_url = Some(url.to_string());
        self
    }

    /// Check if a URL is an Ollama instance by calling /api/tags
    pub async fn detect_ollama(url: &str) -> bool {
        let client = create_client_with_timeout(DETECTION_TIMEOUT);
        let tags_url = format!("{}/api/tags", url);
        if let Ok(response) = client.get(&tags_url).send().await {
            if response.status().is_success() {
                if let Ok(data) = response.json::<Value>().await {
                    return data.get("models").is_some();
                }
            }
        }
        false
    }

    /// Check if a URL is an Ollama instance (blocking version for sync contexts).
    pub fn detect_ollama_blocking(url: &str) -> bool {
        let client = create_blocking_client(Duration::from_secs(1));
        let tags_url = format!("{}/api/tags", url);
        if let Ok(response) = client.get(&tags_url).send() {
            if response.status().is_success() {
                if let Ok(data) = response.json::<Value>() {
                    return data.get("models").is_some();
                }
            }
        }
        false
    }

    /// Check if a URL is a MultiAI instance by calling /health
    pub async fn detect_multiai(url: &str) -> bool {
        let client = create_client_with_timeout(DETECTION_TIMEOUT);
        let health_url = format!("{}/health", url);
        if let Ok(response) = client.get(&health_url).send().await {
            if response.status().is_success() {
                if let Ok(data) = response.json::<Value>().await {
                    return data.get("app").and_then(|v| v.as_str()) == Some("multiai");
                }
            }
        }
        false
    }

    pub fn with_openrouter_url(mut self, url: &str) -> Self {
        self.openrouter_url = url.to_string();
        self
    }

    pub fn with_opencode_zen_api_url(mut self, url: &str) -> Self {
        self.opencode_zen_api_url = url.to_string();
        self
    }

    pub fn with_opencode_zen_docs_url(mut self, url: &str) -> Self {
        self.opencode_zen_docs_url = url.to_string();
        self
    }

    pub fn with_cache_ttl_secs(mut self, secs: u64) -> Self {
        self.cache = Cache::builder()
            .time_to_live(Duration::from_secs(secs))
            .build();
        self
    }

    /// Fetch models from local Ollama instance.
    /// All Ollama models are "free" (local inference).
    pub async fn fetch_ollama(&self) -> Result<Vec<FreeModel>, reqwest::Error> {
        let Some(base_url) = &self.ollama_url else {
            return Ok(Vec::new());
        };

        let tags_url = format!("{}/api/tags", base_url);
        let response = self.client.get(&tags_url).send().await?;

        if !response.status().is_success() {
            return Err(response.error_for_status().unwrap_err());
        }

        let data: Value = response.json().await?;
        let models = data["models"].as_array().cloned().unwrap_or_default();

        Ok(models
            .iter()
            .filter_map(|model| {
                let name = model["name"].as_str()?;
                Some(FreeModel {
                    id: name.to_string(),
                    provider: "ollama".to_string(),
                    endpoint: base_url.clone(),
                    source: Source::Ollama,
                })
            })
            .collect())
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

    /// Fetch free models from OpenCode Zen by parsing their pricing table.
    /// Dynamically discovers which models have "Free" in INPUT/OUTPUT columns.
    pub async fn fetch_opencode_zen(&self) -> Result<Vec<FreeModel>, reqwest::Error> {
        // Step 1: Fetch docs page and parse pricing table
        let docs_response = self.client.get(&self.opencode_zen_docs_url).send().await?;
        if !docs_response.status().is_success() {
            return Err(docs_response.error_for_status().unwrap_err());
        }
        let docs_html = docs_response.text().await?;
        let free_model_names = Self::parse_free_models_from_pricing_table(&docs_html);

        // Step 2: Fetch API to get actual model IDs
        let api_response = self.client.get(&self.opencode_zen_api_url).send().await?;
        if !api_response.status().is_success() {
            return Err(api_response.error_for_status().unwrap_err());
        }
        let data: Value = api_response.json().await?;
        let models = data["data"].as_array().cloned().unwrap_or_default();

        // Step 3: Match free model names to API model IDs
        Ok(self.filter_opencode_zen_free(&models, &free_model_names))
    }

    /// Parse the OpenCode Zen pricing table to find free models.
    /// A model is free if INPUT and OUTPUT columns both contain "Free".
    pub fn parse_free_models_from_pricing_table(html: &str) -> Vec<String> {
        let mut free_models = Vec::new();
        let document = Html::parse_document(html);

        // Select all table rows
        let row_selector = Selector::parse("tr").unwrap();
        let cell_selector = Selector::parse("td, th").unwrap();

        for row in document.select(&row_selector) {
            let cells: Vec<String> = row
                .select(&cell_selector)
                .map(|cell| cell.text().collect::<String>().trim().to_string())
                .collect();

            // Need at least 3 columns: MODEL, INPUT, OUTPUT
            if cells.len() >= 3 {
                let model_name = &cells[0];
                let input_price = &cells[1];
                let output_price = &cells[2];

                // Skip header row
                if model_name.to_uppercase() == "MODEL" {
                    continue;
                }

                // Check if both INPUT and OUTPUT are "Free" (case-insensitive)
                if input_price.eq_ignore_ascii_case("free")
                    && output_price.eq_ignore_ascii_case("free")
                {
                    free_models.push(model_name.clone());
                }
            }
        }

        free_models
    }

    /// Filter OpenCode Zen models to only free ones based on parsed pricing table.
    /// Matches model names from pricing table to API model IDs using flexible matching.
    fn filter_opencode_zen_free(&self, models: &[Value], free_model_names: &[String]) -> Vec<FreeModel> {
        models
            .iter()
            .filter_map(|model| {
                let id = model["id"].as_str()?;
                let id_lower = id.to_lowercase();

                // Check if this model ID matches any free model from pricing table
                // Use flexible matching: normalize both names for comparison
                let is_free = free_model_names.iter().any(|free_name| {
                    let name_normalized = free_name.to_lowercase().replace([' ', '.'], "-");
                    let id_normalized = id_lower.replace("-free", "");

                    // Match if ID contains the normalized name or vice versa
                    id_normalized.contains(&name_normalized)
                        || name_normalized.contains(&id_normalized.replace("opencode/", ""))
                        || Self::fuzzy_model_match(&id_lower, &free_name.to_lowercase())
                });

                if is_free {
                    Some(FreeModel {
                        id: id.to_string(),
                        provider: "opencode-zen".to_string(),
                        endpoint: "https://opencode.ai/zen/v1".to_string(),
                        source: Source::OpenCodeZen,
                    })
                } else {
                    None
                }
            })
            .collect()
    }

    /// Fuzzy matching for model names to API IDs.
    /// Handles cases like "Grok Code Fast 1" matching "grok-code" or "grok-code-fast-1".
    fn fuzzy_model_match(id: &str, name: &str) -> bool {
        // Remove common suffixes/prefixes and compare
        let id_parts: Vec<&str> = id.split(['-', '_', '/']).collect();
        let name_parts: Vec<&str> = name.split([' ', '-', '_']).collect();

        // Check if all significant name parts appear in the ID
        let significant_parts: Vec<&str> = name_parts
            .iter()
            .filter(|p| !p.is_empty() && p.len() > 1)
            .copied()
            .collect();

        if significant_parts.is_empty() {
            return false;
        }

        // All significant name parts must be found in the ID
        significant_parts.iter().all(|part| {
            id_parts.iter().any(|id_part| {
                id_part.contains(part) || part.contains(id_part)
            })
        })
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

    /// Get all free models from all sources (with caching).
    /// Models are sorted by source priority: Ollama > OpenCodeZen > OpenRouter
    pub async fn get_free_models(&self, force_refresh: bool) -> Vec<FreeModel> {
        const CACHE_KEY: &str = "all_free_models";

        if !force_refresh {
            if let Some(cached) = self.cache.get(CACHE_KEY).await {
                return (*cached).clone();
            }
        }

        // Fetch from all sources in parallel for faster startup
        let (ollama_result, openrouter_result, opencode_zen_result) = tokio::join!(
            self.fetch_ollama(),
            self.fetch_openrouter(),
            self.fetch_opencode_zen()
        );

        let mut all_free = Vec::new();

        // Add in priority order: Ollama first (local), then cloud providers
        if let Ok(models) = ollama_result {
            all_free.extend(models);
        }

        if let Ok(models) = opencode_zen_result {
            all_free.extend(models);
        }

        if let Ok(models) = openrouter_result {
            all_free.extend(models);
        }

        // Sort by source priority (Ollama < OpenCodeZen < OpenRouter in enum order)
        all_free.sort_by(|a, b| a.source.cmp(&b.source));

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
