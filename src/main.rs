//! MultiAI CLI - Compare multiple free AI models side by side.

use clap::{Parser, Subcommand};
use multiai::api::{create_router_with_state, AppState};
use multiai::config::{Config, LogVerbosity};
use std::net::SocketAddr;
use tokio::signal;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[derive(Parser)]
#[command(name = "multiai")]
#[command(about = "Compare multiple free AI models side by side")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the gateway server (headless mode)
    Serve {
        /// Port to listen on
        #[arg(short, long)]
        port: Option<u16>,

        /// Log verbosity level
        #[arg(short, long, value_enum, default_value = "compact")]
        log_level: LogLevel,

        /// Config file path
        #[arg(short, long)]
        config: Option<std::path::PathBuf>,
    },

    /// Launch the menu bar app (requires Tauri build)
    App,

    /// Show current configuration
    Config {
        /// Show config file path
        #[arg(long)]
        path: bool,
    },
}

#[derive(Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum LogLevel {
    Minimal,
    Compact,
    Verbose,
}

impl From<LogLevel> for LogVerbosity {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Minimal => LogVerbosity::Minimal,
            LogLevel::Compact => LogVerbosity::Compact,
            LogLevel::Verbose => LogVerbosity::Verbose,
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Serve { port, log_level, config }) => {
            run_server(port, log_level, config).await?;
        }
        Some(Commands::App) => {
            eprintln!("Menu bar app requires Tauri build. Use 'cargo tauri dev' instead.");
            std::process::exit(1);
        }
        Some(Commands::Config { path }) => {
            show_config(path)?;
        }
        None => {
            // Default: run server
            run_server(None, LogLevel::Compact, None).await?;
        }
    }

    Ok(())
}

async fn run_server(
    port_override: Option<u16>,
    log_level: LogLevel,
    config_path: Option<std::path::PathBuf>,
) -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(fmt::layer().with_target(false))
        .with(EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .init();

    // Load config
    let config = match config_path {
        Some(path) => Config::load_from(path)?,
        None => Config::load()?,
    };
    let config = config.with_env_overrides();

    // Determine port
    let port = port_override.unwrap_or(config.gateway.port);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    // Create app state
    let state = AppState::default();

    // Build router
    let app = create_router_with_state(state);

    // Print startup message
    let verbosity: LogVerbosity = log_level.into();
    match verbosity {
        LogVerbosity::Minimal => {
            println!("multiai:{}", port);
        }
        LogVerbosity::Compact => {
            println!("→ MultiAI starting on http://{}", addr);
            println!("→ OpenAI-compatible API: http://{}/v1", addr);
        }
        LogVerbosity::Verbose => {
            println!("────────────────────────────────────────");
            println!("MultiAI v{}", env!("CARGO_PKG_VERSION"));
            println!("────────────────────────────────────────");
            println!("Gateway:    http://{}", addr);
            println!("API Base:   http://{}/v1", addr);
            println!("Health:     http://{}/health", addr);
            println!("Models:     http://{}/v1/models", addr);
            println!("────────────────────────────────────────");
            println!("Log Level:  {:?}", verbosity);
            println!("────────────────────────────────────────");
        }
    }

    // Start server with graceful shutdown
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("Gateway listening on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    println!("\nGateway stopped.");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received");
}

fn show_config(show_path: bool) -> anyhow::Result<()> {
    if show_path {
        println!("{}", Config::default_path().display());
        return Ok(());
    }

    let config = Config::load()?.with_env_overrides();
    println!("{}", toml::to_string_pretty(&config)?);
    Ok(())
}
