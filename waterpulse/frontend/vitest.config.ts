import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.tsx"],
    env: { VITE_API_BASE: process.env.VITE_API_BASE ?? "http://127.0.0.1:8000/api" },
    testTimeout: 20000
  }
});
