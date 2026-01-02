//! FreeModelScanner - Discovers free LLM models from multiple sources.
//!
//! Sources:
//! - OpenRouter: /api/v1/models (pricing.prompt=0 means free)
//! - OpenCode Zen: /zen/v1/models (parses pricing table for "Free" models)

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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    OpenRouter,
    OpenCodeZen,
}


/// Scanner configuration.
#[derive(Clone)]
pub struct FreeModelScanner {
    client: Client,
    openrouter_url: String,
    opencode_zen_api_url: String,
    opencode_zen_docs_url: String,
    cache: Cache<String, Arc<Vec<FreeModel>>>,
}

impl FreeModelScanner {
    const DEFAULT_OPENROUTER_URL: &'static str = "https://openrouter.ai/api/v1/models";
    const DEFAULT_OPENCODE_ZEN_API_URL: &'static str = "https://opencode.ai/zen/v1/models";
    const DEFAULT_OPENCODE_ZEN_DOCS_URL: &'static str = "https://opencode.ai/docs/zen";

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
            opencode_zen_api_url: Self::DEFAULT_OPENCODE_ZEN_API_URL.to_string(),
            opencode_zen_docs_url: Self::DEFAULT_OPENCODE_ZEN_DOCS_URL.to_string(),
            cache,
        }
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
                    let name_normalized = free_name.to_lowercase().replace(' ', "-").replace('.', "-");
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
        let id_parts: Vec<&str> = id.split(|c| c == '-' || c == '_' || c == '/').collect();
        let name_parts: Vec<&str> = name.split(|c| c == ' ' || c == '-' || c == '_').collect();

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

        // Fetch from OpenCode Zen (dynamically parses pricing table for free models)
        if let Ok(models) = self.fetch_opencode_zen().await {
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

    #[tokio::test]
    async fn parses_free_models_from_pricing_table() {
        // Realistic HTML table structure from opencode.ai/docs/zen
        // Free models have "Free" in INPUT and OUTPUT columns
        let sample_html = r#"
            <h2>Pricing</h2>
            <p>We support a pay-as-you-go model. Below are the prices per 1M tokens.</p>
            <table>
                <thead>
                    <tr>
                        <th>MODEL</th>
                        <th>INPUT</th>
                        <th>OUTPUT</th>
                        <th>CACHED READ</th>
                        <th>CACHED WRITE</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Big Pickle</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr>
                    <tr><td>Grok Code Fast 1</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr>
                    <tr><td>MiniMax M2.1</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr>
                    <tr><td>GLM 4.7</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr>
                    <tr><td>GLM 4.6</td><td>$0.60</td><td>$2.20</td><td>$0.10</td><td>-</td></tr>
                    <tr><td>Kimi K2</td><td>$0.40</td><td>$2.50</td><td>-</td><td>-</td></tr>
                    <tr><td>Claude Opus 4.5</td><td>$5.00</td><td>$25.00</td><td>$0.50</td><td>$6.25</td></tr>
                    <tr><td>GPT 5.2</td><td>$1.75</td><td>$14.00</td><td>$0.175</td><td>-</td></tr>
                    <tr><td>GPT 5 Nano</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr>
                </tbody>
            </table>
        "#;

        let free_models = FreeModelScanner::parse_free_models_from_pricing_table(sample_html);

        // Should find exactly 5 free models (all with Free in INPUT and OUTPUT)
        assert!(free_models.contains(&"Big Pickle".to_string()), "Should find Big Pickle");
        assert!(free_models.contains(&"Grok Code Fast 1".to_string()), "Should find Grok Code Fast 1");
        assert!(free_models.contains(&"MiniMax M2.1".to_string()), "Should find MiniMax M2.1");
        assert!(free_models.contains(&"GLM 4.7".to_string()), "Should find GLM 4.7");
        assert!(free_models.contains(&"GPT 5 Nano".to_string()), "Should find GPT 5 Nano");
        assert_eq!(free_models.len(), 5, "Should find exactly 5 free models");

        // Should NOT include paid models
        assert!(!free_models.contains(&"GLM 4.6".to_string()), "Should not find paid GLM 4.6");
        assert!(!free_models.contains(&"Claude Opus 4.5".to_string()), "Should not find paid Claude");
    }

    #[tokio::test]
    async fn fetches_free_models_from_opencode_zen() {
        let mut server = mockito::Server::new_async().await;

        // Mock docs page with pricing table
        let docs_html = r#"
            <h2>Pricing</h2>
            <table>
                <tr><th>MODEL</th><th>INPUT</th><th>OUTPUT</th><th>CACHED READ</th></tr>
                <tr><td>GLM 4.7</td><td>Free</td><td>Free</td><td>Free</td></tr>
                <tr><td>Grok Code Fast 1</td><td>Free</td><td>Free</td><td>Free</td></tr>
                <tr><td>Claude Opus 4.5</td><td>$5.00</td><td>$25.00</td><td>$0.50</td></tr>
            </table>
        "#;

        let docs_mock = server
            .mock("GET", "/docs/zen")
            .with_status(200)
            .with_header("content-type", "text/html")
            .with_body(docs_html)
            .create_async()
            .await;

        // Mock API response
        let api_response = serde_json::json!({
            "object": "list",
            "data": [
                {"id": "glm-4-7-free", "object": "model", "owned_by": "opencode"},
                {"id": "grok-code-fast-1", "object": "model", "owned_by": "opencode"},
                {"id": "claude-opus-4-5", "object": "model", "owned_by": "opencode"},
            ]
        });

        let api_mock = server
            .mock("GET", "/zen/v1/models")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(api_response.to_string())
            .create_async()
            .await;

        let scanner = FreeModelScanner::new()
            .with_opencode_zen_docs_url(&format!("{}/docs/zen", server.url()))
            .with_opencode_zen_api_url(&format!("{}/zen/v1/models", server.url()));

        let free_models = scanner.fetch_opencode_zen().await.unwrap();

        docs_mock.assert_async().await;
        api_mock.assert_async().await;

        // Should find GLM 4.7 and Grok Code Fast 1, but NOT Claude Opus 4.5
        assert_eq!(free_models.len(), 2, "Expected 2 free models, got {:?}", free_models);
        assert!(free_models.iter().any(|m| m.id == "glm-4-7-free"), "Should find GLM 4.7");
        assert!(free_models.iter().any(|m| m.id == "grok-code-fast-1"), "Should find Grok Code Fast 1");
        assert!(free_models.iter().all(|m| m.source == Source::OpenCodeZen));
    }
}
