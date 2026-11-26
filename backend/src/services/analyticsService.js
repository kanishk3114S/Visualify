import { randomUUID } from "node:crypto";

/** Exact 14 PRD §14.3 product event names & strictly non-PII property allowlists. */
export const PRODUCT_EVENT_ALLOWLIST = Object.freeze({
  auth_signup_completed: new Set(["provider"]),
  onboarding_completed: new Set(["stepCount"]),
  generation_started: new Set(["jobId", "inputType", "detail", "visualStyle", "attemptCount", "isRetry"]),
  generation_stage_changed: new Set(["jobId", "stage"]),
  generation_completed: new Set([
    "jobId",
    "durationMs",
    "plannerLatencyMs",
    "model",
    "failedOver",
    "repaired",
    "sectionsComposed",
    "promptTokens",
    "outputTokens",
    "totalTokens",
  ]),
  generation_failed: new Set(["jobId", "durationMs", "errorCode"]),
  note_saved: new Set(["noteId", "jobId", "sourceType"]),
  note_opened: new Set(["noteId"]),
  note_edited: new Set(["noteId", "revision"]),
  note_version_restored: new Set(["noteId", "versionId"]),
  note_exported: new Set(["noteId", "format", "scope"]),
  folder_created: new Set(["folderId", "hasParent"]),
  source_deleted: new Set(["sourceFileId", "mimeType"]),
  account_deleted: new Set(["removedObjects"]),
});

const PII_VALUE_RE = /@|:\/\/|<untrusted_|Bearer\s+|eyJ[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{12,}/i;
const NOTE_DEBOUNCE_MS = 30 * 60 * 1000;
const MAX_PENDING_QUEUE = 500;
const MAX_DEBOUNCE_ENTRIES = 2000;

/**
 * Sanitizes event properties against the event's strict allowlist and drops any
 * string containing emails, URLs, tokens, or prompt-length content (> 80 chars).
 */
export function sanitizeEventProperties(eventName, raw = {}) {
  const allowed = PRODUCT_EVENT_ALLOWLIST[eventName];
  if (!allowed || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const clean = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!allowed.has(k) || v === undefined || v === null) continue;
    if (typeof v === "boolean") {
      clean[k] = v;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      clean[k] = v;
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      if (!trimmed || trimmed.length > 80 || PII_VALUE_RE.test(trimmed)) continue;
      clean[k] = trimmed;
    }
  }
  return clean;
}

/**
 * Fire-and-forget server-side product analytics recorder (PRD §14.1 & §14.3).
 * Never throws into request handlers, enforces zero PII, debounces note_opened &
 * note_edited per user+note window, and drops with one warning in dev without service role.
 */
export function createAnalyticsService({ config = null, adminDb = null, logger = null, memoryEvents = null, debounceMs = NOTE_DEBOUNCE_MS } = {}) {
  let warnedNoServiceRole = false;
  let flushScheduled = false;
  const queue = [];
  const openedWindow = new Map();
  const editedWindow = new Map();

  function pruneWindow(map, nowMs) {
    if (map.size < MAX_DEBOUNCE_ENTRIES) return;
    for (const [key, ts] of map.entries()) {
      if (nowMs - ts >= debounceMs) map.delete(key);
    }
    if (map.size >= MAX_DEBOUNCE_ENTRIES) {
      map.clear();
    }
  }

  function shouldEmitDebounced(map, key, nowMs) {
    const prev = map.get(key);
    if (prev !== undefined && nowMs - prev < debounceMs) return false;
    pruneWindow(map, nowMs);
    map.set(key, nowMs);
    return true;
  }

  async function flushQueue() {
    flushScheduled = false;
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    if (memoryEvents) {
      memoryEvents.push(...batch);
      return;
    }
    if (!adminDb) return;
    try {
      const { error } = await adminDb.from("product_events").insert(
        batch.map((row) => ({
          id: row.id,
          owner_id: row.owner_id,
          event_name: row.event_name,
          properties: row.properties,
          created_at: row.created_at,
        }))
      );
      if (error) {
        logger?.warn({ errorCode: error.code ?? "ANALYTICS_INSERT_FAILED", count: batch.length }, "product_events insert failed");
      }
    } catch (err) {
      logger?.warn({ errorCode: err?.code ?? "ANALYTICS_WRITE_ERROR" }, "product_events flush error");
    }
  }

  return {
    record(eventName, ownerId = null, props = {}) {
      try {
        const cleanProps = sanitizeEventProperties(eventName, props);
        if (!cleanProps) return false;

        if (!adminDb && !memoryEvents) {
          if (!warnedNoServiceRole && !config?.isProduction) {
            warnedNoServiceRole = true;
            logger?.warn("product analytics degraded in non-production: SUPABASE_SERVICE_ROLE_KEY not configured");
          }
          return false;
        }

        const nowMs = Date.now();
        if (eventName === "note_opened" && ownerId && cleanProps.noteId) {
          if (!shouldEmitDebounced(openedWindow, `${ownerId}:${cleanProps.noteId}`, nowMs)) return false;
        }
        if (eventName === "note_edited" && ownerId && cleanProps.noteId) {
          if (!shouldEmitDebounced(editedWindow, `${ownerId}:${cleanProps.noteId}`, nowMs)) return false;
        }

        if (queue.length >= MAX_PENDING_QUEUE) {
          queue.shift();
        }
        queue.push({
          id: randomUUID(),
          owner_id: eventName === "account_deleted" ? null : ownerId ?? null,
          event_name: eventName,
          properties: cleanProps,
          created_at: new Date(nowMs).toISOString(),
        });

        if (!flushScheduled) {
          flushScheduled = true;
          queueMicrotask(() => {
            flushQueue().catch(() => {});
          });
        }
        return true;
      } catch {
        return false;
      }
    },

    async flush() {
      await flushQueue();
    },

    get queueSize() {
      return queue.length;
    },
  };
}
