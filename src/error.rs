//! Unified error handling for MultiAI.
//!
//! Provides a consistent error type across all modules.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use std::fmt;

/// Unified error type for MultiAI operations.
#[derive(Debug, Clone)]
pub enum MultiAiError {
    /// No free models available from any source.
    NoModelsAvailable,
    /// Requested model is not a free model.
    ModelNotFree(String),
    /// API key not configured for a source.
    ApiKeyMissing(String),
    /// Upstream API returned an error.
    UpstreamError(String),
    /// Failed to parse upstream response.
    ParseError(String),
    /// Daily or monthly spending cap exceeded.
    SpendingCapExceeded {
        cap_type: String,
        used: f64,
        cap: f64,
        message: String,
    },
    /// Configuration error.
    ConfigError(String),
    /// Internal error.
    Internal(String),
}

impl fmt::Display for MultiAiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoModelsAvailable => write!(f, "No free models available"),
            Self::ModelNotFree(model) => write!(f, "'{}' is not a free model", model),
            Self::ApiKeyMissing(source) => {
                write!(f, "No API key configured for {}", source)
            }
            Self::UpstreamError(msg) => write!(f, "Upstream error: {}", msg),
            Self::ParseError(msg) => write!(f, "Parse error: {}", msg),
            Self::SpendingCapExceeded { message, .. } => write!(f, "{}", message),
            Self::ConfigError(msg) => write!(f, "Configuration error: {}", msg),
            Self::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for MultiAiError {}

/// Error response structure for JSON serialization.
#[derive(Serialize)]
struct ErrorResponseBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    message: String,
    r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cap_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cap: Option<f64>,
}

impl MultiAiError {
    /// Get the HTTP status code for this error.
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::NoModelsAvailable => StatusCode::SERVICE_UNAVAILABLE,
            Self::ModelNotFree(_) => StatusCode::BAD_REQUEST,
            Self::ApiKeyMissing(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::UpstreamError(_) => StatusCode::BAD_GATEWAY,
            Self::ParseError(_) => StatusCode::BAD_GATEWAY,
            Self::SpendingCapExceeded { .. } => StatusCode::PAYMENT_REQUIRED,
            Self::ConfigError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// Get the error type string.
    pub fn error_type(&self) -> &'static str {
        match self {
            Self::NoModelsAvailable => "service_unavailable",
            Self::ModelNotFree(_) => "invalid_request",
            Self::ApiKeyMissing(_) => "configuration_error",
            Self::UpstreamError(_) => "upstream_error",
            Self::ParseError(_) => "upstream_error",
            Self::SpendingCapExceeded { .. } => "spending_cap_exceeded",
            Self::ConfigError(_) => "configuration_error",
            Self::Internal(_) => "internal_error",
        }
    }
}

impl IntoResponse for MultiAiError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let body = match &self {
            Self::SpendingCapExceeded {
                cap_type,
                used,
                cap,
                message,
            } => ErrorResponseBody {
                error: ErrorDetail {
                    message: message.clone(),
                    r#type: self.error_type().to_string(),
                    cap_type: Some(cap_type.clone()),
                    used: Some(*used),
                    cap: Some(*cap),
                },
            },
            _ => ErrorResponseBody {
                error: ErrorDetail {
                    message: self.to_string(),
                    r#type: self.error_type().to_string(),
                    cap_type: None,
                    used: None,
                    cap: None,
                },
            },
        };

        (status, Json(body)).into_response()
    }
}

// ============================================================================
// MCP-specific errors for JSON-RPC protocol
// ============================================================================

/// JSON-RPC error codes per specification.
#[derive(Debug, Clone, Copy, Serialize)]
pub enum JsonRpcErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,
}

/// MCP-specific error that maps to JSON-RPC error format.
#[derive(Debug, Clone, Serialize)]
pub struct McpError {
    pub code: JsonRpcErrorCode,
    pub message: String,
}

impl McpError {
    pub fn parse_error(msg: impl Into<String>) -> Self {
        Self {
            code: JsonRpcErrorCode::ParseError,
            message: msg.into(),
        }
    }

    pub fn invalid_params(msg: impl Into<String>) -> Self {
        Self {
            code: JsonRpcErrorCode::InvalidParams,
            message: msg.into(),
        }
    }

    pub fn method_not_found(method: &str) -> Self {
        Self {
            code: JsonRpcErrorCode::MethodNotFound,
            message: format!("Method not found: {}", method),
        }
    }

    pub fn internal_error(msg: impl Into<String>) -> Self {
        Self {
            code: JsonRpcErrorCode::InternalError,
            message: msg.into(),
        }
    }

    pub fn code(&self) -> i32 {
        self.code as i32
    }
}

impl fmt::Display for McpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for McpError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_parse_error_has_correct_code() {
        let err = McpError::parse_error("invalid json");
        assert_eq!(err.code(), -32700);
        assert!(err.message.contains("invalid json"));
    }

    #[test]
    fn mcp_invalid_params_has_correct_code() {
        let err = McpError::invalid_params("missing prompt");
        assert_eq!(err.code(), -32602);
    }

    #[test]
    fn mcp_method_not_found_has_correct_code() {
        let err = McpError::method_not_found("unknown_method");
        assert_eq!(err.code(), -32601);
        assert!(err.message.contains("unknown_method"));
    }

    #[test]
    fn mcp_internal_error_has_correct_code() {
        let err = McpError::internal_error("database failure");
        assert_eq!(err.code(), -32603);
    }

    #[test]
    fn no_models_available_has_correct_status() {
        let err = MultiAiError::NoModelsAvailable;
        assert_eq!(err.status_code(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(err.error_type(), "service_unavailable");
    }

    #[test]
    fn model_not_free_has_correct_status() {
        let err = MultiAiError::ModelNotFree("gpt-4".to_string());
        assert_eq!(err.status_code(), StatusCode::BAD_REQUEST);
        assert!(err.to_string().contains("gpt-4"));
    }

    #[test]
    fn api_key_missing_has_correct_status() {
        let err = MultiAiError::ApiKeyMissing("OpenRouter".to_string());
        assert_eq!(err.status_code(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(err.to_string().contains("OpenRouter"));
    }

    #[test]
    fn spending_cap_exceeded_includes_details() {
        let err = MultiAiError::SpendingCapExceeded {
            cap_type: "daily".to_string(),
            used: 4.50,
            cap: 5.00,
            message: "Daily cap of $5.00 reached".to_string(),
        };
        assert_eq!(err.status_code(), StatusCode::PAYMENT_REQUIRED);
        assert_eq!(err.error_type(), "spending_cap_exceeded");
    }

    #[test]
    fn upstream_error_has_correct_status() {
        let err = MultiAiError::UpstreamError("Connection refused".to_string());
        assert_eq!(err.status_code(), StatusCode::BAD_GATEWAY);
    }

    #[test]
    fn error_implements_display() {
        let err = MultiAiError::NoModelsAvailable;
        assert_eq!(format!("{}", err), "No free models available");
    }

    #[test]
    fn error_implements_std_error() {
        fn assert_error<T: std::error::Error>() {}
        assert_error::<MultiAiError>();
    }
}
