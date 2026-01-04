/**
 * Mock for @tauri-apps/plugin-shell in browser tests.
 * In tests, open() is a no-op.
 */
export async function open(url) {
  // In browser tests, we just log
  console.log('[mock] tauri-shell open:', url);
}
