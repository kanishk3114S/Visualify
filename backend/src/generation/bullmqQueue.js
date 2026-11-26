import { Queue, Worker } from "bullmq";

export const GENERATION_QUEUE_NAME = "visualify-generations";
export const CANCEL_CHANNEL = "visualify:generation:cancel";
export const EVENTS_CHANNEL = "visualify:generation:events";

/**
 * BullMQ-backed generation queue supporting split process roles:
 *
 * - `runWorker: false` (`PROCESS_ROLE=api`): enqueues jobs & publishes
 *   cancellations/receives cross-process SSE events ONLY (never instantiates Worker).
 * - `runWorker: true` (`PROCESS_ROLE=worker` or `all`): constructs Worker, runs
 *   dequeued jobs locally (resolving handlers via `handlers` or `recoverHandler`),
 *   listens for Redis `CANCEL_CHANNEL` broadcasts, and forwards SSE events back.
 */
export class BullMQGenerationQueue {
  constructor({
    connection,
    queueName = GENERATION_QUEUE_NAME,
    concurrency = 2,
    runWorker = true,
    logger,
    QueueClass = Queue,
    WorkerClass = Worker,
    subClient = null,
    recoverHandler = null,
    onRemoteEvent = null,
  } = {}) {
    if (!connection) throw new Error("BullMQGenerationQueue requires a Redis connection");
    this.connection = connection;
    this.queueName = queueName;
    this.concurrency = concurrency;
    this.runWorker = Boolean(runWorker);
    this.logger = logger;
    this.handlers = new Map(); // jobId -> handler(signal)
    this.running = new Map(); // jobId -> AbortController
    this.waiting = new Set(); // tracked local/queued jobIds
    this.idleWaiters = [];
    this.recoverHandler = recoverHandler;
    this.onRemoteEvent = onRemoteEvent;

    this.queue = new QueueClass(queueName, {
      connection,
      defaultJobOptions: {
        attempts: 1, // retries happen via explicit linked attempt rows + /retry endpoint
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    });

    this.worker = null;
    if (this.runWorker) {
      this.worker = new WorkerClass(
        queueName,
        async (bullJob) => {
          const jobId = bullJob.data?.jobId ?? bullJob.id;
          this.waiting.delete(jobId);
          const controller = new AbortController();
          this.running.set(jobId, controller);
          try {
            let handler = this.handlers.get(jobId);
            if (!handler && this.recoverHandler) {
              handler = await this.recoverHandler(jobId);
            }
            if (!handler) {
              this.logger?.warn({ jobId }, "no handler registered for dequeued BullMQ job");
              return;
            }
            await handler(controller.signal);
          } finally {
            this.handlers.delete(jobId);
            this.running.delete(jobId);
            this.#notifyIdle();
          }
        },
        { connection, concurrency }
      );

      this.worker.on("failed", (job, err) => {
        this.logger?.error({ jobId: job?.data?.jobId ?? job?.id, errorCode: err?.code ?? "WORKER_FAILED" }, "BullMQ worker job failed");
      });
    }

    this.subClient = subClient;
    if (this.subClient?.subscribe) {
      if (this.runWorker) {
        this.subClient.subscribe(CANCEL_CHANNEL).catch(() => {});
      }
      if (!this.runWorker && this.onRemoteEvent) {
        this.subClient.subscribe(EVENTS_CHANNEL).catch(() => {});
      }
      this.subClient.on?.("message", (channel, message) => {
        if (channel === CANCEL_CHANNEL && message) {
          const ctrl = this.running.get(message);
          if (ctrl) ctrl.abort(new Error("cancelled"));
        } else if (channel === EVENTS_CHANNEL && message && this.onRemoteEvent) {
          try {
            const evt = JSON.parse(message);
            if (evt?.jobId && evt?.type) this.onRemoteEvent(evt.jobId, { type: evt.type, data: evt.data });
          } catch {
            /* ignore malformed pub/sub message */
          }
        }
      });
    }
  }

  enqueue(jobId, handler) {
    if (this.isTracked(jobId)) return;
    this.handlers.set(jobId, handler);
    this.waiting.add(jobId);
    // BullMQ deduplicates by jobId so redelivery never enqueues duplicate work.
    this.queue.add("generate", { jobId }, { jobId }).catch((err) => {
      this.waiting.delete(jobId);
      this.handlers.delete(jobId);
      this.logger?.error({ err, jobId }, "failed to enqueue BullMQ job");
      this.#notifyIdle();
    });
  }

  async cancel(jobId) {
    const controller = this.running.get(jobId);
    if (controller) {
      controller.abort(new Error("cancelled"));
      return "aborted";
    }
    this.waiting.delete(jobId);
    this.handlers.delete(jobId);
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === "waiting" || state === "delayed" || state === "prioritized") {
          await job.remove();
          this.#notifyIdle();
          return "dequeued";
        }
        if (state === "active") {
          await this.connection.publish?.(CANCEL_CHANNEL, jobId);
          return "aborted";
        }
      }
    } catch (err) {
      this.logger?.warn({ jobId, errorCode: err?.code ?? "BULLMQ_CANCEL_WARN" }, "BullMQ cancel check failed");
    }
    this.#notifyIdle();
    return "unknown";
  }

  isTracked(jobId) {
    return this.running.has(jobId) || this.waiting.has(jobId);
  }

  get size() {
    return { pending: this.waiting.size, running: this.running.size };
  }

  onIdle() {
    if (this.waiting.size === 0 && this.running.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  publishEvent(jobId, type, data) {
    if (this.connection?.publish && this.runWorker) {
      this.connection.publish(EVENTS_CHANNEL, JSON.stringify({ jobId, type, data })).catch(() => {});
    }
  }

  async pause() {
    await this.worker?.pause?.(true);
  }

  abortAll() {
    this.waiting.clear();
    for (const ctrl of this.running.values()) ctrl.abort(new Error("shutdown"));
  }

  async close() {
    this.abortAll();
    await Promise.allSettled([this.worker?.close?.(), this.queue?.close?.(), this.subClient?.quit?.()]);
  }

  #notifyIdle() {
    if (this.waiting.size === 0 && this.running.size === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }
}
