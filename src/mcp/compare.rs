//! Model comparison logic for MCP.

use super::judge::JudgePanel;
use crate::config::Config;
use crate::http::{create_client_with_timeout, LONG_TIMEOUT};
use crate::scanner::{FreeModel, FreeModelScanner, Source};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant};
use tokio::time::timeout;

/// Parameters for a model comparison request.
#[derive(Debug, Clone, Deserialize)]
pub struct CompareParams {
    pub prompt: String,
    #[serde(default)]
    pub models: Option<Vec<String>>,
    #[serde(default)]
    pub max_models: Option<usize>,
    #[serde(default = "default_include_ranking")]
    pub include_ranking: bool,
}

fn default_include_ranking() -> bool {
    true
}

/// Metrics for a single model response.
#[derive(Debug, Clone, Serialize)]
pub struct ResponseMetrics {
    pub ttft_ms: u64,
    pub total_ms: u64,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub tokens_per_sec: f64,
}

/// Scores for a single model response.
#[derive(Debug, Clone, Serialize)]
pub struct ResponseScores {
    pub speed: f64,
    pub quality: f64,
    pub efficiency: f64,
    pub overall: f64,
}

/// A single model's comparison result.
#[derive(Debug, Clone, Serialize)]
pub struct ModelResult {
    pub model: String,
    pub source: String,
    pub response: String,
    pub metrics: ResponseMetrics,
    pub scores: ResponseScores,
}

/// Full comparison result.
#[derive(Debug, Clone, Serialize)]
pub struct CompareResult {
    pub prompt: String,
    pub compared_at: DateTime<Utc>,
    pub results: Vec<ModelResult>,
    pub ranking: Vec<String>,
    pub markdown_summary: String,
}

/// Default Ollama URL to check for local models.
const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";

/// Model comparator that handles parallel requests.
pub struct ModelComparator {
    scanner: FreeModelScanner,
    client: Client,
}

impl ModelComparator {
    /// Create a new comparator (auto-detects Ollama if available).
    pub fn new() -> Self {
        // Check for Ollama using centralized detection
        let scanner = if FreeModelScanner::detect_ollama_blocking(DEFAULT_OLLAMA_URL) {
            FreeModelScanner::new().with_ollama_url(DEFAULT_OLLAMA_URL)
        } else {
            FreeModelScanner::new()
        };

        Self {
            scanner,
            client: create_client_with_timeout(LONG_TIMEOUT),
        }
    }

    /// Compare models with the given prompt.
    pub async fn compare(&self, params: CompareParams) -> Result<CompareResult, String> {
        // Get available models
        let all_models = self.scanner.get_free_models(false).await;
        if all_models.is_empty() {
            return Err("No free models available".to_string());
        }

        // Filter models if specific ones are requested
        let models: Vec<FreeModel> = match &params.models {
            Some(requested) => all_models
                .into_iter()
                .filter(|m| requested.iter().any(|r| m.id.contains(r) || r.contains(&m.id)))
                .collect(),
            None => all_models,
        };

        // Apply max_models limit
        let models: Vec<FreeModel> = match params.max_models {
            Some(max) => models.into_iter().take(max).collect(),
            None => models.into_iter().take(5).collect(), // Default to 5 models
        };

        if models.is_empty() {
            return Err("No matching models found".to_string());
        }

        // Send requests to all models in parallel
        let config = Config::load_with_env();
        let mut handles = Vec::new();

        for model in models {
            let client = self.client.clone();
            let prompt = params.prompt.clone();
            let api_key = config.get_api_key(&model.source);

            handles.push(tokio::spawn(async move {
                query_model(client, model, prompt, api_key).await
            }));
        }

        // Collect results
        let mut results = Vec::new();
        for handle in handles {
            if let Ok(Ok(result)) = handle.await {
                results.push(result);
            }
        }

        if results.is_empty() {
            return Err("All model requests failed".to_string());
        }

        // Run LLM judge panel for quality scoring if requested
        if params.include_ranking {
            let judge_panel = JudgePanel::new();
            if judge_panel.is_available() {
                // Evaluate each response with the judge panel
                for result in &mut results {
                    if let Ok((quality_score, _judge_scores)) = judge_panel
                        .evaluate(&params.prompt, &result.response)
                        .await
                    {
                        result.scores.quality = quality_score;
                        // Recalculate overall score
                        result.scores.overall = (result.scores.speed * 0.25)
                            + (result.scores.quality * 0.50)
                            + (result.scores.efficiency * 0.25);
                    }
                }
            }
        }

        // Sort by overall score (descending)
        results.sort_by(|a, b| {
            b.scores
                .overall
                .partial_cmp(&a.scores.overall)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let ranking: Vec<String> = results.iter().map(|r| r.model.clone()).collect();
        let markdown_summary = generate_markdown_summary(&params.prompt, &results);

        Ok(CompareResult {
            prompt: params.prompt,
            compared_at: Utc::now(),
            results,
            ranking,
            markdown_summary,
        })
    }
}

impl Default for ModelComparator {
    fn default() -> Self {
        Self::new()
    }
}

/// Query a single model and collect metrics.
async fn query_model(
    client: Client,
    model: FreeModel,
    prompt: String,
    api_key: Option<String>,
) -> Result<ModelResult, String> {
    let start = Instant::now();

    let upstream_url = if model.source == Source::Ollama {
        format!("{}/v1/chat/completions", model.endpoint)
    } else {
        format!("{}/chat/completions", model.endpoint)
    };

    let request_body = serde_json::json!({
        "model": model.id,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "max_tokens": 500,
        "stream": false,
    });

    let mut req = client
        .post(&upstream_url)
        .header("Content-Type", "application/json");

    if let Some(key) = &api_key {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let response = timeout(Duration::from_secs(30), req.json(&request_body).send())
        .await
        .map_err(|_| "Request timeout".to_string())?
        .map_err(|e| format!("Request failed: {}", e))?;

    let ttft_ms = start.elapsed().as_millis() as u64;

    if !response.status().is_success() {
        return Err(format!("Model returned status: {}", response.status()));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let total_ms = start.elapsed().as_millis() as u64;

    // Extract response text
    let response_text = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    // Extract token counts (if available)
    let input_tokens = body["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as u32;
    let output_tokens = body["usage"]["completion_tokens"].as_u64().unwrap_or(0) as u32;

    // Calculate tokens per second
    let tokens_per_sec = if total_ms > 0 {
        (output_tokens as f64 / total_ms as f64) * 1000.0
    } else {
        0.0
    };

    // Calculate scores
    let speed_score = calculate_speed_score(ttft_ms, tokens_per_sec);
    let quality_score = 7.0; // Placeholder - would need LLM judges
    let efficiency_score = calculate_efficiency_score(output_tokens);
    let overall_score = (speed_score * 0.25) + (quality_score * 0.50) + (efficiency_score * 0.25);

    Ok(ModelResult {
        model: model.id,
        source: format!("{:?}", model.source).to_lowercase(),
        response: response_text,
        metrics: ResponseMetrics {
            ttft_ms,
            total_ms,
            input_tokens,
            output_tokens,
            tokens_per_sec,
        },
        scores: ResponseScores {
            speed: speed_score,
            quality: quality_score,
            efficiency: efficiency_score,
            overall: overall_score,
        },
    })
}

/// Calculate speed score (0-10) based on TTFT and tokens/sec.
fn calculate_speed_score(ttft_ms: u64, tokens_per_sec: f64) -> f64 {
    // Base score from TTFT: 100ms = 9, 500ms = 5, 1000ms+ = 0
    let ttft_score = (10.0 - (ttft_ms as f64 / 100.0)).clamp(0.0, 10.0);

    // Bonus for fast generation (tokens/sec > 50)
    let speed_bonus = if tokens_per_sec > 50.0 {
        ((tokens_per_sec - 50.0) / 50.0).min(2.0)
    } else {
        0.0
    };

    (ttft_score + speed_bonus).clamp(0.0, 10.0)
}

/// Calculate efficiency score (0-10) based on output length.
fn calculate_efficiency_score(output_tokens: u32) -> f64 {
    // More output tokens = better value for free models
    // 100 tokens = 5, 200 tokens = 7, 500+ tokens = 10
    (output_tokens as f64 / 50.0).clamp(1.0, 10.0)
}

/// Generate markdown summary of comparison results.
fn generate_markdown_summary(prompt: &str, results: &[ModelResult]) -> String {
    let mut md = String::new();

    md.push_str("## Model Comparison Results\n\n");
    md.push_str(&format!("**Prompt:** {}\n\n", prompt));

    md.push_str("| Model | TTFT | Total | Quality | Tokens/s | Overall |\n");
    md.push_str("|-------|------|-------|---------|----------|--------|\n");

    for r in results {
        md.push_str(&format!(
            "| {} | {}ms | {}ms | {:.1} | {:.1} | **{:.1}** |\n",
            r.model,
            r.metrics.ttft_ms,
            r.metrics.total_ms,
            r.scores.quality,
            r.metrics.tokens_per_sec,
            r.scores.overall
        ));
    }

    if let Some(winner) = results.first() {
        md.push_str(&format!(
            "\n**Winner:** {} (best overall score: {:.1})\n",
            winner.model, winner.scores.overall
        ));
    }

    md
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speed_score_fast_ttft_scores_high() {
        let score = calculate_speed_score(100, 50.0);
        assert!(score >= 9.0);
    }

    #[test]
    fn speed_score_slow_ttft_scores_low() {
        let score = calculate_speed_score(1000, 10.0);
        assert!(score <= 2.0);
    }

    #[test]
    fn efficiency_score_more_tokens_scores_higher() {
        let low = calculate_efficiency_score(50);
        let high = calculate_efficiency_score(500);
        assert!(high > low);
    }

    #[test]
    fn markdown_summary_contains_prompt() {
        let results = vec![ModelResult {
            model: "test-model".to_string(),
            source: "openrouter".to_string(),
            response: "Test response".to_string(),
            metrics: ResponseMetrics {
                ttft_ms: 100,
                total_ms: 500,
                input_tokens: 10,
                output_tokens: 50,
                tokens_per_sec: 100.0,
            },
            scores: ResponseScores {
                speed: 9.0,
                quality: 7.0,
                efficiency: 5.0,
                overall: 7.0,
            },
        }];

        let summary = generate_markdown_summary("What is 2+2?", &results);
        assert!(summary.contains("What is 2+2?"));
        assert!(summary.contains("test-model"));
        assert!(summary.contains("Winner"));
    }
}
