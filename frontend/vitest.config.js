import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // Exclude Playwright tests (they're run separately via npx playwright test)
    exclude: ['src/test/*.spec.js', 'node_modules/**'],
  },
  resolve: {
    conditions: ['development', 'browser'],
    alias: {
      // Mock Tauri plugins for browser testing
      '@tauri-apps/plugin-shell': new URL('./src/test/mocks/tauri-shell.js', import.meta.url).pathname,
    },
  },
});
