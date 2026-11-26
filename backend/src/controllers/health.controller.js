import fs from "node:fs";
import { resolveBrowserPath } from "@visualify/worker";
import { sendError, sendSuccess } from "../utils/response.js";

/** Liveness + readiness. Reports dependency state only - never versions, URLs, paths or keys. */
export function createHealthController(gateway, { config = null, redis = null } = {}) {
  async function checkRedis() {
    if (!redis) return null;
    try {
      const pong = await Promise.race([
        redis.ping(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
      ]);
      return pong === "PONG" ? "ok" : "unreachable";
    } catch {
      return "unreachable";
    }
  }

  function checkRenderer() {
    try {
      const resolved = resolveBrowserPath(config?.generation?.browserPath);
      if (resolved && fs.existsSync(resolved)) return "ok";
      return config?.nodeEnv === "test" ? "ok" : "unavailable";
    } catch {
      return config?.nodeEnv === "test" ? "ok" : "unavailable";
    }
  }

  return {
    async getHealth(_req, res) {
      const supabaseOk = await gateway.checkHealth();
      const checks = { api: "ok", supabase: supabaseOk ? "ok" : "unreachable" };
      const timestamp = new Date().toISOString();
      if (!supabaseOk) {
        return sendError(res, 503, "SERVICE_DEGRADED", "A required dependency is unavailable.", {
          status: "degraded",
          checks,
          timestamp,
        });
      }
      return sendSuccess(res, { status: "ok", checks, timestamp });
    },

    getLiveness(_req, res) {
      return sendSuccess(res, {
        status: "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    },

    async getReadiness(_req, res) {
      const [supabaseOk, redisStatus] = await Promise.all([gateway.checkHealth(), checkRedis()]);
      const rendererStatus = checkRenderer();
      const checks = {
        api: "ok",
        supabase: supabaseOk ? "ok" : "unreachable",
        ...(redisStatus ? { redis: redisStatus } : {}),
        renderer: rendererStatus,
      };
      const healthy = supabaseOk && (!redisStatus || redisStatus === "ok") && rendererStatus === "ok";
      const timestamp = new Date().toISOString();
      if (!healthy) {
        return sendError(res, 503, "SERVICE_DEGRADED", "A required dependency is unavailable.", {
          status: "degraded",
          checks,
          timestamp,
        });
      }
      return sendSuccess(res, { status: "ok", checks, timestamp });
    },
  };
}
