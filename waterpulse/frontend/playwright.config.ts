import { defineConfig, devices } from "@playwright/test";

// Optional: point Playwright at an existing Chromium when the standard browser
// download is unavailable (e.g. restricted networks): PLAYWRIGHT_CHROMIUM_PATH.
declare const process: { env: Record<string, string | undefined> };
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const launchOptions = executablePath
  ? { executablePath, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"] }
  : {};

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", launchOptions }
    }
  ],
  webServer: [
    {
      // Offline demo-mode API with a throwaway database; no keys required.
      command: "python3 -m uvicorn app.main:app --port 8000",
      cwd: "../backend",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: !process.env.CI,
      env: {
        APP_MODE: "demo", RATE_LIMIT_PER_MINUTE: "5000",
        DATABASE_PATH: process.env.E2E_DATABASE_PATH || "/tmp/waterpulse-e2e.sqlite3"
      }
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI
    }
  ]
});
