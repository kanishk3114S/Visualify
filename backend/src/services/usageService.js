import { randomUUID } from "node:crypto";
import { AppError } from "../utils/errors.js";

export const BILLABLE_EVENT_TYPES = Object.freeze([
  "generation",
  "generation_create",
  "generation_retry",
  "explain_node",
  "quiz",
  "flashcards",
  "revision",
  "ask_note",
  "section_regenerate",
]);

const ALLOWED_META_KEYS = new Set([
  "noteId",
  "jobId",
  "modelId",
  "inputType",
  "format",
  "scope",
  "slideFormat",
  "difficulty",
  "count",
  "sectionId",
  "elementCount",
  "status",
  "retryOf",
]);

/** Returns UTC calendar month boundaries [periodStart, resetsAt) as ISO strings. */
export function currentUtcMonthBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { periodStart: start.toISOString(), resetsAt: resets.toISOString() };
}

/** Strips any unexpected keys so prompts, titles, filenames and emails never land in usage_events. */
export function sanitizeUsageMetadata(raw = {}) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_META_KEYS.has(k) || v === undefined || v === null) continue;
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/**
 * Fail-closed usage metering and monthly quota enforcement service.
 * Enforces `GENERATION_LIMIT_MONTHLY` BEFORE any Gemini model call is made.
 */
export function createUsageService({ config, adminDb = null, logger = null, memoryEvents = null }) {
  const limit = Number(config?.generationLimitMonthly ?? 50);
  const isProd = Boolean(config?.isProduction);
  let warnedDevBypass = false;

  function ensureServerMeteringAvailable() {
    if (adminDb || memoryEvents) return true;
    if (isProd) {
      throw new AppError(503, "METERING_UNAVAILABLE", "Usage metering service is unavailable.");
    }
    if (!warnedDevBypass) {
      warnedDevBypass = true;
      logger?.warn("usage metering degraded in non-production: SUPABASE_SERVICE_ROLE_KEY not configured");
    }
    return false;
  }

  return {
    limit,

    async consumeQuota({ userId, eventType, units = 1, metadata = {} }) {
      const cleanMeta = sanitizeUsageMetadata(metadata);
      const { periodStart, resetsAt } = currentUtcMonthBounds();
      if (!ensureServerMeteringAvailable()) {
        return { allowed: true, limit, used: 0, resetsAt, eventId: null };
      }

      if (memoryEvents) {
        const used = memoryEvents
          .filter(
            (e) =>
              e.owner_id === userId &&
              BILLABLE_EVENT_TYPES.includes(e.event_type) &&
              e.created_at >= periodStart &&
              e.created_at < resetsAt
          )
          .reduce((acc, e) => acc + (e.units ?? 1), 0);
        if (used + units > limit) {
          throw new AppError(429, "QUOTA_EXCEEDED", "Monthly AI generation quota reached. Your allowance resets next month.", {
            details: { limit, used, resetsAt },
          });
        }
        const row = {
          id: randomUUID(),
          owner_id: userId,
          event_type: eventType,
          units,
          metadata: cleanMeta,
          created_at: new Date().toISOString(),
        };
        memoryEvents.push(row);
        return { allowed: true, limit, used: used + units, resetsAt, eventId: row.id };
      }

      const { data, error } = await adminDb.rpc("consume_monthly_quota", {
        p_owner_id: userId,
        p_event_type: eventType,
        p_limit: limit,
        p_billable_types: BILLABLE_EVENT_TYPES,
        p_units: units,
        p_metadata: cleanMeta,
      });
      if (error) {
        logger?.error({ userId, eventType, errorCode: error.code ?? "QUOTA_RPC_FAILED" }, "quota RPC failed (failing closed)");
        throw new AppError(503, "METERING_UNAVAILABLE", "Usage metering is temporarily unavailable. Please try again.");
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.allowed === false) {
        throw new AppError(429, "QUOTA_EXCEEDED", "Monthly AI generation quota reached. Your allowance resets next month.", {
          details: {
            limit: Number(row?.limit ?? limit),
            used: Number(row?.used ?? limit),
            resetsAt: row?.resets_at ? new Date(row.resets_at).toISOString() : resetsAt,
          },
        });
      }
      return {
        allowed: true,
        limit: Number(row.limit ?? limit),
        used: Number(row.used ?? 0),
        resetsAt: row.resets_at ? new Date(row.resets_at).toISOString() : resetsAt,
        eventId: row.event_id ?? null,
      };
    },

    async recordExport({ userId, metadata = {} }) {
      const cleanMeta = sanitizeUsageMetadata(metadata);
      if (!ensureServerMeteringAvailable()) return null;
      if (memoryEvents) {
        const row = {
          id: randomUUID(),
          owner_id: userId,
          event_type: "export",
          units: 1,
          metadata: cleanMeta,
          created_at: new Date().toISOString(),
        };
        memoryEvents.push(row);
        return row;
      }
      const { error } = await adminDb.from("usage_events").insert({
        owner_id: userId,
        event_type: "export",
        units: 1,
        metadata: cleanMeta,
      });
      if (error) {
        logger?.error({ userId, errorCode: error.code ?? "EXPORT_USAGE_INSERT_FAILED" }, "export usage metering failed");
        if (isProd) {
          throw new AppError(503, "METERING_UNAVAILABLE", "Usage metering is temporarily unavailable.");
        }
      }
      return null;
    },

    async getMonthlyUsage({ db, userId }) {
      const { periodStart, resetsAt } = currentUtcMonthBounds();
      let rows = [];
      if (memoryEvents) {
        rows = memoryEvents.filter((e) => e.owner_id === userId && e.created_at >= periodStart && e.created_at < resetsAt);
      } else if (db?.from) {
        const { data, error } = await db
          .from("usage_events")
          .select("event_type, units, created_at")
          .eq("owner_id", userId)
          .gte("created_at", periodStart)
          .lt("created_at", resetsAt);
        if (error) {
          logger?.warn({ userId, errorCode: error.code ?? "USAGE_READ_WARN" }, "failed reading usage summary");
        } else {
          rows = data ?? [];
        }
      }
      let used = 0;
      let generations = 0;
      let companion = 0;
      let exportsCount = 0;
      for (const r of rows) {
        const units = Number(r.units ?? 1);
        if (r.event_type === "export") {
          exportsCount += units;
        } else if (BILLABLE_EVENT_TYPES.includes(r.event_type)) {
          used += units;
          if (["generation", "generation_create", "generation_retry"].includes(r.event_type)) generations += units;
          else companion += units;
        }
      }
      return {
        periodStart,
        resetsAt,
        limit,
        used,
        remaining: Math.max(0, limit - used),
        breakdown: { generations, companion, exports: exportsCount },
      };
    },
  };
}
