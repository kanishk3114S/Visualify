import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const WORKER_ROOT = path.resolve(import.meta.dirname, "../..");
const DEFAULT_LOCAL_ENV_PATH = path.join(WORKER_ROOT, ".env.local");
const DEFAULT_FALLBACK_ENV_PATH = path.join(WORKER_ROOT, ".env");

let envLoaded = false;

/**
 * Loads worker environment variables from backend/worker/.env.local (or .env)
 * without overriding already-set process environment variables.
 */
export function loadWorkerEnv() {
  if (envLoaded) return;
  if (fs.existsSync(DEFAULT_LOCAL_ENV_PATH)) {
    dotenv.config({ path: DEFAULT_LOCAL_ENV_PATH, override: false, quiet: true });
  } else if (fs.existsSync(DEFAULT_FALLBACK_ENV_PATH)) {
    dotenv.config({ path: DEFAULT_FALLBACK_ENV_PATH, override: false, quiet: true });
  }
  envLoaded = true;
}

const WINDOWS_BROWSER_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const LINUX_BROWSER_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
];

/**
 * Resolves a valid browser executable path for @excalidraw/cli.
 * Falls back to OS-standard locations if envPath is unset or points to a non-existent cross-OS path.
 */
export function resolveBrowserPath({
  envPath = process.env.EXCALIDRAW_BROWSER_PATH,
  platform = process.platform,
  existsSync = fs.existsSync,
} = {}) {
  const trimmed = typeof envPath === "string" ? envPath.trim() : "";
  if (trimmed && existsSync(trimmed)) {
    return { path: trimmed, source: "env" };
  }

  const candidates =
    platform === "win32" ? WINDOWS_BROWSER_CANDIDATES : LINUX_BROWSER_CANDIDATES;

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return {
        path: candidate,
        source: trimmed ? "fallback_after_missing_env_path" : "autodetect",
      };
    }
  }

  return { path: null, source: "not_found" };
}

export function getCliRenderTimeoutMs(raw = process.env.CLI_RENDER_TIMEOUT_MS) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 120_000) {
    return 30_000;
  }
  return Math.floor(parsed);
}

export function getGeminiConfig() {
  loadWorkerEnv();
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || "gemini-3.5-flash").trim();

  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is not configured. Set a valid key in backend/worker/.env.local before running live Gemini calls."
    );
  }

  return { apiKey, model };
}

export function getWorkerRoot() {
  return WORKER_ROOT;
}
