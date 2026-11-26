/**
 * Shared graceful shutdown coordinator for both `server.js` (api/all) and
 * `worker.js` (worker). Stops accepting new work, lets active jobs drain up
 * to `graceMs` (SHUTDOWN_GRACE_MS), aborts remaining jobs + runs recovery sweep
 * on timeout, closes Redis handles cleanly, and exits.
 */
export function createGracefulShutdown({
  graceMs = 25_000,
  httpServer = null,
  generation = null,
  notes = null,
  redis = null,
  previewWorker = null,
  analyticsService = null,
  logger = null,
  onExit = (code) => process.exit(code),
} = {}) {
  let active = false;

  return async function shutdown(signal = "SIGTERM") {
    if (active) return;
    active = true;
    logger?.info({ signal, graceMs }, "shutting down gracefully");

    const closeServerPromise = new Promise((resolve) => {
      if (!httpServer?.close) return resolve();
      httpServer.close(() => resolve());
    });

    try {
      await generation?.queue?.pause?.();
      await previewWorker?.pause?.(true);
    } catch {
      /* best effort pause */
    }

    let timedOut = false;
    let timer = null;
    const drainPromise = Promise.allSettled([
      generation?.service?.onIdle?.() ?? Promise.resolve(),
      notes?.service?.onIdle?.() ?? Promise.resolve(),
      closeServerPromise,
      analyticsService?.flush?.() ?? Promise.resolve(),
    ]);

    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, graceMs);
      timer.unref?.();
    });

    await Promise.race([drainPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (timedOut) {
      logger?.warn({ graceMs }, "graceful shutdown timeout expired; aborting remaining work");
      try {
        await generation?.service?.shutdown?.();
        await generation?.service?.recoverInterruptedJobs?.();
      } catch {
        /* ignore recovery error during emergency exit */
      }
    } else {
      try {
        await generation?.service?.shutdown?.();
      } catch {
        /* ignore shutdown cleanup error */
      }
    }

    try {
      await previewWorker?.close?.();
      await redis?.quit?.();
    } catch {
      /* ignore */
    }

    onExit(timedOut ? 1 : 0);
  };
}
