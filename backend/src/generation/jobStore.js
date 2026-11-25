import { AppError } from "../utils/errors.js";
import { ACTIVE_STATUSES } from "./jobStates.js";

export const JOB_COLUMNS =
  "id, owner_id, input_type, input_text, settings, status, stage, progress, learning_plan, scene_json, mermaid_source, warnings, error_code, safe_error_message, model_id, prompt_version, usage, attempt_count, retry_of, created_at, started_at, finished_at, updated_at";

/** Lightweight columns for status checks (no plan/scene payloads). */
const STATUS_COLUMNS = "id, owner_id, status, stage, progress, attempt_count, input_text, settings, updated_at";

const PG_UNIQUE_VIOLATION = "23505";

export class ActiveJobExistsError extends Error {
  constructor() {
    super("An active generation job already exists for this user");
    this.code = "ACTIVE_JOB_EXISTS";
  }
}

function dbError(error) {
  return new AppError(502, "DATABASE_ERROR", "We couldn't complete that request. Please try again.", { cause: error });
}

/**
 * Supabase-backed job store.
 *
 * - Owner reads use the caller's RLS-scoped client (req.db) PLUS an explicit
 *   owner filter (defence in depth).
 * - Runner writes use the service-role client and ALWAYS filter by job id
 *   (and owner where an owner is known); conditional status filters make the
 *   state machine race-safe (e.g. a cancel can't be overwritten by "completed").
 */
export class SupabaseJobStore {
  /** @param {import("@supabase/supabase-js").SupabaseClient} admin service-role client */
  constructor(admin) {
    // admin may be null when no service-role key is configured: owner reads
    // (getJob) still work; runner writes are unavailable and generation is disabled.
    this._admin = admin ?? null;
  }

  get admin() {
    if (!this._admin) throw new Error("Generation job writes require SUPABASE_SERVICE_ROLE_KEY");
    return this._admin;
  }

  async insertJob({ ownerId, inputText, settings, retryOf = null, attemptCount = 1 }) {
    const { data, error } = await this.admin
      .from("generation_jobs")
      .insert({
        owner_id: ownerId,
        input_type: "prompt",
        input_text: inputText,
        settings,
        retry_of: retryOf,
        attempt_count: attemptCount,
      })
      .select(JOB_COLUMNS)
      .single();
    if (error?.code === PG_UNIQUE_VIOLATION) throw new ActiveJobExistsError();
    if (error) throw dbError(error);
    return data;
  }

  /** Owner-scoped read through the user's RLS client. Returns null if absent or not owned. */
  async getJob({ db, ownerId, jobId, columns = JOB_COLUMNS }) {
    const { data, error } = await db
      .from("generation_jobs")
      .select(columns)
      .eq("id", jobId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw dbError(error);
    return data;
  }

  async getJobStatus({ db, ownerId, jobId }) {
    return this.getJob({ db, ownerId, jobId, columns: STATUS_COLUMNS });
  }

  async findActiveJob(ownerId) {
    const { data, error } = await this.admin
      .from("generation_jobs")
      .select(STATUS_COLUMNS)
      .eq("owner_id", ownerId)
      .in("status", ACTIVE_STATUSES)
      .maybeSingle();
    if (error) throw dbError(error);
    return data;
  }

  /**
   * Conditional update by the runner. Returns the updated row, or null when
   * the job's status was no longer in `expectStatus` (lost a race).
   */
  async updateJob(jobId, patch, { expectStatus } = {}) {
    let query = this.admin.from("generation_jobs").update(patch).eq("id", jobId);
    if (expectStatus) query = query.in("status", expectStatus);
    const { data, error } = await query.select(STATUS_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data;
  }

  /** Marks every job left active by a previous process as interrupted. */
  async failInterruptedJobs({ code, message }) {
    const finishedAt = new Date().toISOString();
    // A job the user was already cancelling simply becomes cancelled.
    const cancelled = await this.admin
      .from("generation_jobs")
      .update({ status: "cancelled", stage: null, finished_at: finishedAt })
      .eq("status", "cancelling")
      .select("id");
    if (cancelled.error) throw dbError(cancelled.error);
    const failed = await this.admin
      .from("generation_jobs")
      .update({ status: "failed", error_code: code, safe_error_message: message, stage: null, finished_at: finishedAt })
      .in("status", ACTIVE_STATUSES.filter((s) => s !== "cancelling"))
      .select("id");
    if (failed.error) throw dbError(failed.error);
    return (cancelled.data?.length ?? 0) + (failed.data?.length ?? 0);
  }
}
