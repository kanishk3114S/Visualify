import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { requestId } from "./middleware/requestId.js";
import { createRateLimiters } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createApiRouter } from "./routes/index.js";
import { createLogger, httpSerializers } from "./utils/logger.js";
import { sendError } from "./utils/response.js";
import { createSupabaseGateway } from "./config/supabase.js";
import { createGenerationStack } from "./generation/index.js";
import { createNotesStack } from "./notes/index.js";

const ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE"];

/**
 * Express app factory. Does not listen, so tests can drive it with Supertest.
 * @param {object} options
 * @param {object} options.config  Validated config from loadConfig()
 * @param {object} [options.gateway] Supabase gateway (injectable for tests)
 * @param {object} [options.logger]  pino logger (injectable for tests)
 * @param {object} [options.generation] { service, store, bus } (injectable for tests)
 * @param {object} [options.notes] { service, contextFor } (injectable for tests)
 */
export function createApp({
  config,
  gateway = createSupabaseGateway(config),
  logger = createLogger(config),
  generation = createGenerationStack({ config, gateway, logger }),
  notes = createNotesStack({ config, gateway, generation, logger }),
}) {
  const app = express();
  const allowedOrigins = new Set(config.frontendOrigins);
  const limiters = createRateLimiters();

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

  app.use("/api/v1", createApiRouter({ config, gateway, limiters, generation, notes }));
  app.locals.generation = generation;
  app.locals.notes = notes;

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
