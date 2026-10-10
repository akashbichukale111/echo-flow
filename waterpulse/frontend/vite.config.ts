import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Local dev convenience: when DEV_PROXY_API_TOKEN is set (a plain env var, not
// VITE_-prefixed, so it is never bundled into browser code) the dev server adds
// the bearer token to proxied API calls. Production builds are unaffected.
declare const process: { env: Record<string, string | undefined> };
const token = process.env.DEV_PROXY_API_TOKEN;

export default defineConfig({
  base: "/waterpulse/",
  plugins: [react()],
  server: {
    proxy: {
      "/waterpulse/api": {
        target: "http://127.0.0.1:8000",
        rewrite: path => path.replace(/^\/waterpulse/, ''),
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      }
    }
  },
  build: { chunkSizeWarningLimit: 850 }
});
