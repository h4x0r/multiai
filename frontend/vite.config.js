import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  optimizeDeps: {
    include: [
      'debug',
      'extend',
      'micromark',
      'micromark-util-combine-extensions',
      'remark-parse',
      'mdast-util-from-markdown'
    ]
  },
  build: {
    outDir: '../static',
    emptyOutDir: true,
    rollupOptions: {
      // Externalize Tauri plugins - they're only available in Tauri runtime
      external: ['@tauri-apps/plugin-shell'],
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:11435',
      '/v1': 'http://localhost:11435',
      '/health': 'http://localhost:11435'
    }
  }
});
