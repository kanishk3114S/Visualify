import fs from "node:fs";
import { defineConfig } from "@playwright/test";

const windowsChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const hasWindowsChrome = process.platform === "win32" && fs.existsSync(windowsChrome);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    viewport: { width: 1280, height: 800 },
    ...(hasWindowsChrome
      ? { launchOptions: { executablePath: windowsChrome } }
      : {}),
  },
  webServer: {
    command: "npm --workspace=frontend run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
