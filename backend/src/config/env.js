import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_RENDER_CONCURRENCY,
  MAX_FALLBACK_MODELS,
  MAX_RENDER_CONCURRENCY,
  getDefaultFallbackModels,
  parseFallbackModels,
} from "@visualify/worker";

const API_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Loads backend/.env.local (falling back to backend/.env) without overriding
 * variables already present in the process environment (host secrets win).
 */
export function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(API_ROOT, file);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full, override: false, quiet: true });
      return;
    }
  }
}

const MAX_AVATAR_BYTES_CEILING = 5 * 1024 * 1024;
const MAX_SOURCE_BYTES_CEILING = 20 * 1024 * 1024;

const originSchema = z.string().transform((value, ctx) => {
  const origins = value
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    ctx.addIssue({ code: "custom", message: "must list at least one origin" });
    return z.NEVER;
  }
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      ctx.addIssue({ code: "custom", message: `"${origin}" is not a valid URL origin` });
      return z.NEVER;
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
      ctx.addIssue({
        code: "custom",
        message: `"${origin}" must be an exact http(s) origin without path or trailing slash`,
      });
      return z.NEVER;
    }
  }
  return origins;
});

const booleanString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PROCESS_ROLE: z.enum(["api", "worker", "all"]).default("all"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(5001),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(120000).default(25000),
  FRONTEND_ORIGIN: originSchema,
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  // Server-only. Used exclusively by the in-process generation job runner to
  // write pipeline results (users can only create/read/cancel their jobs).
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Generation (Phase 2). The key itself is read by the worker module from the
  // process environment; config only records whether it is configured.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().trim().min(1).max(100).default(DEFAULT_GEMINI_MODEL),
  GEMINI_FALLBACK_MODELS: z.string().optional(),
  GENERATION_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  GENERATION_PLANNER_TIMEOUT_MS: z.coerce.number().int().min(5000).max(180000).default(90000),
  GENERATION_JOB_TIMEOUT_MS: z.coerce.number().int().min(10000).max(600000).default(240000),
  EXCALIDRAW_BROWSER_PATH: z.string().optional(),
  CLI_RENDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(MAX_RENDER_CONCURRENCY).default(DEFAULT_RENDER_CONCURRENCY),
  GENERATION_LIMIT_MONTHLY: z.coerce.number().int().min(1).max(100000).default(50),
  REDIS_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  ADMIN_USER_IDS: z.string().optional(),
  AVATAR_MAX_BYTES: z.coerce.number().int().min(1024).max(MAX_AVATAR_BYTES_CEILING).default(2097152),
  AVATAR_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  SOURCE_MAX_BYTES: z.coerce.number().int().min(1024).max(MAX_SOURCE_BYTES_CEILING).default(20971520),
  SOURCE_MAX_PDF_PAGES: z.coerce.number().int().min(1).max(500).default(100),
  SOURCE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  TRUST_PROXY: booleanString,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
});

const isConfigured = (value) => typeof value === "string" && value.trim().length > 0 && !/YOUR_|your[-_]/.test(value);

/**
 * Validates environment variables and returns a frozen config object.
 * Error messages name the offending variables but never echo their values.
 */
export function loadConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid API environment configuration:\n${problems}`);
  }
  const e = result.data;
  const adminUserIds = Object.freeze(
    String(e.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
  );
  const redisUrl = isConfigured(e.REDIS_URL) ? e.REDIS_URL.trim() : null;
  if (redisUrl && !/^rediss?:\/\//i.test(redisUrl)) {
    throw new Error("Invalid API environment configuration:\n  - REDIS_URL: must use redis:// or rediss:// protocol");
  }
  let fallbackModels;
  try {
    const parsedFallbacks = parseFallbackModels(e.GEMINI_FALLBACK_MODELS, e.GEMINI_MODEL);
    fallbackModels = Object.freeze(parsedFallbacks ?? getDefaultFallbackModels(e.GEMINI_MODEL));
  } catch (err) {
    throw new Error(`Invalid API environment configuration:\n  - GEMINI_FALLBACK_MODELS: ${err.message}`);
  }
  if (fallbackModels.length > MAX_FALLBACK_MODELS) {
    throw new Error(`Invalid API environment configuration:\n  - GEMINI_FALLBACK_MODELS: at most ${MAX_FALLBACK_MODELS} allowed`);
  }
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === "production",
    processRole: e.PROCESS_ROLE,
    port: e.PORT,
    workerHealthPort: e.WORKER_HEALTH_PORT,
    shutdownGraceMs: e.SHUTDOWN_GRACE_MS,
    frontendOrigins: Object.freeze([...e.FRONTEND_ORIGIN]),
    supabaseUrl: e.SUPABASE_URL.replace(/\/+$/, ""),
    supabasePublishableKey: e.SUPABASE_PUBLISHABLE_KEY,
    avatarMaxBytes: e.AVATAR_MAX_BYTES,
    avatarSignedUrlTtlSeconds: e.AVATAR_SIGNED_URL_TTL_SECONDS,
    sourceMaxBytes: e.SOURCE_MAX_BYTES,
    sourceMaxPdfPages: e.SOURCE_MAX_PDF_PAGES,
    sourceSignedUrlTtlSeconds: e.SOURCE_SIGNED_URL_TTL_SECONDS,
    generationLimitMonthly: e.GENERATION_LIMIT_MONTHLY,
    redisUrl,
    sentryDsn: isConfigured(e.SENTRY_DSN) ? e.SENTRY_DSN.trim() : null,
    adminUserIds,
    trustProxy: e.TRUST_PROXY,
    supabaseServiceRoleKey: isConfigured(e.SUPABASE_SERVICE_ROLE_KEY) ? e.SUPABASE_SERVICE_ROLE_KEY : null,
    generation: Object.freeze({
      // Both server secrets are required for background jobs; Gemini alone powers synchronous companion.
      enabled: isConfigured(e.SUPABASE_SERVICE_ROLE_KEY) && isConfigured(e.GEMINI_API_KEY),
      geminiConfigured: isConfigured(e.GEMINI_API_KEY),
      model: e.GEMINI_MODEL,
      fallbackModels,
      maxConcurrency: e.GENERATION_MAX_CONCURRENCY,
      renderConcurrency: e.RENDER_CONCURRENCY,
      plannerTimeoutMs: e.GENERATION_PLANNER_TIMEOUT_MS,
      jobTimeoutMs: e.GENERATION_JOB_TIMEOUT_MS,
      browserPath: e.EXCALIDRAW_BROWSER_PATH?.trim() || undefined,
      cliTimeoutMs: e.CLI_RENDER_TIMEOUT_MS,
    }),
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === "test" ? "silent" : e.NODE_ENV === "production" ? "info" : "debug"),
  });
}

/** Fail CLOSED in production when service-role metering/lifecycle key is absent. */
export function ensureProductionServiceRole(config) {
  if (config.isProduction && !config.supabaseServiceRoleKey) {
    throw new Error("Missing required production configuration: SUPABASE_SERVICE_ROLE_KEY is required for quota metering and server jobs.");
  }
}

/** Fail CLOSED in production when split api/worker roles run without REDIS_URL. */
export function ensureProcessRoleConfig(config) {
  ensureProductionServiceRole(config);
  if (config.isProduction && (config.processRole === "api" || config.processRole === "worker") && !config.redisUrl) {
    throw new Error(
      `Missing required production configuration: REDIS_URL is required when PROCESS_ROLE=${config.processRole}.`
    );
  }
}
