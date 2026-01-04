//! MCP (Model Context Protocol) server for MultiAI.
//!
//! Exposes a `compare_models` tool that allows Claude Desktop and other
//! MCP-compatible clients to compare multiple LLM responses.

mod compare;
mod judge;
pub mod spending;
#[cfg(test)]
mod tests;

use crate::error::McpError;
use compare::{CompareParams, ModelComparator};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use tokio::runtime::Runtime;

/// JSON-RPC request structure.
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[serde(rename = "jsonrpc")]
    _jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

/// JSON-RPC response structure.
#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

/// JSON-RPC error structure.
#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

/// Configuration for MCP mode.
#[derive(Debug, Clone, Default)]
pub struct McpConfig {
    /// Whether MCP mode is enabled (--mcp flag).
    pub enabled: bool,
}

/// MCP tool definition.
#[derive(Debug, Clone)]
pub struct ToolInfo {
    /// Tool name.
    pub name: String,
    /// Tool description.
    pub description: String,
}

/// MCP server that handles JSON-RPC requests via stdio.
#[derive(Debug)]
pub struct McpServer {
    name: String,
    tools: Vec<ToolInfo>,
}

impl McpServer {
    /// Create a new MCP server.
    pub fn new() -> Self {
        Self {
            name: "multiai".to_string(),
            tools: vec![ToolInfo {
                name: "compare_models".to_string(),
                description: "Compare responses from multiple LLM models".to_string(),
            }],
        }
    }

    /// Get the server name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// List available tools.
    pub fn list_tools(&self) -> &[ToolInfo] {
        &self.tools
    }

    /// Convert an McpError to a JSON-RPC error response.
    fn error_response(&self, id: Value, error: McpError) -> String {
        serde_json::to_string(&JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code: error.code(),
                message: error.message,
            }),
        })
        .unwrap_or_else(|_| r#"{"jsonrpc":"2.0","error":{"code":-32603,"message":"Serialization failed"}}"#.to_string())
    }

    /// Handle a JSON-RPC request and return a JSON-RPC response.
    pub fn handle_request(&self, request: &str) -> Result<String, McpError> {
        let req: JsonRpcRequest = serde_json::from_str(request)
            .map_err(|e| McpError::parse_error(format!("Parse error: {}", e)))?;

        let result = match req.method.as_str() {
            "initialize" => self.handle_initialize(),
            "tools/list" => self.handle_tools_list(),
            "tools/call" => {
                return self.handle_tools_call(req.id, &req.params);
            }
            method => {
                let error = McpError::method_not_found(method);
                return Ok(self.error_response(req.id, error));
            }
        };

        Ok(serde_json::to_string(&JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: req.id,
            result: Some(result),
            error: None,
        })
        .unwrap_or_else(|_| "{}".to_string()))
    }

    fn handle_initialize(&self) -> Value {
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": self.name,
                "version": env!("CARGO_PKG_VERSION")
            }
        })
    }

    fn handle_tools_list(&self) -> Value {
        let tools: Vec<Value> = self
            .tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "prompt": {
                                "type": "string",
                                "description": "The prompt to test across models"
                            },
                            "models": {
                                "type": "array",
                                "items": { "type": "string" },
                                "description": "Optional: specific models to compare"
                            },
                            "max_models": {
                                "type": "integer",
                                "description": "Optional: limit to N models"
                            },
                            "include_ranking": {
                                "type": "boolean",
                                "description": "Optional: run LLM judges (default: true)"
                            }
                        },
                        "required": ["prompt"]
                    }
                })
            })
            .collect();

        json!({ "tools": tools })
    }

    fn handle_tools_call(&self, id: Value, params: &Value) -> Result<String, McpError> {
        let tool_name = params["name"].as_str().unwrap_or("");
        let arguments = &params["arguments"];

        match tool_name {
            "compare_models" => {
                // Parse comparison parameters
                let compare_params: CompareParams =
                    serde_json::from_value(arguments.clone())
                        .map_err(|e| McpError::invalid_params(format!("Invalid parameters: {}", e)))?;

                // Run comparison using tokio runtime
                let rt = Runtime::new()
                    .map_err(|e| McpError::internal_error(format!("Failed to create runtime: {}", e)))?;
                let comparator = ModelComparator::new();

                let comparison_result = rt.block_on(async {
                    comparator.compare(compare_params).await
                });

                match comparison_result {
                    Ok(result) => {
                        // Format as MCP tool result with both JSON and markdown
                        let json_result = serde_json::to_string_pretty(&result)
                            .unwrap_or_else(|_| "{}".to_string());

                        let content = json!({
                            "content": [
                                {
                                    "type": "text",
                                    "text": result.markdown_summary
                                },
                                {
                                    "type": "text",
                                    "text": format!("\n<details>\n<summary>Full JSON Result</summary>\n\n```json\n{}\n```\n</details>", json_result)
                                }
                            ]
                        });

                        Ok(serde_json::to_string(&JsonRpcResponse {
                            jsonrpc: "2.0".to_string(),
                            id,
                            result: Some(content),
                            error: None,
                        })
                        .unwrap_or_else(|_| "{}".to_string()))
                    }
                    Err(e) => {
                        let error = McpError::internal_error(e);
                        Ok(self.error_response(id, error))
                    }
                }
            }
            _ => {
                let error = McpError::invalid_params(format!("Unknown tool: {}", tool_name));
                Ok(self.error_response(id, error))
            }
        }
    }
}

impl Default for McpServer {
    fn default() -> Self {
        Self::new()
    }
}

/// Run the MCP server using stdio transport.
/// Reads JSON-RPC requests from stdin, writes responses to stdout.
pub fn run_mcp() -> anyhow::Result<()> {
    let server = McpServer::new();
    server.run_stdio()
}

impl McpServer {
    /// Run the MCP server reading from stdin and writing to stdout.
    pub fn run_stdio(&self) -> anyhow::Result<()> {
        let stdin = std::io::stdin();
        let mut stdout = std::io::stdout();
        let reader = BufReader::new(stdin.lock());

        for line in reader.lines() {
            let line = line?;
            if line.is_empty() {
                continue;
            }

            match self.handle_request(&line) {
                Ok(response) => {
                    writeln!(stdout, "{}", response)?;
                    stdout.flush()?;
                }
                Err(e) => {
                    let error_response = json!({
                        "jsonrpc": "2.0",
                        "id": null,
                        "error": {
                            "code": -32700,
                            "message": e
                        }
                    });
                    writeln!(stdout, "{}", error_response)?;
                    stdout.flush()?;
                }
            }
        }

        Ok(())
    }
}
