//! Spending caps and tracking for MCP judge calls.
//!
//! Tracks daily and monthly spending on premium judge models
//! to prevent runaway costs.

use crate::config::SpendingConfig;
use chrono::{DateTime, Datelike, TimeZone, Utc};
use rusqlite::{params, Connection, Result as SqlResult};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Spending cap exceeded error.
#[derive(Debug, Clone, Serialize)]
pub struct SpendingCapError {
    pub error: String,
    pub message: String,
    pub cap_type: String,
    pub used: f64,
    pub cap: f64,
    pub resets_at: DateTime<Utc>,
}

/// Spending tracker that persists to SQLite.
pub struct SpendingTracker {
    conn: Arc<Mutex<Connection>>,
    config: SpendingConfig,
}

impl SpendingTracker {
    /// Create a new spending tracker with the given database path.
    pub fn new(db_path: PathBuf, config: SpendingConfig) -> SqlResult<Self> {
        let conn = Connection::open(&db_path)?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            config,
        })
    }

    /// Create an in-memory tracker for testing.
    pub fn in_memory(config: SpendingConfig) -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            config,
        })
    }

    /// Initialize the database schema.
    fn init_schema(conn: &Connection) -> SqlResult<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS spending (
                id TEXT PRIMARY KEY,
                amount REAL NOT NULL DEFAULT 0.0,
                reset_at TEXT NOT NULL
            )",
            [],
        )?;

        // Initialize daily and monthly rows if they don't exist
        let now = Utc::now();
        let daily_reset = Self::next_daily_reset(&now);
        let monthly_reset = Self::next_monthly_reset(&now);

        conn.execute(
            "INSERT OR IGNORE INTO spending (id, amount, reset_at) VALUES ('daily', 0.0, ?)",
            params![daily_reset.to_rfc3339()],
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO spending (id, amount, reset_at) VALUES ('monthly', 0.0, ?)",
            params![monthly_reset.to_rfc3339()],
        )?;

        Ok(())
    }

    /// Calculate next daily reset time (midnight UTC).
    fn next_daily_reset(from: &DateTime<Utc>) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(from.year(), from.month(), from.day(), 0, 0, 0)
            .unwrap()
            + chrono::Duration::days(1)
    }

    /// Calculate next monthly reset time (1st of next month UTC).
    fn next_monthly_reset(from: &DateTime<Utc>) -> DateTime<Utc> {
        let (year, month) = if from.month() == 12 {
            (from.year() + 1, 1)
        } else {
            (from.year(), from.month() + 1)
        };
        Utc.with_ymd_and_hms(year, month, 1, 0, 0, 0).unwrap()
    }

    /// Check and reset spending if necessary.
    fn maybe_reset(&self) -> SqlResult<()> {
        let now = Utc::now();
        let conn = self.conn.lock().unwrap();

        // Check and reset daily
        let daily_reset: String =
            conn.query_row("SELECT reset_at FROM spending WHERE id = 'daily'", [], |row| {
                row.get(0)
            })?;
        if let Ok(reset_time) = DateTime::parse_from_rfc3339(&daily_reset) {
            if now >= reset_time {
                let new_reset = Self::next_daily_reset(&now);
                conn.execute(
                    "UPDATE spending SET amount = 0.0, reset_at = ? WHERE id = 'daily'",
                    params![new_reset.to_rfc3339()],
                )?;
            }
        }

        // Check and reset monthly
        let monthly_reset: String = conn.query_row(
            "SELECT reset_at FROM spending WHERE id = 'monthly'",
            [],
            |row| row.get(0),
        )?;
        if let Ok(reset_time) = DateTime::parse_from_rfc3339(&monthly_reset) {
            if now >= reset_time {
                let new_reset = Self::next_monthly_reset(&now);
                conn.execute(
                    "UPDATE spending SET amount = 0.0, reset_at = ? WHERE id = 'monthly'",
                    params![new_reset.to_rfc3339()],
                )?;
            }
        }

        Ok(())
    }

    /// Get current spending amounts.
    pub fn get_spending(&self) -> SqlResult<(f64, f64)> {
        self.maybe_reset()?;
        let conn = self.conn.lock().unwrap();

        let daily: f64 =
            conn.query_row("SELECT amount FROM spending WHERE id = 'daily'", [], |row| {
                row.get(0)
            })?;
        let monthly: f64 = conn.query_row(
            "SELECT amount FROM spending WHERE id = 'monthly'",
            [],
            |row| row.get(0),
        )?;

        Ok((daily, monthly))
    }

    /// Check if a cost would exceed spending caps.
    pub fn check_cap(&self, estimated_cost: f64) -> Result<(), SpendingCapError> {
        let _ = self.maybe_reset();
        let (daily, monthly) = self.get_spending().unwrap_or((0.0, 0.0));

        if daily + estimated_cost > self.config.daily_cap {
            return Err(SpendingCapError {
                error: "spending_cap_exceeded".to_string(),
                message: format!(
                    "Daily spending cap of ${:.2} reached (${:.2} used)",
                    self.config.daily_cap, daily
                ),
                cap_type: "daily".to_string(),
                used: daily,
                cap: self.config.daily_cap,
                resets_at: Self::next_daily_reset(&Utc::now()),
            });
        }

        if monthly + estimated_cost > self.config.monthly_cap {
            return Err(SpendingCapError {
                error: "spending_cap_exceeded".to_string(),
                message: format!(
                    "Monthly spending cap of ${:.2} reached (${:.2} used)",
                    self.config.monthly_cap, monthly
                ),
                cap_type: "monthly".to_string(),
                used: monthly,
                cap: self.config.monthly_cap,
                resets_at: Self::next_monthly_reset(&Utc::now()),
            });
        }

        Ok(())
    }

    /// Record a cost.
    pub fn record_cost(&self, cost: f64) -> SqlResult<()> {
        self.maybe_reset()?;
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "UPDATE spending SET amount = amount + ? WHERE id = 'daily'",
            params![cost],
        )?;
        conn.execute(
            "UPDATE spending SET amount = amount + ? WHERE id = 'monthly'",
            params![cost],
        )?;

        Ok(())
    }

    /// Check if we're at or above warning threshold.
    pub fn is_at_warning(&self) -> bool {
        if let Ok((daily, monthly)) = self.get_spending() {
            let daily_percent = (daily / self.config.daily_cap * 100.0) as u8;
            let monthly_percent = (monthly / self.config.monthly_cap * 100.0) as u8;
            daily_percent >= self.config.warn_at_percent
                || monthly_percent >= self.config.warn_at_percent
        } else {
            false
        }
    }

    /// Get spending status summary.
    pub fn get_status(&self) -> SpendingStatus {
        let (daily, monthly) = self.get_spending().unwrap_or((0.0, 0.0));
        let now = Utc::now();

        SpendingStatus {
            daily_used: daily,
            daily_cap: self.config.daily_cap,
            daily_percent: (daily / self.config.daily_cap * 100.0).min(100.0),
            daily_resets_at: Self::next_daily_reset(&now),
            monthly_used: monthly,
            monthly_cap: self.config.monthly_cap,
            monthly_percent: (monthly / self.config.monthly_cap * 100.0).min(100.0),
            monthly_resets_at: Self::next_monthly_reset(&now),
            at_warning: self.is_at_warning(),
        }
    }
}

/// Spending status for display.
#[derive(Debug, Clone, Serialize)]
pub struct SpendingStatus {
    pub daily_used: f64,
    pub daily_cap: f64,
    pub daily_percent: f64,
    pub daily_resets_at: DateTime<Utc>,
    pub monthly_used: f64,
    pub monthly_cap: f64,
    pub monthly_percent: f64,
    pub monthly_resets_at: DateTime<Utc>,
    pub at_warning: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spending_config_default_values() {
        let config = SpendingConfig::default();
        assert_eq!(config.daily_cap, 5.0);
        assert_eq!(config.monthly_cap, 50.0);
        assert_eq!(config.warn_at_percent, 80);
    }

    #[test]
    fn spending_tracker_starts_at_zero() {
        let tracker = SpendingTracker::in_memory(SpendingConfig::default()).unwrap();
        let (daily, monthly) = tracker.get_spending().unwrap();
        assert_eq!(daily, 0.0);
        assert_eq!(monthly, 0.0);
    }

    #[test]
    fn spending_tracker_records_cost() {
        let tracker = SpendingTracker::in_memory(SpendingConfig::default()).unwrap();
        tracker.record_cost(1.50).unwrap();
        let (daily, monthly) = tracker.get_spending().unwrap();
        assert_eq!(daily, 1.50);
        assert_eq!(monthly, 1.50);
    }

    #[test]
    fn spending_cap_check_passes_under_limit() {
        let tracker = SpendingTracker::in_memory(SpendingConfig::default()).unwrap();
        assert!(tracker.check_cap(1.0).is_ok());
    }

    #[test]
    fn spending_cap_check_fails_over_daily_limit() {
        let tracker = SpendingTracker::in_memory(SpendingConfig::default()).unwrap();
        tracker.record_cost(4.50).unwrap();
        let result = tracker.check_cap(1.0);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.cap_type, "daily");
    }

    #[test]
    fn spending_cap_check_fails_over_monthly_limit() {
        let config = SpendingConfig {
            daily_cap: 100.0, // High daily to test monthly
            monthly_cap: 10.0,
            warn_at_percent: 80,
        };
        let tracker = SpendingTracker::in_memory(config).unwrap();
        tracker.record_cost(9.50).unwrap();
        let result = tracker.check_cap(1.0);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.cap_type, "monthly");
    }

    #[test]
    fn warning_threshold_triggers() {
        let tracker = SpendingTracker::in_memory(SpendingConfig::default()).unwrap();
        assert!(!tracker.is_at_warning());
        tracker.record_cost(4.10).unwrap(); // 82% of $5
        assert!(tracker.is_at_warning());
    }

    #[test]
    fn spending_status_shows_correct_values() {
        let tracker = SpendingTracker::in_memory(SpendingConfig::default()).unwrap();
        tracker.record_cost(2.50).unwrap();
        let status = tracker.get_status();
        assert_eq!(status.daily_used, 2.50);
        assert_eq!(status.daily_cap, 5.0);
        assert_eq!(status.daily_percent, 50.0);
    }
}
