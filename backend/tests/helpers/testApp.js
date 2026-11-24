import { Writable } from "node:stream";
import { loadConfig } from "../../src/config/env.js";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/utils/logger.js";
import { createFakeSupabase } from "./fakeSupabase.js";

export const ALLOWED_ORIGIN = "http://localhost:5173";

export const BASE_ENV = Object.freeze({
  NODE_ENV: "test",
  PORT: "5000",
  FRONTEND_ORIGIN: ALLOWED_ORIGIN,
  SUPABASE_URL: "https://unit-test-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test_key_000000",
  AVATAR_MAX_BYTES: "2097152",
  AVATAR_SIGNED_URL_TTL_SECONDS: "300",
});

/**
 * Builds an app wired to the fake Supabase gateway with a capturing logger,
 * so tests can assert on exactly what would be written to production logs.
 */
export function buildTestApp(envOverrides = {}) {
  const config = loadConfig({ ...BASE_ENV, ...envOverrides });
  const fake = createFakeSupabase();
  const logLines = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      logLines.push(chunk.toString());
      cb();
    },
  });
  const logger = createLogger({ ...config, logLevel: "debug" }, sink);
  const app = createApp({ config, gateway: fake.gateway, logger });
  return { app, config, ...fake, logLines, logText: () => logLines.join("") };
}
