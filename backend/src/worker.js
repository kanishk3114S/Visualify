import http from "node:http";
import { Worker as BullWorker } from "bullmq";
import { loadWorkerEnv } from "@visualify/worker";
import { ensureProcessRoleConfig, loadConfig, loadEnvFiles } from "./config/env.js";
import { createSupabaseGateway } from "./config/supabase.js";
import { createRedisClient } from "./config/redis.js";
import { createLogger } from "./utils/logger.js";
import { createUsageService } from "./services/usageService.js";
import { createAnalyticsService } from "./services/analyticsService.js";
import { createGenerationStack } from "./generation/index.js";
import { PREVIEW_QUEUE_NAME, runNotePreviewJob } from "./notes/index.js";
import { createHealthController } from "./controllers/health.controller.js";
import { createGracefulShutdown } from "./utils/shutdown.js";

/**
 * Starts the standalone worker runtime (`PROCESS_ROLE=worker`).
 * Separated cleanly as a factory so tests can exercise boot checks, preview
 * execution, health probes, and graceful shutdown without spawning a subprocess.
 */
export function createWorkerRuntime({
  config,
  gateway = createSupabaseGateway(config),
  redis = createRedisClient(config.redisUrl, { logger: createLogger(config) }),
  logger = createLogger(config),
  generation = null,
  WorkerClass = BullWorker,
} = {}) {
  ensureProcessRoleConfig(config);
  if (config.processRole === "api") {
    throw new Error("worker.js cannot start with PROCESS_ROLE=api");
  }

  const adminDb = gateway.createAdminClient?.() ?? null;
  const usageService = createUsageService({ config, adminDb, logger });
  const analyticsService = createAnalyticsService({ config, adminDb, logger });
  const genStack =
    generation ??
    createGenerationStack({ config, gateway, logger, redis, usageService, analyticsService });

  // Preview rendering queue consumer (offloads background note thumbnail renders from API role).
  let previewWorker = null;
  if (redis) {
    previewWorker = new WorkerClass(
      PREVIEW_QUEUE_NAME,
      async (job) => runNotePreviewJob({ adminDb, config, payload: job.data, logger }),
      { connection: redis, concurrency: Math.min(2, config.generation.renderConcurrency ?? 2) }
    );
    previewWorker.on?.("failed", (job, err) => {
      logger?.warn({ jobId: job?.id, errorCode: err?.code ?? "PREVIEW_WORKER_FAILED" }, "preview worker job failed");
    });
  }

  const healthController = createHealthController(gateway, { config, redis });
  const healthServer = http.createServer(async (req, res) => {
    const capture = {
      statusCode: 200,
      headers: {},
      set(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        res.writeHead(this.statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store", ...this.headers });
        res.end(JSON.stringify(payload));
      },
    };
    const urlPath = (req.url || "/").split("?")[0];
    if (req.method === "GET" && urlPath === "/healthz") {
      healthController.getLiveness(req, capture);
      return;
    }
    if (req.method === "GET" && urlPath === "/readyz") {
      await healthController.getReadiness(req, capture);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }));
  });

  return {
    generation: genStack,
    previewWorker,
    healthServer,
    analyticsService,
    async start() {
      await new Promise((resolve) => {
        healthServer.listen(config.workerHealthPort, () => resolve());
      });
      logger.info(
        {
          processRole: config.processRole,
          workerHealthPort: config.workerHealthPort,
          queueMode: genStack.mode,
          model: config.generation.model,
        },
        "Visualify Worker listening"
      );
      if (config.generation.enabled) {
        await genStack.service.recoverInterruptedJobs();
      } else {
        logger.warn("generation disabled in worker: missing GEMINI_API_KEY or SUPABASE_SERVICE_ROLE_KEY");
      }
    },
    async stop(onExit = () => {}) {
      const shutdown = createGracefulShutdown({
        graceMs: config.shutdownGraceMs,
        httpServer: healthServer,
        generation: genStack,
        redis,
        previewWorker,
        analyticsService,
        logger,
        onExit,
      });
      await shutdown("SIGTERM");
    },
  };
}

// Execute CLI entrypoint only when invoked directly (`node backend/src/worker.js`)
const isDirect = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isDirect) {
  loadEnvFiles();
  loadWorkerEnv();
  if (!process.env.PROCESS_ROLE) process.env.PROCESS_ROLE = "worker";

  let config;
  try {
    config = loadConfig();
    ensureProcessRoleConfig(config);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const logger = createLogger(config);
  const runtime = createWorkerRuntime({ config, logger });
  runtime.start().catch((err) => {
    logger.error({ err }, "worker startup failed");
    process.exit(1);
  });

  process.on("SIGTERM", () => runtime.stop((code) => process.exit(code)));
  process.on("SIGINT", () => runtime.stop((code) => process.exit(code)));
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "worker unhandled rejection");
  });
}
