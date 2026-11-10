import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server proxies the SENTINEL backend (which in turn talks to go2rtc).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api/ws': { target: 'ws://127.0.0.1:8080', ws: true, changeOrigin: false },
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
  // No inlined data: assets, so the strict Content-Security-Policy (font-src 'self') holds.
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800, assetsInlineLimit: 0 },
});
