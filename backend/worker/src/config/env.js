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

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";
export const SECONDARY_FALLBACK_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_MODEL_NAME_RE = /^gemini-[a-z0-9.\-]+$/;
export const MAX_FALLBACK_MODELS = 3;
export const DEFAULT_RENDER_CONCURRENCY = 2;
export const MAX_RENDER_CONCURRENCY = 8;

/**
 * Parses and validates `GEMINI_FALLBACK_MODELS` (comma-separated):
 * - max 3 entries
 * - each matching `/^gemini-[a-z0-9.\-]+$/`
 * - de-duplicated and never equal to `primaryModel`
 * Returns `null` when unset so callers can apply model-chain defaults.
 */
export function parseFallbackModels(raw, primaryModel = DEFAULT_GEMINI_MODEL) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const entries = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];

  for (const model of entries) {
    if (!GEMINI_MODEL_NAME_RE.test(model)) {
      throw new Error(`Invalid GEMINI_FALLBACK_MODELS entry "${model}": must match /^gemini-[a-z0-9.\\-]+$/`);
    }
    if (model === primaryModel || seen.has(model)) continue;
    seen.add(model);
    out.push(model);
  }

  if (out.length > MAX_FALLBACK_MODELS) {
    throw new Error(`GEMINI_FALLBACK_MODELS may list at most ${MAX_FALLBACK_MODELS} fallback models`);
  }
  return out;
}

export function getDefaultFallbackModels(primaryModel = DEFAULT_GEMINI_MODEL) {
  return [primaryModel === DEFAULT_FALLBACK_MODEL ? SECONDARY_FALLBACK_MODEL : DEFAULT_FALLBACK_MODEL];
}

export function getCliRenderTimeoutMs(raw = process.env.CLI_RENDER_TIMEOUT_MS) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 120_000) {
    return 30_000;
  }
  return Math.floor(parsed);
}

export function getRenderConcurrency(raw = process.env.RENDER_CONCURRENCY) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return DEFAULT_RENDER_CONCURRENCY;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_RENDER_CONCURRENCY) {
    throw new Error(`Invalid RENDER_CONCURRENCY: must be an integer between 1 and ${MAX_RENDER_CONCURRENCY}`);
  }
  return parsed;
}

export function getGeminiConfig() {
  loadWorkerEnv();
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const fallbackModels = parseFallbackModels(process.env.GEMINI_FALLBACK_MODELS, model) ?? getDefaultFallbackModels(model);

  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is not configured. Set a valid key in backend/worker/.env.local before running live Gemini calls."
    );
  }

  return { apiKey, model, fallbackModels };
}

export function getWorkerRoot() {
  return WORKER_ROOT;
}
