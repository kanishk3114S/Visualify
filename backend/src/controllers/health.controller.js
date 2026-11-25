import { sendError, sendSuccess } from "../utils/response.js";

/** Liveness + readiness. Reports dependency state only - never versions, URLs or keys. */
export function createHealthController(gateway) {
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
  };
}
