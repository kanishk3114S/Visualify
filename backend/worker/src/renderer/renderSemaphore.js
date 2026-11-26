import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Process-wide bounded semaphore for @excalidraw/cli child processes
 * (pipeline Mermaid compilation, PNG/SVG exports, ZIP slides, and note previews).
 *
 * Uses AsyncLocalStorage reentrancy tracking so when an outer caller
 * (e.g. pipeline.js or notes/renderer.js) already holds a slot for a section
 * or export, nested `runCliCommand` calls inside the same async chain reuse
 * that slot without double-counting or deadlocking.
 */
export function createRenderSemaphore(initialLimit = 2) {
  let maxConcurrent = normalizeLimit(initialLimit);
  let active = 0;
  const waiters = [];
  const token = Symbol("render-semaphore-slot");
  const storage = new AsyncLocalStorage();

  function normalizeLimit(value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 1 || num > 8) {
      throw new Error(`Render concurrency must be an integer between 1 and 8 (got ${value})`);
    }
    return num;
  }

  function dispatchNext() {
    while (active < maxConcurrent && waiters.length > 0) {
      const next = waiters.shift();
      if (!next.cancelled) {
        active += 1;
        next.resolve();
        return;
      }
    }
  }

  function acquire(signal) {
    if (signal?.aborted) {
      const err = new Error("Aborted before acquiring render slot");
      err.name = "AbortError";
      return Promise.reject(err);
    }
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry = { cancelled: false, resolve: null };
      const onAbort = () => {
        if (entry.cancelled) return;
        entry.cancelled = true;
        const idx = waiters.indexOf(entry);
        if (idx !== -1) waiters.splice(idx, 1);
        const err = new Error("Aborted while waiting for render slot");
        err.name = "AbortError";
        reject(err);
      };
      entry.resolve = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      waiters.push(entry);
    });
  }

  function release() {
    active = Math.max(0, active - 1);
    dispatchNext();
  }

  return {
    get limit() {
      return maxConcurrent;
    },
    setLimit(nextLimit) {
      maxConcurrent = normalizeLimit(nextLimit);
      dispatchNext();
    },
    getStats() {
      return { active, queued: waiters.filter((w) => !w.cancelled).length, limit: maxConcurrent };
    },
    async run(fn, { signal } = {}) {
      if (storage.getStore() === token) {
        return fn();
      }
      await acquire(signal);
      try {
        return await storage.run(token, fn);
      } finally {
        release();
      }
    },
  };
}

export const globalRenderSemaphore = createRenderSemaphore(
  (() => {
    const parsed = Number(process.env.RENDER_CONCURRENCY);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 2;
  })()
);

export function configureRenderConcurrency(limit) {
  globalRenderSemaphore.setLimit(limit);
  return globalRenderSemaphore;
}
