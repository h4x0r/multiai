//! Tests for FreeModelScanner.

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
