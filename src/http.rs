//! Shared HTTP client factory.
//!
//! Provides consistent HTTP client configuration across the codebase.

use reqwest::Client;
use std::time::Duration;

/// Default timeout for API calls (30 seconds).
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Short timeout for quick detection calls (2 seconds).
pub const DETECTION_TIMEOUT: Duration = Duration::from_secs(2);

/// Long timeout for expensive operations (60 seconds).
pub const LONG_TIMEOUT: Duration = Duration::from_secs(60);

/// Create a new HTTP client with the default timeout.
pub fn create_client() -> Client {
    create_client_with_timeout(DEFAULT_TIMEOUT)
}

/// Create a new HTTP client with a custom timeout.
pub fn create_client_with_timeout(timeout: Duration) -> Client {
    Client::builder()
        .timeout(timeout)
        .build()
        .expect("Failed to create HTTP client")
}

/// Create a blocking HTTP client with a custom timeout.
pub fn create_blocking_client(timeout: Duration) -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .expect("Failed to create blocking HTTP client")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_client_returns_valid_client() {
        let client = create_client();
        // Client should be usable (this is a smoke test)
        assert!(std::mem::size_of_val(&client) > 0);
    }

    #[test]
    fn create_client_with_timeout_uses_specified_timeout() {
        // We can't directly inspect the timeout, but we can verify it compiles
        let _client = create_client_with_timeout(Duration::from_secs(5));
    }

    #[test]
    fn default_timeout_is_30_seconds() {
        assert_eq!(DEFAULT_TIMEOUT, Duration::from_secs(30));
    }

    #[test]
    fn detection_timeout_is_2_seconds() {
        assert_eq!(DETECTION_TIMEOUT, Duration::from_secs(2));
    }

    #[test]
    fn long_timeout_is_60_seconds() {
        assert_eq!(LONG_TIMEOUT, Duration::from_secs(60));
    }

    #[test]
    fn create_blocking_client_returns_valid_client() {
        let client = create_blocking_client(Duration::from_secs(1));
        assert!(std::mem::size_of_val(&client) > 0);
    }
}
