import fs from "node:fs";
import { defineConfig } from "@playwright/test";

const windowsChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const hasWindowsChrome = process.platform === "win32" && fs.existsSync(windowsChrome);

/**
 * E2E runs the real Vite app with placeholder, NON-SECRET public config:
 * the Supabase URL points at an unused local port (no network calls happen
 * without a session) and every /api/v1 call is intercepted by page.route()
 * in the specs. A dedicated port avoids reusing a developer's dev server
 * that may be wired to a real Supabase project.
 */
export const E2E_PORT = 5174;
export const E2E_API_BASE = "http://127.0.0.1:5999";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    ...(hasWindowsChrome ? { launchOptions: { executablePath: windowsChrome } } : {}),
  },
  webServer: {
    command: `npm --workspace=@visualify/frontend run dev -- --host 127.0.0.1 --port ${E2E_PORT}`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54399",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-placeholder-publishable-key",
      VITE_API_BASE_URL: E2E_API_BASE,
    },
  },
});
