import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  webServer: [
    {
      command: "python3 -m uvicorn main:app --host 127.0.0.1 --port 8000",
      cwd: "../../services/api",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
  ],
});
