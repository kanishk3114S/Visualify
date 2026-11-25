import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

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
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  FRONTEND_ORIGIN: originSchema,
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  // Server-only. Used exclusively by the in-process generation job runner to
  // write pipeline results (users can only create/read/cancel their jobs).
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Generation (Phase 2). The key itself is read by the worker module from the
  // process environment; config only records whether it is configured.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().trim().min(1).max(100).default("gemini-3.5-flash"),
  GENERATION_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  GENERATION_PLANNER_TIMEOUT_MS: z.coerce.number().int().min(5000).max(180000).default(90000),
  GENERATION_JOB_TIMEOUT_MS: z.coerce.number().int().min(10000).max(600000).default(240000),
  EXCALIDRAW_BROWSER_PATH: z.string().optional(),
  CLI_RENDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
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
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === "production",
    port: e.PORT,
    frontendOrigins: Object.freeze([...e.FRONTEND_ORIGIN]),
    supabaseUrl: e.SUPABASE_URL.replace(/\/+$/, ""),
    supabasePublishableKey: e.SUPABASE_PUBLISHABLE_KEY,
    avatarMaxBytes: e.AVATAR_MAX_BYTES,
    avatarSignedUrlTtlSeconds: e.AVATAR_SIGNED_URL_TTL_SECONDS,
    sourceMaxBytes: e.SOURCE_MAX_BYTES,
    sourceMaxPdfPages: e.SOURCE_MAX_PDF_PAGES,
    sourceSignedUrlTtlSeconds: e.SOURCE_SIGNED_URL_TTL_SECONDS,
    trustProxy: e.TRUST_PROXY,
    supabaseServiceRoleKey: isConfigured(e.SUPABASE_SERVICE_ROLE_KEY) ? e.SUPABASE_SERVICE_ROLE_KEY : null,
    generation: Object.freeze({
      // Both server secrets are required; otherwise generation endpoints return 503.
      enabled: isConfigured(e.SUPABASE_SERVICE_ROLE_KEY) && isConfigured(e.GEMINI_API_KEY),
      model: e.GEMINI_MODEL,
      maxConcurrency: e.GENERATION_MAX_CONCURRENCY,
      plannerTimeoutMs: e.GENERATION_PLANNER_TIMEOUT_MS,
      jobTimeoutMs: e.GENERATION_JOB_TIMEOUT_MS,
      browserPath: e.EXCALIDRAW_BROWSER_PATH?.trim() || undefined,
      cliTimeoutMs: e.CLI_RENDER_TIMEOUT_MS,
    }),
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === "test" ? "silent" : e.NODE_ENV === "production" ? "info" : "debug"),
  });
}
