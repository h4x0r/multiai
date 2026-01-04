use multiai::api::{create_router_with_state, AppState};
use multiai::scanner::FreeModelScanner;
use std::net::SocketAddr;
use tauri::{
    Manager, RunEvent, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// Result of port finding: listener, port, and optional Ollama URL if detected
struct PortResult {
    listener: tokio::net::TcpListener,
    port: u16,
    ollama_url: Option<String>,
    /// If MultiAI is already running, we should exit
    multiai_already_running: bool,
}

async fn find_available_port() -> Option<PortResult> {
    let base_url = "http://127.0.0.1:11434";

    // First, check if port 11434 is taken by us (MultiAI already running)
    if FreeModelScanner::detect_multiai(base_url).await {
        log::info!("MultiAI already running at {}", base_url);
        return Some(PortResult {
            listener: tokio::net::TcpListener::bind("127.0.0.1:0").await.ok()?,
            port: 11434,
            ollama_url: None,
            multiai_already_running: true,
        });
    }

    // Check if port 11434 is taken by Ollama
    let ollama_detected = FreeModelScanner::detect_ollama(base_url).await;
    let ollama_url = if ollama_detected {
        log::info!("Detected local Ollama instance at {}", base_url);
        Some(base_url.to_string())
    } else {
        None
    };

    // Try ports starting from 11434 (Ollama-compatible)
    for port in 11434..11444 {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
            return Some(PortResult {
                listener,
                port,
                ollama_url,
                multiai_already_running: false,
            });
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Start backend server immediately in a separate thread
    std::thread::spawn(|| {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async {
            let result = find_available_port()
                .await
                .expect("No available port found (tried 11434-11443)");

            // If MultiAI is already running, don't start another server
            if result.multiai_already_running {
                log::info!("MultiAI already running, skipping server start");
                return;
            }

            // Create state with Ollama URL if detected
            let state = if let Some(ollama_url) = result.ollama_url {
                AppState::with_ollama(&ollama_url)
            } else {
                AppState::default()
            };
            let router = create_router_with_state(state);

            log::info!("MultiAI backend starting on http://127.0.0.1:{}", result.port);

            axum::serve(result.listener, router)
                .await
                .expect("Server error");
        });
    });

    let app = tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Build tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit MultiAI", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // Build tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Run with custom event handling - hide window on close instead of quitting
    app.run(|app_handle, event| {
        if let RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. } = event {
            if label == "main" {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
        }
    });
}
