import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { requestId } from "./middleware/requestId.js";
import { createRateLimiters } from "./middleware/rateLimit.js";
import { createErrorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createApiRouter } from "./routes/index.js";
import { createHealthController } from "./controllers/health.controller.js";
import { createLogger, httpSerializers } from "./utils/logger.js";
import { initApiSentry } from "./utils/sentry.js";
import { sendError } from "./utils/response.js";
import { createSupabaseGateway } from "./config/supabase.js";
import { createRedisClient } from "./config/redis.js";
import { createUsageService } from "./services/usageService.js";
import { createAccountService } from "./services/accountService.js";
import { createGenerationStack } from "./generation/index.js";
import { createNotesStack } from "./notes/index.js";

const ALLOWED_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];

/**
 * Express app factory. Does not listen, so tests can drive it with Supertest.
 * @param {object} options
 * @param {object} options.config  Validated config from loadConfig()
 * @param {object} [options.gateway] Supabase gateway (injectable for tests)
 * @param {object} [options.logger]  pino logger (injectable for tests)
 * @param {object} [options.redis]   Redis client (optional; defaults from config.redisUrl)
 * @param {object} [options.sentry]  Sentry handle (optional; defaults from config.sentryDsn)
 * @param {object} [options.usageService] Usage & quota service (injectable for tests)
 * @param {object} [options.accountService] Account lifecycle service (injectable for tests)
 * @param {object} [options.generation] { service, store, bus, queue } (injectable for tests)
 * @param {object} [options.notes] { service, contextFor } (injectable for tests)
 */
export function createApp({
  config,
  gateway = createSupabaseGateway(config),
  logger = createLogger(config),
  redis = createRedisClient(config.redisUrl, { logger }),
  limiters = createRateLimiters({ redis }),
  sentry = initApiSentry({ config, logger }),
  usageService = createUsageService({ config, adminDb: gateway.createAdminClient?.() ?? null, logger }),
  accountService = createAccountService({ gateway, logger }),
  generation = createGenerationStack({ config, gateway, logger, redis, usageService }),
  notes = createNotesStack({ config, gateway, generation, logger, usageService }),
}) {
  const app = express();
  const allowedOrigins = new Set(config.frontendOrigins);
  const healthController = createHealthController(gateway, { config, redis });

  app.disable("x-powered-by");
  // Only trust X-Forwarded-For from exactly one proxy hop, and only when configured.
  app.set("trust proxy", config.trustProxy ? 1 : false);

  app.use(requestId());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      quietReqLogger: true,
      serializers: httpSerializers,
      customProps: (req) => ({ userId: req.user?.id }),
    })
  );

  // Security headers on every response. The API only ever serves JSON, so the
  // CSP denies everything; it is the strictest form of the project baseline.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'none'"],
          "script-src": ["'none'"],
          "object-src": ["'none'"],
          "base-uri": ["'none'"],
          "form-action": ["'none'"],
          "frame-ancestors": ["'none'"],
        },
      },
      strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      xContentTypeOptions: true,
    })
  );

  // Responses carry per-user data and short-lived signed URLs: never cache.
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  // Probe endpoints (no rate limit, no secrets, never leak internals).
  app.get("/healthz", healthController.getLiveness);
  app.get("/readyz", healthController.getReadiness);

  // Explicit CORS allowlist. A browser request from any other origin is
  // rejected outright (not merely left without CORS headers).
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && !allowedOrigins.has(origin)) {
      return sendError(res, 403, "CORS_NOT_ALLOWED", "This origin is not allowed.");
    }
    next();
  });
  app.use(
    cors({
      origin: (origin, cb) => cb(null, origin ? allowedOrigins.has(origin) : false),
      methods: ALLOWED_METHODS,
      allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "RateLimit", "RateLimit-Policy", "Retry-After"],
      credentials: false,
      maxAge: 600,
    })
  );

  app.use("/api", limiters.api);

  app.use("/api/v1", createApiRouter({ config, gateway, limiters, generation, notes, usageService, accountService, redis }));
  app.locals.generation = generation;
  app.locals.notes = notes;
  app.locals.usage = usageService;
  app.locals.redis = redis;
  app.locals.sentry = sentry;

  app.use(notFoundHandler);
  app.use(createErrorHandler({ sentry }));

  return app;
}
