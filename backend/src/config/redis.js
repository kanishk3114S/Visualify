import Redis from "ioredis";

/** Extracts host:port only for safe startup logs (never prints credentials/URL). */
export function describeRedisTarget(redisUrl) {
  try {
    const u = new URL(redisUrl);
    return `${u.hostname}:${u.port || "6379"}`;
  } catch {
    return "configured";
  }
}

/**
 * Creates a shared ioredis client when `REDIS_URL` is configured.
 * Uses `maxRetriesPerRequest: null` as required by BullMQ workers.
 */
export function createRedisClient(redisUrl, { logger } = {}) {
  if (!redisUrl) return null;
  const target = describeRedisTarget(redisUrl);
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on("ready", () => logger?.info({ redisTarget: target }, "Redis connected"));
  client.on("error", (err) => logger?.warn({ redisTarget: target, errorCode: err?.code ?? "REDIS_ERROR" }, "Redis error"));
  return client;
}
