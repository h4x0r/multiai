use multiai::api::{create_router_with_state, AppState};
use std::net::SocketAddr;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Start MultiAI backend server in background
      std::thread::spawn(|| {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async {
          let addr = SocketAddr::from(([127, 0, 0, 1], 11434));
          let state = AppState::default();
          let app = create_router_with_state(state);

          log::info!("MultiAI backend starting on http://{}", addr);

          let listener = tokio::net::TcpListener::bind(addr)
            .await
            .expect("Failed to bind to port 11434");

          axum::serve(listener, app)
            .await
            .expect("Server error");
        });
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
