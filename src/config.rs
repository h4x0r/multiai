//! Configuration management for FreeTier.
//!
//! Loads settings from `~/.config/freetier/config.toml` with environment overrides.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Main configuration structure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
fn default_port() -> u16 { 8080 }
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

impl Default for Config {
    fn default() -> Self {
        Self {
            gateway: GatewayConfig::default(),
            api_keys: ApiKeysConfig::default(),
            logging: LoggingConfig::default(),
            inspector: InspectorConfig::default(),
            app: AppConfig::default(),
        }
    }
}

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

        assert_eq!(config.gateway.port, 8080);
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
        // Clean up any leftover env vars from parallel tests
        std::env::remove_var("OPENROUTER_API_KEY");

        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.toml");

        fs::write(&config_path, r#"
[api_keys]
openrouter = "file-key"
"#).unwrap();

        // Load without env override first
        let config_from_file = Config::load_from(config_path.clone()).unwrap();
        assert_eq!(config_from_file.api_keys.openrouter, Some("file-key".to_string()));

        // Now set env and verify it overrides
        std::env::set_var("OPENROUTER_API_KEY", "env-key");
        let config = Config::load_from(config_path).unwrap().with_env_overrides();

        assert_eq!(config.api_keys.openrouter, Some("env-key".to_string()));

        std::env::remove_var("OPENROUTER_API_KEY");
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
}
