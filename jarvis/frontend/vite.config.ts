import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev: Vite on :5173 proxies /api to the FastAPI backend on loopback.
// Production: `npm run build` → dist/, served by FastAPI on one origin (http://127.0.0.1:8787).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
