import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";
import { sendSuccess } from "../utils/response.js";
import { isUuid } from "../schemas/generation.schema.js";

const MAX_METRICS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_METRICS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Pure admin predicate shared between requireAdmin middleware and /me isAdmin flag.
 * Derived strictly from verified JWT appMetadata.role or configured ADMIN_USER_IDS.
 */
export function isUserAdmin(user, config) {
  const allowlist = new Set((config?.adminUserIds ?? []).map((id) => id.toLowerCase()));
  return user?.appMetadata?.role === "admin" || Boolean(user?.id && allowlist.has(user.id.toLowerCase()));
}

/**
 * Server-side admin check (AGENTS.md §21). Non-admins receive 403 FORBIDDEN;
 * unauthenticated requests are rejected upstream by `requireAuth` (401).
 */
export function requireAdmin(config) {
  return (req, _res, next) => {
    if (!isUserAdmin(req.user, config)) {
      throw new AppError(403, "FORBIDDEN", "Administrator access required.");
    }
    next();
  };
}

function parseMetricsWindow(query = {}) {
  const now = new Date();
  const rawTo = query.to;
  const rawFrom = query.from;

  const toDate = rawTo !== undefined && rawTo !== "" ? new Date(String(rawTo)) : now;
  if (!Number.isFinite(toDate.getTime())) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid 'to' timestamp. Provide an ISO-8601 date.");
  }

  const fromDate =
    rawFrom !== undefined && rawFrom !== ""
      ? new Date(String(rawFrom))
      : new Date(toDate.getTime() - DEFAULT_METRICS_WINDOW_MS);
  if (!Number.isFinite(fromDate.getTime())) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid 'from' timestamp. Provide an ISO-8601 date.");
  }

  const spanMs = toDate.getTime() - fromDate.getTime();
  if (spanMs < 0) {
    throw new AppError(400, "VALIDATION_ERROR", "'from' must be earlier than or equal to 'to'.");
  }
  if (spanMs > MAX_METRICS_WINDOW_MS) {
    throw new AppError(400, "VALIDATION_ERROR", "Metrics window cannot exceed 90 days.");
  }

  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

/**
 * Redacted operator job inspector (PRD §16.5) & aggregated PRD §14.1 metrics:
 * Never returns prompts, learning plans, scenes, emails, or source filenames.
 */
export function createAdminRouter({ config, gateway, limiters, generation, analyticsService = null }) {
  const router = Router();
  router.use(requireAuth(gateway));
  router.use(requireAdmin(config));
  router.use(limiters.adminInspect);

  router.get("/metrics", async (req, res) => {
    const window = parseMetricsWindow(req.query);

    if (analyticsService?.computeMetrics) {
      const report = await analyticsService.computeMetrics(window);
      return sendSuccess(res, { report });
    }

    const adminDb = gateway?.createAdminClient?.() ?? null;
    if (!adminDb?.rpc) {
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Product metrics require a configured service-role database client.");
    }

    const { data, error } = await adminDb.rpc("compute_product_metrics", {
      p_from: window.from,
      p_to: window.to,
    });
    if (error) {
      req.log?.warn({ errorCode: error.code ?? "METRICS_RPC_ERROR" }, "compute_product_metrics failed");
      throw new AppError(500, "METRICS_QUERY_FAILED", "Could not compute product metrics.");
    }

    return sendSuccess(res, { report: data });
  });

  router.get("/jobs/:jobId", async (req, res) => {
    const jobId = req.params.jobId;
    if (!isUuid(jobId)) throw new AppError(404, "NOT_FOUND", "Job not found.");
    const row = await generation.store.getRedactedJobForAdmin?.(jobId.toLowerCase());
    if (!row) throw new AppError(404, "NOT_FOUND", "Job not found.");
    return sendSuccess(res, {
      job: {
        jobId: row.id,
        ownerId: row.owner_id,
        inputType: row.input_type ?? "prompt",
        status: row.status,
        stage: row.stage ?? null,
        progress: row.progress ?? 0,
        attemptCount: row.attempt_count ?? 1,
        modelId: row.model_id ?? null,
        errorCode: row.error_code ?? null,
        createdAt: row.created_at ?? null,
        startedAt: row.started_at ?? null,
        finishedAt: row.finished_at ?? null,
      },
    });
  });

  return router;
}
