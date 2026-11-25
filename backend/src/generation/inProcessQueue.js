/**
 * Minimal in-process job queue: FIFO, global concurrency cap, one
 * AbortController per job. Implements the queue interface the generation
 * service depends on, so a BullMQ-backed queue can replace it later:
 *
 *   enqueue(jobId, handler)  handler(signal) => Promise<void>
 *   cancel(jobId)            -> "dequeued" | "aborted" | "unknown"
 *   isTracked(jobId)         -> boolean
 *   onIdle()                 -> Promise<void> (tests / graceful shutdown)
 *
 * Jobs live only in this process: a restart loses them, which is why the
 * service marks leftover active rows as INTERRUPTED on boot.
 */
export class InProcessQueue {
  constructor({ concurrency = 2, logger } = {}) {
    this.concurrency = concurrency;
    this.logger = logger;
    this.pending = []; // [{ jobId, handler }]
    this.running = new Map(); // jobId -> AbortController
    this.idleWaiters = [];
  }

  enqueue(jobId, handler) {
    if (this.isTracked(jobId)) return;
    this.pending.push({ jobId, handler });
    this.#drain();
  }

  cancel(jobId) {
    const index = this.pending.findIndex((p) => p.jobId === jobId);
    if (index !== -1) {
      this.pending.splice(index, 1);
      this.#notifyIdle();
      return "dequeued";
    }
    const controller = this.running.get(jobId);
    if (controller) {
      controller.abort(new Error("cancelled"));
      return "aborted";
    }
    return "unknown";
  }

  isTracked(jobId) {
    return this.running.has(jobId) || this.pending.some((p) => p.jobId === jobId);
  }

  get size() {
    return { pending: this.pending.length, running: this.running.size };
  }

  onIdle() {
    if (this.pending.length === 0 && this.running.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Aborts everything (graceful shutdown). */
  abortAll() {
    this.pending = [];
    for (const controller of this.running.values()) controller.abort(new Error("shutdown"));
  }

  #drain() {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const { jobId, handler } = this.pending.shift();
      const controller = new AbortController();
      this.running.set(jobId, controller);
      Promise.resolve()
        .then(() => handler(controller.signal))
        .catch((err) => this.logger?.error({ err, jobId }, "job handler crashed"))
        .finally(() => {
          this.running.delete(jobId);
          this.#drain();
          this.#notifyIdle();
        });
    }
  }

  #notifyIdle() {
    if (this.pending.length === 0 && this.running.size === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }
}
