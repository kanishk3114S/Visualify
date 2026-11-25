import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for job progress events, consumed by SSE streams.
 * Swappable for Redis pub/sub when generation moves to a separate worker.
 */
export class JobEventBus {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0); // bounded per-user elsewhere
  }

  /** @param {string} jobId @param {{ type: string, data: object }} event */
  publish(jobId, event) {
    this.emitter.emit(`job:${jobId}`, event);
  }

  /** @returns {() => void} unsubscribe */
  subscribe(jobId, listener) {
    const key = `job:${jobId}`;
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }

  listenerCount(jobId) {
    return this.emitter.listenerCount(`job:${jobId}`);
  }
}
