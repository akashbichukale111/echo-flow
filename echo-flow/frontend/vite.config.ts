import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/echo-flow/",
  plugins: [react()],
  // Share the single root .env with the backend; Vite only exposes VITE_* variables to the browser.
  envDir: "..",
  server: { host: "127.0.0.1", port: 5174, strictPort: true, proxy: { "/echo-flow/api": { target: "http://127.0.0.1:5201", rewrite: path => path.replace(/^\/echo-flow/, '') } } },
  preview: { host: "127.0.0.1", port: 5174, strictPort: true, proxy: { "/echo-flow/api": { target: "http://127.0.0.1:5201", rewrite: path => path.replace(/^\/echo-flow/, '') } } },
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: "jsdom", globals: true, exclude: ["e2e/**", "node_modules/**"] }
});
