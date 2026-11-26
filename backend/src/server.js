import { ensureProcessRoleConfig, loadConfig, loadEnvFiles } from "./config/env.js";
import { createApp } from "./app.js";
import { createLogger } from "./utils/logger.js";
import { createGracefulShutdown } from "./utils/shutdown.js";
import { loadWorkerEnv } from "@visualify/worker";

// backend/.env.local first; then backend/worker/.env.local for worker-only
// settings (GEMINI_API_KEY, GEMINI_MODEL, EXCALIDRAW_BROWSER_PATH) when
// running combined (`PROCESS_ROLE=all`). Neither file overrides real env vars.
loadEnvFiles();
loadWorkerEnv();

let config;
try {
  config = loadConfig();
  ensureProcessRoleConfig(config);
} catch (err) {
  // Message lists variable names only, never values.
  console.error(err.message);
  process.exit(1);
}

const logger = createLogger(config);
const app = createApp({ config, logger });

const { generation, notes, redis, analytics } = app.locals;

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      processRole: config.processRole,
      origins: config.frontendOrigins,
      generationEnabled: config.generation.enabled,
      queueMode: generation.mode ?? "in_process",
      model: config.generation.model,
    },
    "Visualify API listening"
  );
});

if (config.generation.enabled && config.processRole !== "api") {
  // Only combined (`all`) mode recovers orphaned rows here; `api` leaves recovery to `worker.js`.
  generation.service.recoverInterruptedJobs().catch((err) => logger.error({ err }, "interrupted-job recovery failed"));
} else if (!config.generation.enabled) {
  logger.warn("generation disabled: set SUPABASE_SERVICE_ROLE_KEY and GEMINI_API_KEY to enable it");
}

server.headersTimeout = 30_000;
server.requestTimeout = 60_000;

const shutdown = createGracefulShutdown({
  graceMs: config.shutdownGraceMs,
  httpServer: server,
  generation,
  notes,
  redis,
  analyticsService: analytics,
  logger,
});
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled rejection");
});
