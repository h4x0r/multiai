//! Configuration management for MultiAI.
//!
//! Loads settings from `~/.config/multiai/config.toml` with environment overrides.

use crate::scanner::Source;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// Spending limit constants (single source of truth)
pub const DEFAULT_DAILY_CAP: f64 = 5.00;
pub const DEFAULT_MONTHLY_CAP: f64 = 50.00;
pub const DEFAULT_WARN_PERCENT: u8 = 80;

/// Main configuration structure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(Default)]
pub struct Config {
    #[serde(default)]
    pub gateway: GatewayConfig,
    #[serde(default)]
    pub api_keys: ApiKeysConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
    #[serde(default)]
    pub inspector: InspectorConfig,
    #[serde(default)]
    pub app: AppConfig,
    #[serde(default)]
    pub spending: SpendingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpendingConfig {
    #[serde(default = "default_daily_cap")]
    pub daily_cap: f64,
    #[serde(default = "default_monthly_cap")]
    pub monthly_cap: f64,
    #[serde(default = "default_warn_percent")]
    pub warn_at_percent: u8,
}

fn default_daily_cap() -> f64 {
    DEFAULT_DAILY_CAP
}
fn default_monthly_cap() -> f64 {
    DEFAULT_MONTHLY_CAP
}
fn default_warn_percent() -> u8 {
    DEFAULT_WARN_PERCENT
}

impl Default for SpendingConfig {
    fn default() -> Self {
        Self {
            daily_cap: DEFAULT_DAILY_CAP,
            monthly_cap: DEFAULT_MONTHLY_CAP,
            warn_at_percent: DEFAULT_WARN_PERCENT,
        }
    }
}

impl SpendingConfig {
    /// Load from environment variables, falling back to defaults.
    pub fn from_env() -> Self {
        Self {
            daily_cap: std::env::var("MULTIAI_DAILY_CAP")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_DAILY_CAP),
            monthly_cap: std::env::var("MULTIAI_MONTHLY_CAP")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_MONTHLY_CAP),
            warn_at_percent: std::env::var("MULTIAI_WARN_AT_PERCENT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_WARN_PERCENT),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GatewayConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ApiKeysConfig {
    #[serde(default)]
    pub openrouter: Option<String>,
    #[serde(default)]
    pub opencode_zen: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LoggingConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_log_folder")]
    pub folder: PathBuf,
    #[serde(default = "default_format")]
    pub format: LogFormat,
    #[serde(default = "default_retention_days")]
    pub retention_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    Json,
    Har,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InspectorConfig {
    #[serde(default = "default_max_transactions")]
    pub max_transactions: usize,
    #[serde(default)]
    pub clear_on_restart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppConfig {
    #[serde(default)]
    pub start_at_login: bool,
    #[serde(default = "default_verbosity")]
    pub log_verbosity: LogVerbosity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LogVerbosity {
    Minimal,
    #[default]
    Compact,
    Verbose,
}

// Default value functions
fn default_port() -> u16 { 11434 }
fn default_true() -> bool { true }
fn default_log_folder() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("freetier")
        .join("logs")
}
fn default_format() -> LogFormat { LogFormat::Har }
fn default_retention_days() -> u32 { 30 }
fn default_max_transactions() -> usize { 1000 }
fn default_verbosity() -> LogVerbosity { LogVerbosity::Compact }


impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            auto_start: false,
        }
    }
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            enabled: default_true(),
            folder: default_log_folder(),
            format: default_format(),
            retention_days: default_retention_days(),
        }
    }
}

impl Default for InspectorConfig {
    fn default() -> Self {
        Self {
            max_transactions: default_max_transactions(),
            clear_on_restart: false,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            start_at_login: false,
            log_verbosity: default_verbosity(),
        }
    }
}

impl Config {
    /// Get the default config file path.
    pub fn default_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("freetier")
            .join("config.toml")
    }

    /// Load config from file, falling back to defaults.
    pub fn load() -> Result<Self, ConfigError> {
        Self::load_from(Self::default_path())
    }

    /// Load config with environment overrides applied (convenience method).
    pub fn load_with_env() -> Self {
        Self::load().unwrap_or_default().with_env_overrides()
    }

    /// Load config from a specific path.
    pub fn load_from(path: PathBuf) -> Result<Self, ConfigError> {
        match std::fs::read_to_string(&path) {
            Ok(content) => toml::from_str(&content).map_err(ConfigError::Parse),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(ConfigError::Io(e)),
        }
    }

    /// Apply environment variable overrides.
    pub fn with_env_overrides(mut self) -> Self {
        if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
            self.api_keys.openrouter = Some(key);
        }
        if let Ok(key) = std::env::var("OPENCODE_ZEN_API_KEY") {
            self.api_keys.opencode_zen = Some(key);
        }
        // Spending caps
        if let Ok(val) = std::env::var("MULTIAI_DAILY_CAP") {
            if let Ok(cap) = val.parse() {
                self.spending.daily_cap = cap;
            }
        }
        if let Ok(val) = std::env::var("MULTIAI_MONTHLY_CAP") {
            if let Ok(cap) = val.parse() {
                self.spending.monthly_cap = cap;
            }
        }
        if let Ok(val) = std::env::var("MULTIAI_WARN_AT_PERCENT") {
            if let Ok(pct) = val.parse() {
                self.spending.warn_at_percent = pct;
            }
        }
        self
    }

    /// Save config to file.
    pub fn save(&self) -> Result<(), ConfigError> {
        self.save_to(Self::default_path())
    }

    /// Save config to a specific path.
    pub fn save_to(&self, path: PathBuf) -> Result<(), ConfigError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(ConfigError::Io)?;
        }
        let content = toml::to_string_pretty(self).map_err(ConfigError::Serialize)?;
        std::fs::write(&path, content).map_err(ConfigError::Io)
    }

    /// Get API key for a given source.
    pub fn get_api_key(&self, source: &Source) -> Option<String> {
        match source {
            Source::OpenRouter => self.api_keys.openrouter.clone(),
            Source::OpenCodeZen => self.api_keys.opencode_zen.clone(),
            Source::Ollama => None,
        }
    }
}

#[derive(Debug)]
pub enum ConfigError {
    Io(std::io::Error),
    Parse(toml::de::Error),
    Serialize(toml::ser::Error),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Io(e) => write!(f, "IO error: {}", e),
            ConfigError::Parse(e) => write!(f, "Parse error: {}", e),
            ConfigError::Serialize(e) => write!(f, "Serialize error: {}", e),
        }
    }
}

impl std::error::Error for ConfigError {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // =========================================================================
    // RED: Tests written first - these should FAIL initially
    // =========================================================================

    #[test]
    fn loads_config_from_toml_file() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.toml");

        fs::write(&config_path, r#"
[gateway]
port = 9090
auto_start = true

[api_keys]
openrouter = "sk-or-test-key"
"#).unwrap();

        let config = Config::load_from(config_path).unwrap();

        assert_eq!(config.gateway.port, 9090);
        assert_eq!(config.gateway.auto_start, true);
        assert_eq!(config.api_keys.openrouter, Some("sk-or-test-key".to_string()));
    }

    #[test]
    fn returns_defaults_when_file_missing() {
        let config = Config::load_from(PathBuf::from("/nonexistent/path/config.toml")).unwrap();

        assert_eq!(config.gateway.port, 11434); // Ollama-compatible default
        assert_eq!(config.gateway.auto_start, false);
        assert_eq!(config.logging.enabled, true);
        assert_eq!(config.inspector.max_transactions, 1000);
    }

    #[test]
    fn overrides_api_keys_from_environment() {
        std::env::set_var("OPENROUTER_API_KEY", "env-openrouter-key");
        std::env::set_var("OPENCODE_ZEN_API_KEY", "env-zen-key");

        let config = Config::default().with_env_overrides();

        assert_eq!(config.api_keys.openrouter, Some("env-openrouter-key".to_string()));
        assert_eq!(config.api_keys.opencode_zen, Some("env-zen-key".to_string()));

        // Cleanup
        std::env::remove_var("OPENROUTER_API_KEY");
        std::env::remove_var("OPENCODE_ZEN_API_KEY");
    }

    #[test]
    fn env_overrides_take_precedence_over_file() {
        // Use spending cap env var (less likely to conflict with other tests)
        std::env::remove_var("MULTIAI_MONTHLY_CAP");

        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.toml");

        fs::write(&config_path, r#"
[spending]
monthly_cap = 100.0
"#).unwrap();

        // Load without env override first
        let config_from_file = Config::load_from(config_path.clone()).unwrap();
        assert_eq!(config_from_file.spending.monthly_cap, 100.0);

        // Now set env and verify it overrides
        std::env::set_var("MULTIAI_MONTHLY_CAP", "200.0");
        let config = Config::load_from(config_path).unwrap().with_env_overrides();

        assert_eq!(config.spending.monthly_cap, 200.0);

        std::env::remove_var("MULTIAI_MONTHLY_CAP");
    }

    #[test]
    fn saves_config_to_toml_file() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.toml");

        let config = Config {
            gateway: GatewayConfig { port: 3000, auto_start: true },
            ..Config::default()
        };

        config.save_to(config_path.clone()).unwrap();

        let loaded = Config::load_from(config_path).unwrap();
        assert_eq!(loaded.gateway.port, 3000);
        assert_eq!(loaded.gateway.auto_start, true);
    }

    #[test]
    fn creates_parent_directories_when_saving() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("nested").join("deep").join("config.toml");

        let config = Config::default();
        config.save_to(config_path.clone()).unwrap();

        assert!(config_path.exists());
    }

    #[test]
    fn parses_all_log_verbosity_levels() {
        let dir = tempfile::tempdir().unwrap();

        for (value, expected) in [
            ("minimal", LogVerbosity::Minimal),
            ("compact", LogVerbosity::Compact),
            ("verbose", LogVerbosity::Verbose),
        ] {
            let config_path = dir.path().join(format!("config_{}.toml", value));
            fs::write(&config_path, format!(r#"
[app]
log_verbosity = "{}"
"#, value)).unwrap();

            let config = Config::load_from(config_path).unwrap();
            assert_eq!(config.app.log_verbosity, expected);
        }
    }

    #[test]
    fn parses_all_log_formats() {
        let dir = tempfile::tempdir().unwrap();

        for (value, expected) in [
            ("json", LogFormat::Json),
            ("har", LogFormat::Har),
            ("both", LogFormat::Both),
        ] {
            let config_path = dir.path().join(format!("config_{}.toml", value));
            fs::write(&config_path, format!(r#"
[logging]
format = "{}"
"#, value)).unwrap();

            let config = Config::load_from(config_path).unwrap();
            assert_eq!(config.logging.format, expected);
        }
    }

    #[test]
    fn get_api_key_returns_openrouter_key() {
        use crate::scanner::Source;

        let config = Config {
            api_keys: ApiKeysConfig {
                openrouter: Some("sk-or-test".to_string()),
                opencode_zen: None,
            },
            ..Config::default()
        };

        assert_eq!(config.get_api_key(&Source::OpenRouter), Some("sk-or-test".to_string()));
    }

    #[test]
    fn get_api_key_returns_opencode_zen_key() {
        use crate::scanner::Source;

        let config = Config {
            api_keys: ApiKeysConfig {
                openrouter: None,
                opencode_zen: Some("zen-key".to_string()),
            },
            ..Config::default()
        };

        assert_eq!(config.get_api_key(&Source::OpenCodeZen), Some("zen-key".to_string()));
    }

    #[test]
    fn get_api_key_returns_none_for_ollama() {
        use crate::scanner::Source;

        let config = Config {
            api_keys: ApiKeysConfig {
                openrouter: Some("key".to_string()),
                opencode_zen: Some("key".to_string()),
            },
            ..Config::default()
        };

        assert_eq!(config.get_api_key(&Source::Ollama), None);
    }

    #[test]
    fn load_with_env_applies_spending_overrides() {
        // Test with spending cap env var (less likely to conflict with other tests)
        std::env::set_var("MULTIAI_DAILY_CAP", "99.99");

        let config = Config::load_with_env();

        assert_eq!(config.spending.daily_cap, 99.99);

        std::env::remove_var("MULTIAI_DAILY_CAP");
    }
}
