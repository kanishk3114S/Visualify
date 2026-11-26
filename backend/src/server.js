import { ensureProductionServiceRole, loadConfig, loadEnvFiles } from "./config/env.js";
import { createApp } from "./app.js";
import { createLogger } from "./utils/logger.js";
import { loadWorkerEnv } from "@visualify/worker";

// backend/.env.local first; then backend/worker/.env.local for worker-only
// settings (GEMINI_API_KEY, GEMINI_MODEL, EXCALIDRAW_BROWSER_PATH) because the
// generation worker runs in-process. Neither file overrides real env vars.
loadEnvFiles();
loadWorkerEnv();

let config;
try {
  config = loadConfig();
  ensureProductionServiceRole(config);
} catch (err) {
  // Message lists variable names only, never values.
  console.error(err.message);
  process.exit(1);
}

const logger = createLogger(config);
const app = createApp({ config, logger });

const { generation, redis } = app.locals;

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      origins: config.frontendOrigins,
      generationEnabled: config.generation.enabled,
      queueMode: generation.mode ?? "in_process",
      model: config.generation.model,
    },
    "Visualify API listening"
  );
});

if (config.generation.enabled) {
  // Recover orphaned rows left active by a previous process crash.
  generation.service.recoverInterruptedJobs().catch((err) => logger.error({ err }, "interrupted-job recovery failed"));
} else {
  logger.warn("generation disabled: set SUPABASE_SERVICE_ROLE_KEY and GEMINI_API_KEY to enable it");
}

server.headersTimeout = 30_000;
server.requestTimeout = 60_000;

async function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  try {
    await generation.service.shutdown();
    await redis?.quit?.();
  } catch {
    /* ignore shutdown cleanup errors */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled rejection");
});
