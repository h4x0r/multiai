//! Terminal logging with configurable verbosity levels.
//!
//! Supports three verbosity levels:
//! - Minimal: One-liner nginx-style
//! - Compact: Multi-line httpie-style
//! - Verbose: Full mitmproxy-style

use crate::config::LogVerbosity;
use crate::inspector::{CapturedRequest, CapturedTransaction, TimingMetrics};
use std::io::Write;

/// Extract model name from request body.
fn extract_model(body: &Option<serde_json::Value>) -> &str {
    body.as_ref()
        .and_then(|b| b.get("model"))
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
}

/// Format duration in human-readable form.
fn format_duration(ms: u64) -> String {
    if ms >= 1000 {
        format!("{:.1}s", ms as f64 / 1000.0)
    } else {
        format!("{}ms", ms)
    }
}

/// Extract path from URL.
fn extract_path(url: &str) -> &str {
    url.find("://")
        .and_then(|i| url[i + 3..].find('/').map(|j| &url[i + 3 + j..]))
        .unwrap_or(url)
}

/// Format a transaction for terminal output.
pub fn format_transaction(tx: &CapturedTransaction, verbosity: &LogVerbosity) -> String {
    let model = extract_model(&tx.request.body);
    let path = extract_path(&tx.request.url);

    match verbosity {
        LogVerbosity::Minimal => format_minimal(tx, model, path),
        LogVerbosity::Compact => format_compact(tx, model, path),
        LogVerbosity::Verbose => format_verbose(tx, model, path),
    }
}

fn format_minimal(tx: &CapturedTransaction, model: &str, path: &str) -> String {
    let status = tx.response.as_ref().map(|r| r.status).unwrap_or(0);
    let duration = format_duration(tx.timing.total_ms);
    let tps = tx.timing.tokens_per_sec
        .map(|t| format!(" [{:.0} tok/s]", t))
        .unwrap_or_default();

    format!(
        "{} {} {} {} {}{}",
        tx.request.method, path, status, duration, model, tps
    )
}

fn format_compact(tx: &CapturedTransaction, model: &str, path: &str) -> String {
    let request_line = format!("→ {} {} [{}]", tx.request.method, path, model);

    let response_line = if let Some(ref resp) = tx.response {
        let duration = format_duration(tx.timing.total_ms);
        let ttfb = tx.timing.ttfb_ms
            .map(|t| format!(", TTFB: {}ms", t))
            .unwrap_or_default();
        let tps = tx.timing.tokens_per_sec
            .map(|t| format!(", {:.0} tok/s", t))
            .unwrap_or_default();
        let tokens = match (tx.timing.prompt_tokens, tx.timing.completion_tokens) {
            (Some(p), Some(c)) => format!(", {} tokens", p + c),
            _ => String::new(),
        };

        format!("← {} OK ({}{}{}{})", resp.status, duration, ttfb, tps, tokens)
    } else {
        "← pending...".to_string()
    };

    format!("{}\n{}", request_line, response_line)
}

fn format_verbose(tx: &CapturedTransaction, model: &str, path: &str) -> String {
    let separator = "────────────────────────────────────────";
    let status = tx.response.as_ref().map(|r| r.status).unwrap_or(0);
    let status_text = if (200..300).contains(&status) { "OK" } else { "ERROR" };

    let duration = format_duration(tx.timing.total_ms);
    let ttfb = tx.timing.ttfb_ms
        .map(|t| format!("{}ms", t))
        .unwrap_or_else(|| "-".to_string());
    let tps = tx.timing.tokens_per_sec
        .map(|t| format!("{:.0} tok/s", t))
        .unwrap_or_else(|| "-".to_string());

    let prompt = tx.timing.prompt_tokens
        .map(|t| t.to_string())
        .unwrap_or_else(|| "-".to_string());
    let completion = tx.timing.completion_tokens
        .map(|t| t.to_string())
        .unwrap_or_else(|| "-".to_string());

    format!(
        "{separator}\n\
         {method} {path}\n\
         Model: {model}\n\
         Status: {status} {status_text}\n\
         Timing: {duration} total, TTFB: {ttfb}, {tps}\n\
         Tokens: {prompt} prompt, {completion} completion\n\
         {separator}",
        separator = separator,
        method = tx.request.method,
        path = path,
        model = model,
        status = status,
        status_text = status_text,
        duration = duration,
        ttfb = ttfb,
        tps = tps,
        prompt = prompt,
        completion = completion
    )
}

/// Format request start (for streaming).
pub fn format_request_start(req: &CapturedRequest, model: &str, verbosity: &LogVerbosity) -> String {
    let path = extract_path(&req.url);

    match verbosity {
        LogVerbosity::Minimal => format!("{} {} {}", req.method, path, model),
        LogVerbosity::Compact => format!("→ {} {} [{}]", req.method, path, model),
        LogVerbosity::Verbose => format!(
            "────────────────────────────────────────\n\
             {} {}\n\
             Model: {}",
            req.method, path, model
        ),
    }
}

/// Format response end (for streaming).
pub fn format_response_end(
    status: u16,
    timing: &TimingMetrics,
    verbosity: &LogVerbosity,
) -> String {
    let duration = format_duration(timing.total_ms);
    let tps = timing.tokens_per_sec
        .map(|t| format!("{:.0} tok/s", t))
        .unwrap_or_else(|| "-".to_string());

    match verbosity {
        LogVerbosity::Minimal => format!("{} {} [{}]", status, duration, tps),
        LogVerbosity::Compact => {
            let ttfb = timing.ttfb_ms
                .map(|t| format!(", TTFB: {}ms", t))
                .unwrap_or_default();
            format!("← {} OK ({}{})", status, duration, ttfb)
        }
        LogVerbosity::Verbose => {
            let ttfb = timing.ttfb_ms
                .map(|t| format!("{}ms", t))
                .unwrap_or_else(|| "-".to_string());
            format!(
                "Status: {} OK\n\
                 Timing: {} total, TTFB: {}, {}\n\
                 ────────────────────────────────────────",
                status, duration, ttfb, tps
            )
        }
    }
}

/// Log a transaction to the given writer.
pub fn log_transaction<W: Write>(
    writer: &mut W,
    tx: &CapturedTransaction,
    verbosity: &LogVerbosity,
) -> std::io::Result<()> {
    writeln!(writer, "{}", format_transaction(tx, verbosity))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inspector::CapturedResponse;
    use chrono::Utc;

    fn sample_transaction() -> CapturedTransaction {
        CapturedTransaction {
            id: "test-123".to_string(),
            timestamp: Utc::now(),
            request: CapturedRequest {
                method: "POST".to_string(),
                url: "http://localhost:8080/v1/chat/completions".to_string(),
                headers: vec![
                    ("Authorization".to_string(), "Bearer sk-test".to_string()),
                    ("Content-Type".to_string(), "application/json".to_string()),
                ],
                body: Some(serde_json::json!({
                    "model": "grok-code-fast-1",
                    "messages": [{"role": "user", "content": "Hello"}]
                })),
            },
            response: Some(CapturedResponse {
                status: 200,
                headers: vec![("Content-Type".to_string(), "application/json".to_string())],
                body: Some(serde_json::json!({"choices": []})),
            }),
            timing: TimingMetrics {
                total_ms: 1200,
                ttfb_ms: Some(150),
                tokens_per_sec: Some(45.2),
                prompt_tokens: Some(50),
                completion_tokens: Some(70),
            },
            start_time: None,
        }
    }

    // =========================================================================
    // RED: Tests written first - these should FAIL initially
    // =========================================================================

    #[test]
    fn minimal_format_is_single_line() {
        let tx = sample_transaction();
        let output = format_transaction(&tx, &LogVerbosity::Minimal);

        // Should be a single line
        assert!(!output.contains('\n'), "Minimal should be single line");

        // Should contain key info
        assert!(output.contains("POST"));
        assert!(output.contains("/v1/chat/completions"));
        assert!(output.contains("200"));
        assert!(output.contains("1.2s") || output.contains("1200"));
    }

    #[test]
    fn minimal_format_includes_model_and_tps() {
        let tx = sample_transaction();
        let output = format_transaction(&tx, &LogVerbosity::Minimal);

        assert!(output.contains("grok-code-fast-1") || output.contains("grok"));
        assert!(output.contains("45") || output.contains("tok/s"));
    }

    #[test]
    fn compact_format_is_two_lines() {
        let tx = sample_transaction();
        let output = format_transaction(&tx, &LogVerbosity::Compact);

        let lines: Vec<&str> = output.lines().collect();
        assert_eq!(lines.len(), 2, "Compact should be two lines");

        // First line: request arrow
        assert!(lines[0].contains("→") || lines[0].contains("->"));
        assert!(lines[0].contains("POST"));

        // Second line: response arrow
        assert!(lines[1].contains("←") || lines[1].contains("<-"));
        assert!(lines[1].contains("200"));
    }

    #[test]
    fn compact_format_includes_timing_details() {
        let tx = sample_transaction();
        let output = format_transaction(&tx, &LogVerbosity::Compact);

        assert!(output.contains("1.2s") || output.contains("1200ms"));
        assert!(output.contains("TTFB") || output.contains("150"));
        assert!(output.contains("tok/s") || output.contains("45"));
    }

    #[test]
    fn verbose_format_has_separator_lines() {
        let tx = sample_transaction();
        let output = format_transaction(&tx, &LogVerbosity::Verbose);

        // Should have horizontal separators
        assert!(output.contains("───") || output.contains("---") || output.contains("==="));
    }

    #[test]
    fn verbose_format_includes_all_details() {
        let tx = sample_transaction();
        let output = format_transaction(&tx, &LogVerbosity::Verbose);

        // Method and URL
        assert!(output.contains("POST"));
        assert!(output.contains("/v1/chat/completions"));

        // Model
        assert!(output.contains("grok-code-fast-1"));

        // Status
        assert!(output.contains("200"));

        // Timing breakdown
        assert!(output.contains("1.2s") || output.contains("1200"));
        assert!(output.contains("TTFB") || output.contains("150"));

        // Token counts
        assert!(output.contains("50") || output.contains("prompt"));
        assert!(output.contains("70") || output.contains("completion"));
    }

    #[test]
    fn handles_missing_response() {
        let mut tx = sample_transaction();
        tx.response = None;

        let output = format_transaction(&tx, &LogVerbosity::Compact);

        // Should not panic, should indicate pending/no response
        assert!(output.contains("pending") || output.contains("...") || output.contains("→"));
    }

    #[test]
    fn request_start_format_shows_outgoing() {
        let req = CapturedRequest {
            method: "POST".to_string(),
            url: "http://localhost:8080/v1/chat/completions".to_string(),
            headers: vec![],
            body: None,
        };

        let output = format_request_start(&req, "grok-code-fast-1", &LogVerbosity::Compact);

        assert!(output.contains("→") || output.contains("->"));
        assert!(output.contains("POST"));
        assert!(output.contains("grok-code-fast-1"));
    }

    #[test]
    fn response_end_format_shows_incoming() {
        let timing = TimingMetrics {
            total_ms: 1500,
            ttfb_ms: Some(200),
            tokens_per_sec: Some(30.0),
            prompt_tokens: Some(100),
            completion_tokens: Some(50),
        };

        let output = format_response_end(200, &timing, &LogVerbosity::Compact);

        assert!(output.contains("←") || output.contains("<-"));
        assert!(output.contains("200"));
        assert!(output.contains("1.5s") || output.contains("1500"));
    }
}
