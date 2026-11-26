import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../utils/errors.js";
import { sendSuccess } from "../utils/response.js";
import { isUuid } from "../schemas/generation.schema.js";

/**
 * Server-side admin check (AGENTS.md §21). Non-admins receive 403 FORBIDDEN;
 * unauthenticated requests are rejected upstream by `requireAuth` (401).
 */
export function requireAdmin(config) {
  const allowlist = new Set((config?.adminUserIds ?? []).map((id) => id.toLowerCase()));
  return (req, _res, next) => {
    const isAdminRole = req.user?.appMetadata?.role === "admin";
    const isAllowlisted = Boolean(req.user?.id && allowlist.has(req.user.id.toLowerCase()));
    if (!isAdminRole && !isAllowlisted) {
      throw new AppError(403, "FORBIDDEN", "Administrator access required.");
    }
    next();
  };
}

/**
 * Redacted operator job inspector (PRD §16.5):
 * Never returns prompts, learning plans, scenes, emails, or source filenames.
 */
export function createAdminRouter({ config, gateway, limiters, generation }) {
  const router = Router();
  router.use(requireAuth(gateway));
  router.use(requireAdmin(config));
  router.use(limiters.adminInspect);

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
