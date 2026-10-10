import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 152010,
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure" },
  webServer: [
    {
      command: "python -m uvicorn backend.main:app --host 127.0.0.1 --port 5201",
      cwd: "..",
      url: "http://127.0.0.1:5201/api/health",
      reuseExistingServer: !process.env.CI
    },
    { command: "npm run dev", url: "http://127.0.0.1:5174", reuseExistingServer: !process.env.CI }
  ]
});
