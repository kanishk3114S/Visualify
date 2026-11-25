import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { sendError } from "../utils/response.js";

function limiter({ windowMs, limit, byUser = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Authenticated mutation limits are per user (falls back to IP).
    keyGenerator: (req) => (byUser && req.user?.id ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? "")}`),
    handler: (_req, res) =>
      sendError(res, 429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again."),
  });
}

/**
 * Rate limiters. Note: req.ip only reflects the real client when TRUST_PROXY
 * is enabled behind a single trusted proxy; X-Forwarded-For is otherwise ignored.
 */
export function createRateLimiters() {
  return {
    /** Broad per-IP ceiling for the whole API. */
    api: limiter({ windowMs: 15 * 60 * 1000, limit: 300 }),
    /** Profile mutations (PATCH /me). */
    profileMutation: limiter({ windowMs: 15 * 60 * 1000, limit: 30, byUser: true }),
    /** Avatar upload/delete - CPU-heavy image processing. */
    avatarMutation: limiter({ windowMs: 15 * 60 * 1000, limit: 10, byUser: true }),
    /** Generation create/retry: each one is a paid model call. */
    generationCreate: limiter({ windowMs: 60 * 60 * 1000, limit: 20, byUser: true }),
    /** Generation cancel. */
    generationControl: limiter({ windowMs: 15 * 60 * 1000, limit: 60, byUser: true }),
  };
}
