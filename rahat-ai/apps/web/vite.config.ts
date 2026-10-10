import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/rahat/",
  plugins: [react()],
  server: {
    port: 5200,
    proxy: { "/rahat/api": { target: "http://127.0.0.1:8030", proxyTimeout: 120000, timeout: 120000, rewrite: path => path.replace(/^\/rahat/, '') } },
  },
  preview: {
    port: 5200,
    proxy: { "/rahat/api": { target: "http://127.0.0.1:8030", rewrite: path => path.replace(/^\/rahat/, '') } },
  },
  build: { chunkSizeWarningLimit: 900 },
  test: { environment: "jsdom", exclude: ["e2e/**", "node_modules/**", "dist/**"] },
});
