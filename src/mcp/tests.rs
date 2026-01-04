//! Tests for MCP server functionality.

use super::*;

#[test]
fn mcp_config_default_has_mcp_disabled() {
    let config = McpConfig::default();
    assert!(!config.enabled);
}

#[test]
fn mcp_config_can_enable_mcp_mode() {
    let config = McpConfig { enabled: true };
    assert!(config.enabled);
}

#[test]
fn mcp_server_can_be_created() {
    let server = McpServer::new();
    assert_eq!(server.name(), "multiai");
}

#[test]
fn mcp_server_has_compare_models_tool() {
    let server = McpServer::new();
    let tools = server.list_tools();
    assert!(tools.iter().any(|t| t.name == "compare_models"));
}

#[test]
fn mcp_server_handles_initialize_request() {
    let server = McpServer::new();
    let request = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}"#;

    let response = server.handle_request(request).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

    assert_eq!(parsed["jsonrpc"], "2.0");
    assert_eq!(parsed["id"], 1);
    assert!(parsed["result"]["protocolVersion"].is_string());
    assert!(parsed["result"]["serverInfo"]["name"].is_string());
}

#[test]
fn mcp_server_handles_tools_list_request() {
    let server = McpServer::new();
    let request = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#;

    let response = server.handle_request(request).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

    assert_eq!(parsed["jsonrpc"], "2.0");
    assert_eq!(parsed["id"], 2);
    let tools = parsed["result"]["tools"].as_array().unwrap();
    assert!(!tools.is_empty());
    assert!(tools.iter().any(|t| t["name"] == "compare_models"));
}

#[test]
fn mcp_server_handles_tools_call_compare_models() {
    let server = McpServer::new();
    let request = r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"compare_models","arguments":{"prompt":"What is 2+2?"}}}"#;

    let response = server.handle_request(request).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

    assert_eq!(parsed["jsonrpc"], "2.0");
    assert_eq!(parsed["id"], 3);

    // In test environment, there may be no models available
    // Check for either success (content array) or expected error
    if let Some(content) = parsed["result"]["content"].as_array() {
        assert!(!content.is_empty());
        assert_eq!(content[0]["type"], "text");
    } else {
        // No models available error is expected in test environment
        assert!(parsed["error"].is_object());
        let error_msg = parsed["error"]["message"].as_str().unwrap_or("");
        assert!(
            error_msg.contains("No free models")
                || error_msg.contains("No matching models")
                || error_msg.contains("All model requests failed")
        );
    }
}

#[test]
fn mcp_server_returns_error_for_unknown_tool() {
    let server = McpServer::new();
    let request = r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"unknown_tool","arguments":{}}}"#;

    let response = server.handle_request(request).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

    assert_eq!(parsed["jsonrpc"], "2.0");
    assert_eq!(parsed["id"], 4);
    assert!(parsed["error"].is_object());
}
