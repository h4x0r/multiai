//! Wireshark-style traffic inspection and logging.
//!
//! Features:
//! - Full request/response capture
//! - Timing metrics (TTFT, TPS, latency)
//! - HAR-like export format
//! - Streaming-compatible

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use std::time::Instant;
use uuid::Uuid;

/// A captured HTTP transaction (request + response).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedTransaction {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub request: CapturedRequest,
    pub response: Option<CapturedResponse>,
    pub timing: TimingMetrics,
    #[serde(skip)]
    pub(crate) start_time: Option<Instant>,
}

/// Captured request data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<serde_json::Value>,
}

/// Captured response data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Option<serde_json::Value>,
}

/// Timing metrics for performance analysis.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TimingMetrics {
    /// Total request duration in milliseconds.
    pub total_ms: u64,
    /// Time to first byte/token in milliseconds.
    pub ttfb_ms: Option<u64>,
    /// Tokens per second (for streaming responses).
    pub tokens_per_sec: Option<f64>,
    /// Prompt tokens used.
    pub prompt_tokens: Option<u32>,
    /// Completion tokens used.
    pub completion_tokens: Option<u32>,
}

impl TimingMetrics {
    /// Calculate tokens per second from completion tokens and timing.
    pub fn calculate_tps(&self) -> Option<f64> {
        let completion_tokens = self.completion_tokens? as f64;
        let total_ms = self.total_ms as f64;
        let ttfb_ms = self.ttfb_ms.unwrap_or(0) as f64;

        // Time spent generating tokens (excluding TTFB)
        let generation_ms = total_ms - ttfb_ms;
        if generation_ms <= 0.0 {
            return None;
        }

        // Convert to seconds and calculate TPS
        let generation_secs = generation_ms / 1000.0;
        Some(completion_tokens / generation_secs)
    }
}

/// Traffic inspector for capturing and analyzing HTTP transactions.
#[derive(Clone)]
pub struct TrafficInspector {
    transactions: Arc<RwLock<Vec<CapturedTransaction>>>,
    enabled: Arc<RwLock<bool>>,
}

impl TrafficInspector {
    pub fn new() -> Self {
        Self {
            transactions: Arc::new(RwLock::new(Vec::new())),
            enabled: Arc::new(RwLock::new(true)),
        }
    }

    /// Check if inspector is enabled.
    pub fn is_enabled(&self) -> bool {
        *self.enabled.read().unwrap()
    }

    /// Enable or disable the inspector.
    pub fn set_enabled(&self, enabled: bool) {
        *self.enabled.write().unwrap() = enabled;
    }

    /// Start a new transaction with a request.
    pub fn start_transaction(&self, request: CapturedRequest) -> CapturedTransaction {
        CapturedTransaction {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            request,
            response: None,
            timing: TimingMetrics::default(),
            start_time: Some(Instant::now()),
        }
    }

    /// Complete a transaction with a response.
    pub fn complete_transaction(
        &self,
        transaction: &mut CapturedTransaction,
        response: CapturedResponse,
    ) {
        if let Some(start) = transaction.start_time {
            transaction.timing.total_ms = start.elapsed().as_millis() as u64;
        }
        transaction.response = Some(response);
    }

    /// Record time to first byte/token.
    pub fn record_ttfb(&self, transaction: &mut CapturedTransaction) {
        if let Some(start) = transaction.start_time {
            transaction.timing.ttfb_ms = Some(start.elapsed().as_millis() as u64);
        }
    }

    /// Record token usage.
    pub fn record_tokens(
        &self,
        transaction: &mut CapturedTransaction,
        prompt_tokens: u32,
        completion_tokens: u32,
    ) {
        transaction.timing.prompt_tokens = Some(prompt_tokens);
        transaction.timing.completion_tokens = Some(completion_tokens);
        transaction.timing.tokens_per_sec = transaction.timing.calculate_tps();
    }

    /// Store a completed transaction.
    pub fn store(&self, transaction: CapturedTransaction) {
        if self.is_enabled() {
            self.transactions.write().unwrap().push(transaction);
        }
    }

    /// Get all stored transactions.
    pub fn get_all(&self) -> Vec<CapturedTransaction> {
        self.transactions.read().unwrap().clone()
    }

    /// Clear all stored transactions.
    pub fn clear(&self) {
        self.transactions.write().unwrap().clear();
    }

    /// Export transactions in HAR (HTTP Archive) format.
    pub fn export_har(&self) -> serde_json::Value {
        let transactions = self.get_all();

        let entries: Vec<serde_json::Value> = transactions
            .iter()
            .map(|tx| {
                serde_json::json!({
                    "startedDateTime": tx.timestamp.to_rfc3339(),
                    "time": tx.timing.total_ms,
                    "request": {
                        "method": tx.request.method,
                        "url": tx.request.url,
                        "headers": tx.request.headers.iter().map(|(k, v)| {
                            serde_json::json!({"name": k, "value": v})
                        }).collect::<Vec<_>>(),
                        "postData": tx.request.body.as_ref().map(|b| {
                            serde_json::json!({
                                "mimeType": "application/json",
                                "text": b.to_string()
                            })
                        }),
                    },
                    "response": tx.response.as_ref().map(|r| {
                        serde_json::json!({
                            "status": r.status,
                            "headers": r.headers.iter().map(|(k, v)| {
                                serde_json::json!({"name": k, "value": v})
                            }).collect::<Vec<_>>(),
                            "content": r.body.as_ref().map(|b| {
                                serde_json::json!({
                                    "mimeType": "application/json",
                                    "text": b.to_string()
                                })
                            }),
                        })
                    }),
                    "timings": {
                        "total": tx.timing.total_ms,
                        "ttfb": tx.timing.ttfb_ms,
                    },
                    "_llmMetrics": {
                        "promptTokens": tx.timing.prompt_tokens,
                        "completionTokens": tx.timing.completion_tokens,
                        "tokensPerSecond": tx.timing.tokens_per_sec,
                    }
                })
            })
            .collect();

        serde_json::json!({
            "log": {
                "version": "1.2",
                "creator": {
                    "name": "free-router",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "entries": entries,
            }
        })
    }
}

impl Default for TrafficInspector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_transaction_with_request() {
        let inspector = TrafficInspector::new();

        let tx = inspector.start_transaction(CapturedRequest {
            method: "POST".to_string(),
            url: "https://openrouter.ai/api/v1/chat/completions".to_string(),
            headers: vec![("Content-Type".to_string(), "application/json".to_string())],
            body: Some(serde_json::json!({"model": "test", "messages": []})),
        });

        assert!(!tx.id.is_empty());
        assert_eq!(tx.request.method, "POST");
        assert!(tx.response.is_none());
    }

    #[test]
    fn records_response_and_timing() {
        let inspector = TrafficInspector::new();

        let mut tx = inspector.start_transaction(CapturedRequest {
            method: "POST".to_string(),
            url: "https://example.com".to_string(),
            headers: vec![],
            body: None,
        });

        // Simulate some delay
        std::thread::sleep(std::time::Duration::from_millis(10));

        inspector.complete_transaction(
            &mut tx,
            CapturedResponse {
                status: 200,
                headers: vec![],
                body: Some(serde_json::json!({"choices": []})),
            },
        );

        assert!(tx.response.is_some());
        assert!(tx.timing.total_ms >= 10);
    }

    #[test]
    fn stores_transactions_for_export() {
        let inspector = TrafficInspector::new();

        let tx = inspector.start_transaction(CapturedRequest {
            method: "GET".to_string(),
            url: "https://example.com".to_string(),
            headers: vec![],
            body: None,
        });

        inspector.store(tx);

        let all = inspector.get_all();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn exports_to_har_format() {
        let inspector = TrafficInspector::new();

        let mut tx = inspector.start_transaction(CapturedRequest {
            method: "POST".to_string(),
            url: "https://example.com/api".to_string(),
            headers: vec![("Authorization".to_string(), "Bearer xxx".to_string())],
            body: Some(serde_json::json!({"test": true})),
        });

        inspector.complete_transaction(
            &mut tx,
            CapturedResponse {
                status: 200,
                headers: vec![],
                body: Some(serde_json::json!({"result": "ok"})),
            },
        );

        inspector.store(tx);

        let har = inspector.export_har();

        assert_eq!(har["log"]["version"], "1.2");
        assert!(har["log"]["entries"].is_array());
        assert_eq!(har["log"]["entries"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn clears_stored_transactions() {
        let inspector = TrafficInspector::new();

        let tx = inspector.start_transaction(CapturedRequest {
            method: "GET".to_string(),
            url: "https://example.com".to_string(),
            headers: vec![],
            body: None,
        });

        inspector.store(tx);
        assert_eq!(inspector.get_all().len(), 1);

        inspector.clear();
        assert_eq!(inspector.get_all().len(), 0);
    }

    #[test]
    fn calculates_tokens_per_second() {
        let timing = TimingMetrics {
            total_ms: 2000,
            ttfb_ms: Some(200),
            tokens_per_sec: None,
            prompt_tokens: Some(100),
            completion_tokens: Some(50),
        };

        // 50 completion tokens in 1.8 seconds = ~27.8 TPS
        let tps = timing.calculate_tps();
        assert!(tps.is_some());
        let tps = tps.unwrap();
        assert!(tps > 20.0 && tps < 35.0);
    }
}
