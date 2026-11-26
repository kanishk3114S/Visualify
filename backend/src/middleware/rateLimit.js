import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { sendError } from "../utils/response.js";

function limiter({ windowMs, limit, byUser = false, prefix = "rl", redis = null }) {
  const store = redis
    ? new RedisStore({
        prefix: `visualify:${prefix}:`,
        sendCommand: (...args) => redis.call(...args),
      })
    : undefined;

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(store ? { store, passOnStoreError: true } : {}),
    // Authenticated mutation limits are per user (falls back to IP).
    keyGenerator: (req) => (byUser && req.user?.id ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? "")}`),
    handler: (_req, res) =>
      sendError(res, 429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again."),
  });
}

/**
 * Rate limiters. Uses RedisStore across instances when `redis` is configured,
 * and falls back cleanly to the built-in memory store in local dev and tests.
 */
export function createRateLimiters({ redis = null } = {}) {
  return {
    /** Broad per-IP ceiling for the whole API. */
    api: limiter({ windowMs: 15 * 60 * 1000, limit: 300, prefix: "api", redis }),
    /** Profile mutations (PATCH /me). */
    profileMutation: limiter({ windowMs: 15 * 60 * 1000, limit: 30, byUser: true, prefix: "profile", redis }),
    /** Avatar upload/delete - CPU-heavy image processing. */
    avatarMutation: limiter({ windowMs: 15 * 60 * 1000, limit: 10, byUser: true, prefix: "avatar", redis }),
    /** Self-service account deletion (destructive + auth check). */
    accountDelete: limiter({ windowMs: 60 * 60 * 1000, limit: 5, byUser: true, prefix: "acct_del", redis }),
    /** Generation create/retry: each one is a paid model call. */
    generationCreate: limiter({ windowMs: 60 * 60 * 1000, limit: 20, byUser: true, prefix: "gen_create", redis }),
    /** Generation cancel. */
    generationControl: limiter({ windowMs: 15 * 60 * 1000, limit: 60, byUser: true, prefix: "gen_ctrl", redis }),
    /** Notes/folders writes (rename, move, snapshot, restore, duplicate, delete). */
    notesWrite: limiter({ windowMs: 15 * 60 * 1000, limit: 300, byUser: true, prefix: "notes_w", redis }),
    /** Autosave fires every few seconds while editing. */
    autosave: limiter({ windowMs: 15 * 60 * 1000, limit: 1200, byUser: true, prefix: "autosave", redis }),
    /** Exports launch a headless browser. */
    exports: limiter({ windowMs: 15 * 60 * 1000, limit: 40, byUser: true, prefix: "exports", redis }),
    /** Source file uploads (PDF/image). */
    sourcesUpload: limiter({ windowMs: 15 * 60 * 1000, limit: 30, byUser: true, prefix: "src_up", redis }),
    /** AI study companion & section regeneration calls. */
    aiCompanion: limiter({ windowMs: 60 * 60 * 1000, limit: 60, byUser: true, prefix: "companion", redis }),
    /** Optional admin job inspector. */
    adminInspect: limiter({ windowMs: 15 * 60 * 1000, limit: 60, byUser: true, prefix: "admin", redis }),
  };
}
