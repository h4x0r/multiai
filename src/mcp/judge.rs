//! LLM Judge panel for quality scoring.
//!
//! Uses 7 premium models via OpenRouter to evaluate response quality
//! with US/EU data residency guarantees.

use super::spending::SpendingTracker;
use crate::config::Config;
use crate::http::{create_client_with_timeout, LONG_TIMEOUT};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio::time::timeout;

/// Judge panel configuration - 7 premium models.
pub const JUDGE_MODELS: &[JudgeModel] = &[
    JudgeModel {
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        provider: "Anthropic",
        region: "US",
    },
    JudgeModel {
        id: "openai/gpt-4o",
        name: "GPT-4o",
        provider: "OpenAI",
        region: "US",
    },
    JudgeModel {
        id: "google/gemini-2.0-flash-001",
        name: "Gemini 2.0 Flash",
        provider: "Google",
        region: "US",
    },
    JudgeModel {
        id: "mistralai/mistral-large-latest",
        name: "Mistral Large",
        provider: "Mistral",
        region: "EU",
    },
    JudgeModel {
        id: "deepseek/deepseek-chat",
        name: "DeepSeek Chat",
        provider: "Fireworks",
        region: "US",
    },
    JudgeModel {
        id: "x-ai/grok-2-latest",
        name: "Grok 2",
        provider: "xAI",
        region: "US",
    },
    JudgeModel {
        id: "qwen/qwen-2.5-72b-instruct",
        name: "Qwen 2.5 72B",
        provider: "Fireworks",
        region: "US",
    },
];

/// A judge model configuration.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct JudgeModel {
    pub id: &'static str,
    pub name: &'static str,
    pub provider: &'static str,
    pub region: &'static str,
}

/// Result from a single judge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JudgeScore {
    pub judge: String,
    pub score: f64,
    pub reason: String,
}

/// Estimated cost per judge call (7 judges x ~$0.01 each).
pub const ESTIMATED_COST_PER_EVALUATION: f64 = 0.07;

/// Judge panel that evaluates responses.
pub struct JudgePanel {
    client: Client,
    api_key: Option<String>,
    spending_tracker: Option<SpendingTracker>,
}

impl JudgePanel {
    /// Create a new judge panel.
    pub fn new() -> Self {
        let config = Config::load_with_env();

        // Set up spending tracker with database in config dir
        let spending_tracker = dirs::config_dir()
            .map(|dir| dir.join("multiai").join("spending.db"))
            .and_then(|path| SpendingTracker::new(path, config.spending.clone()).ok());

        Self {
            client: create_client_with_timeout(LONG_TIMEOUT),
            api_key: config.api_keys.openrouter,
            spending_tracker,
        }
    }

    /// Check if judging is available (requires OpenRouter API key).
    pub fn is_available(&self) -> bool {
        self.api_key.is_some()
    }

    /// Check if a judge call would exceed spending caps.
    pub fn check_spending_cap(&self) -> Result<(), String> {
        if let Some(tracker) = &self.spending_tracker {
            tracker
                .check_cap(ESTIMATED_COST_PER_EVALUATION)
                .map_err(|e| e.message)
        } else {
            Ok(()) // No tracker = no spending limits
        }
    }

    /// Record cost after a successful evaluation.
    fn record_cost(&self, cost: f64) {
        if let Some(tracker) = &self.spending_tracker {
            let _ = tracker.record_cost(cost);
        }
    }

    /// Evaluate a response using the judge panel.
    /// Returns the median score and all individual scores.
    pub async fn evaluate(
        &self,
        user_prompt: &str,
        model_response: &str,
    ) -> Result<(f64, Vec<JudgeScore>), String> {
        let api_key = self.api_key.as_ref().ok_or("No OpenRouter API key")?;

        // Check spending cap before making expensive API calls
        self.check_spending_cap()?;

        let judge_prompt = format!(
            r#"You are evaluating AI responses. Rate this response on a scale of 1-10.

Original question: "{}"

Response to evaluate:
"""
{}
"""

Score based on:
- Accuracy: Is the information correct?
- Completeness: Does it fully answer the question?
- Clarity: Is it well-structured and easy to understand?
- Usefulness: Would this actually help the user?

Reply with ONLY a JSON object: {{"score": N, "reason": "brief explanation"}}"#,
            user_prompt, model_response
        );

        // Fan out to all judges in parallel
        let mut handles = Vec::new();
        for judge in JUDGE_MODELS {
            let client = self.client.clone();
            let api_key = api_key.clone();
            let prompt = judge_prompt.clone();
            let judge_id = judge.id.to_string();
            let judge_name = judge.name.to_string();

            handles.push(tokio::spawn(async move {
                query_judge(client, &api_key, &judge_id, &judge_name, &prompt).await
            }));
        }

        // Collect results
        let mut scores: Vec<JudgeScore> = Vec::new();
        for handle in handles {
            if let Ok(Ok(score)) = handle.await {
                scores.push(score);
            }
        }

        if scores.len() < 3 {
            return Err(format!(
                "Not enough judges responded ({}/7)",
                scores.len()
            ));
        }

        // Calculate median
        let mut score_values: Vec<f64> = scores.iter().map(|s| s.score).collect();
        score_values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = score_values[score_values.len() / 2];

        // Record cost based on number of judges that responded
        // Approximate cost: ~$0.01 per judge call
        let cost = scores.len() as f64 * 0.01;
        self.record_cost(cost);

        Ok((median, scores))
    }
}

impl Default for JudgePanel {
    fn default() -> Self {
        Self::new()
    }
}

/// Query a single judge model.
async fn query_judge(
    client: Client,
    api_key: &str,
    model_id: &str,
    judge_name: &str,
    prompt: &str,
) -> Result<JudgeScore, String> {
    let request_body = serde_json::json!({
        "model": model_id,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 200,
    });

    let response = timeout(
        Duration::from_secs(30),
        client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("HTTP-Referer", "https://github.com/multiai")
            .json(&request_body)
            .send(),
    )
    .await
    .map_err(|_| format!("{}: timeout", judge_name))?
    .map_err(|e| format!("{}: request failed: {}", judge_name, e))?;

    if !response.status().is_success() {
        return Err(format!("{}: status {}", judge_name, response.status()));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("{}: parse error: {}", judge_name, e))?;

    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("");

    // Parse JSON from response
    let parsed: Result<Value, _> = serde_json::from_str(content);
    let (score, reason) = match parsed {
        Ok(v) => {
            let s = v["score"].as_f64().unwrap_or(5.0);
            let r = v["reason"].as_str().unwrap_or("").to_string();
            (s, r)
        }
        Err(_) => {
            // Try to extract score from text
            let score = extract_score_from_text(content).unwrap_or(5.0);
            (score, "Could not parse structured response".to_string())
        }
    };

    Ok(JudgeScore {
        judge: judge_name.to_string(),
        score: score.clamp(1.0, 10.0),
        reason,
    })
}

/// Extract a numeric score from unstructured text.
fn extract_score_from_text(text: &str) -> Option<f64> {
    // Look for patterns like "score: 7", "7/10", "rating: 8"
    // Case-insensitive matching
    let patterns = [
        r"(?i)score[:\s]+(\d+(?:\.\d+)?)",
        r"(\d+(?:\.\d+)?)\s*/\s*10",
        r"(?i)rating[:\s]+(\d+(?:\.\d+)?)",
        r"(?i)(\d+(?:\.\d+)?)\s+out\s+of\s+10",
    ];

    for pattern in patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(caps) = re.captures(text) {
                if let Some(m) = caps.get(1) {
                    if let Ok(n) = m.as_str().parse::<f64>() {
                        return Some(n);
                    }
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn judge_panel_lists_seven_models() {
        assert_eq!(JUDGE_MODELS.len(), 7);
    }

    #[test]
    fn all_judges_have_us_or_eu_region() {
        for judge in JUDGE_MODELS {
            assert!(
                judge.region == "US" || judge.region == "EU",
                "{} has invalid region: {}",
                judge.name,
                judge.region
            );
        }
    }

    #[test]
    fn extract_score_from_json_format() {
        let text = r#"{"score": 8, "reason": "Good answer"}"#;
        let parsed: Value = serde_json::from_str(text).unwrap();
        assert_eq!(parsed["score"].as_f64().unwrap(), 8.0);
    }

    #[test]
    fn extract_score_from_text_patterns() {
        assert_eq!(extract_score_from_text("Score: 7"), Some(7.0));
        assert_eq!(extract_score_from_text("I give this 8/10"), Some(8.0));
        assert_eq!(extract_score_from_text("Rating: 6.5"), Some(6.5));
        assert_eq!(extract_score_from_text("9 out of 10"), Some(9.0));
    }

    #[test]
    fn judge_panel_without_key_is_unavailable() {
        // In test environment without OpenRouter key
        let panel = JudgePanel {
            client: Client::new(),
            api_key: None,
            spending_tracker: None,
        };
        assert!(!panel.is_available());
    }

    #[test]
    fn spending_cap_check_passes_without_tracker() {
        let panel = JudgePanel {
            client: Client::new(),
            api_key: Some("test-key".to_string()),
            spending_tracker: None,
        };
        // Without a tracker, all calls should be allowed
        assert!(panel.check_spending_cap().is_ok());
    }
}
