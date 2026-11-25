import { AppError } from "../utils/errors.js";
import { ActiveJobExistsError } from "./jobStore.js";
import { ACTIVE_STATUSES, RUNNING_STATUSES, STAGE_PROGRESS, isTerminal, toSafeError } from "./jobStates.js";
import { runGenerationPipeline } from "./pipeline.js";

export const MAX_ATTEMPTS = 5;
/** An active row untouched for this long, and unknown to this process, is considered orphaned. */
export const STALE_ACTIVE_JOB_MS = 2 * 60 * 1000;

const now = () => new Date().toISOString();

/** Public job shape returned by the API (camelCase; no owner id, usage or internals). */
export function toJobDto(row) {
  return {
    jobId: row.id,
    status: row.status,
    stage: row.stage ?? null,
    progress: row.progress ?? 0,
    inputType: row.input_type ?? "prompt",
    prompt: row.input_text ?? null,
    settings: row.settings ?? {},
    safeError: row.error_code ? { code: row.error_code, message: row.safe_error_message } : null,
    learningPlan: row.learning_plan ?? null,
    sceneJson: row.scene_json ?? null,
    mermaidSource: row.mermaid_source ?? null,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    attemptCount: row.attempt_count ?? 1,
    retryOf: row.retry_of ?? null,
    createdAt: row.created_at ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
  };
}

/**
 * Orchestrates generation jobs: creation (1 active per user), queueing,
 * pipeline execution with persisted stage transitions, SSE events,
 * cancellation, retry and crash recovery.
 */
export function createGenerationService({ config, store, queue, bus, pipelineDeps, logger }) {
  const log = logger?.child ? logger.child({ component: "generation" }) : logger;

  function publish(jobId, type, data) {
    bus.publish(jobId, { type, data });
  }

  async function markCancelled(jobId) {
    const row = await store.updateJob(jobId, { status: "cancelled", stage: null, finished_at: now() }, { expectStatus: ACTIVE_STATUSES });
    if (row) publish(jobId, "cancelled", { status: "cancelled", progress: row.progress });
    return row;
  }

  async function markFailed(jobId, safe) {
    const row = await store.updateJob(
      jobId,
      { status: "failed", stage: null, error_code: safe.code, safe_error_message: safe.message, finished_at: now() },
      { expectStatus: ACTIVE_STATUSES }
    );
    if (row) publish(jobId, "failed", { status: "failed", progress: row.progress, error: { code: safe.code, message: safe.message } });
    return row;
  }

  async function execute(job, queueSignal) {
    const t0 = Date.now();
    const signal = AbortSignal.any([queueSignal, AbortSignal.timeout(config.generation.jobTimeoutMs)]);
    let lastProgress = job.progress ?? 0;
    let started = false;
    const ctx = { jobId: job.id, userId: job.owner_id };

    const onStage = async (stage, progress) => {
      lastProgress = Math.max(lastProgress, progress);
      const patch = { status: stage, stage, progress: lastProgress };
      if (!started) patch.started_at = now();
      const row = await store.updateJob(job.id, patch, { expectStatus: ["queued", ...RUNNING_STATUSES] });
      if (!row) throw Object.assign(new Error("job no longer runnable"), { code: "CANCELLED" });
      started = true;
      publish(job.id, "stage", { status: stage, stage, progress: lastProgress });
      log?.info({ ...ctx, stage }, "generation stage");
    };
    const onProgress = (progress) => {
      if (progress <= lastProgress) return;
      lastProgress = progress;
      publish(job.id, "progress", { progress });
    };

    try {
      const result = await runGenerationPipeline({ job, signal, onStage, onProgress, deps: pipelineDeps });
      await onStage("persisting", STAGE_PROGRESS.persisting);
      const row = await store.updateJob(
        job.id,
        {
          status: "completed",
          stage: null,
          progress: 100,
          learning_plan: result.plan,
          scene_json: result.scene,
          mermaid_source: result.mermaidSource,
          warnings: result.warnings,
          model_id: result.modelId,
          prompt_version: result.promptVersion,
          usage: result.usage,
          finished_at: now(),
        },
        { expectStatus: ["persisting"] }
      );
      if (!row) {
        // Cancelled while persisting: honour the cancel.
        await markCancelled(job.id);
        log?.info({ ...ctx, durationMs: Date.now() - t0 }, "generation cancelled");
        return;
      }
      publish(job.id, "completed", { status: "completed", progress: 100 });
      log?.info({ ...ctx, durationMs: Date.now() - t0, modelId: result.modelId }, "generation completed");
    } catch (err) {
      try {
        if (err?.code === "CANCELLED") {
          await markCancelled(job.id);
          log?.info({ ...ctx, durationMs: Date.now() - t0 }, "generation cancelled");
          return;
        }
        const safe = toSafeError(err);
        await markFailed(job.id, safe);
        log?.warn({ ...ctx, durationMs: Date.now() - t0, errorCode: safe.code, internalCode: safe.internalCode }, "generation failed");
      } catch (persistErr) {
        log?.error({ ...ctx, err: persistErr }, "could not persist generation outcome");
      }
    }
  }

  async function reclaimIfStale(ownerId) {
    const active = await store.findActiveJob(ownerId);
    if (!active) return true;
    const age = Date.now() - new Date(active.updated_at).getTime();
    if (queue.isTracked(active.id) || age < STALE_ACTIVE_JOB_MS) return false;
    const safe = toSafeError({ code: "INTERRUPTED" });
    await markFailed(active.id, safe);
    log?.warn({ jobId: active.id, userId: ownerId }, "reclaimed orphaned active job");
    return true;
  }

  return {
    get enabled() {
      return config.generation.enabled;
    },

    async createJob({ ownerId, prompt, settings, retryOf = null, attemptCount = 1 }) {
      const input = { ownerId, inputText: prompt, settings, retryOf, attemptCount };
      let job;
      try {
        job = await store.insertJob(input);
      } catch (err) {
        if (!(err instanceof ActiveJobExistsError)) throw err;
        const reclaimed = await reclaimIfStale(ownerId);
        const active = reclaimed ? null : await store.findActiveJob(ownerId);
        if (!reclaimed) {
          throw new AppError(409, "ACTIVE_JOB_EXISTS", "You already have a visual being generated. Wait for it to finish or cancel it.", {
            details: active ? { activeJobId: active.id } : null,
          });
        }
        job = await store.insertJob(input);
      }
      queue.enqueue(job.id, (signal) => execute(job, signal));
      log?.info({ jobId: job.id, userId: ownerId, stage: "queued" }, "generation queued");
      return job;
    },

    async cancelJob({ db, ownerId, jobId }) {
      const job = await store.getJobStatus({ db, ownerId, jobId });
      if (!job) return null;
      if (job.status === "cancelled") return { status: "cancelled" };
      if (isTerminal(job.status)) {
        throw new AppError(409, "JOB_ALREADY_FINISHED", "This generation has already finished and can't be cancelled.");
      }
      const outcome = queue.cancel(jobId);
      if (outcome === "aborted") {
        // The runner finalises to "cancelled" once the in-flight step stops.
        const row = await store.updateJob(jobId, { status: "cancelling", stage: "cancelling" }, { expectStatus: RUNNING_STATUSES });
        if (row) {
          publish(jobId, "stage", { status: "cancelling", stage: "cancelling", progress: row.progress });
          return { status: "cancelling" };
        }
        const latest = await store.getJobStatus({ db, ownerId, jobId });
        return { status: latest?.status ?? "cancelling" };
      }
      // Queued (removed before starting) or not running in this process: cancel now.
      const row = await markCancelled(jobId);
      if (row) return { status: "cancelled" };
      const latest = await store.getJobStatus({ db, ownerId, jobId });
      return { status: latest?.status ?? "cancelled" };
    },

    async retryJob({ db, ownerId, jobId }) {
      const job = await store.getJobStatus({ db, ownerId, jobId });
      if (!job) return null;
      if (!["failed", "cancelled"].includes(job.status)) {
        throw new AppError(409, "JOB_NOT_RETRYABLE", "Only failed or cancelled generations can be retried.");
      }
      if ((job.attempt_count ?? 1) >= MAX_ATTEMPTS) {
        throw new AppError(409, "RETRY_LIMIT_REACHED", "This generation has been retried too many times. Start a new one instead.");
      }
      return this.createJob({
        ownerId,
        prompt: job.input_text,
        settings: job.settings ?? {},
        retryOf: job.id,
        attemptCount: (job.attempt_count ?? 1) + 1,
      });
    },

    /** Single-instance assumption: on boot, nothing can still be running. */
    async recoverInterruptedJobs() {
      const { code, message } = toSafeError({ code: "INTERRUPTED" });
      const count = await store.failInterruptedJobs({ code, message });
      if (count > 0) log?.warn({ count }, "marked interrupted generation jobs");
      return count;
    },

    onIdle: () => queue.onIdle(),
    shutdown: () => queue.abortAll(),
  };
}
