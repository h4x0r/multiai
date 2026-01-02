//! FreeTier - High-performance local API gateway for free LLMs.
//!
//! Features:
//! - Real-time free model discovery from OpenRouter + OpenCode Zen
//! - Wireshark-style traffic inspection and logging
//! - Key rotation and health monitoring
//! - OpenAI-compatible API
//! - Web-based chat UI with document support

pub mod api;
pub mod chat;
pub mod chat_api;
pub mod config;
pub mod document;
pub mod export;
pub mod inspector;
pub mod logger;
pub mod scanner;
