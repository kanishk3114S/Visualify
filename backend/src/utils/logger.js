import pino from "pino";

/**
 * Paths redacted from every log line. Request/response headers are never
 * serialized at all; these redactions are defence in depth against logging
 * credentials, tokens, signed URLs, prompts, extracted text, or emails.
 */
export const REDACT_PATHS = [
  "authorization",
  "*.authorization",
  "headers.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "access_token",
  "*.access_token",
  "refresh_token",
  "*.refresh_token",
  "jwt",
  "*.jwt",
  "password",
  "*.password",
  "email",
  "*.email",
  "signedUrl",
  "*.signedUrl",
  "signedURL",
  "*.signedURL",
  "avatar_url",
  "*.avatar_url",
  "apikey",
  "*.apikey",
  "secret",
  "*.secret",
  "prompt",
  "*.prompt",
  "inputText",
  "*.inputText",
  "input_text",
  "*.input_text",
  "extractedText",
  "*.extractedText",
  "sourceText",
  "*.sourceText",
  "rawError",
  "*.rawError",
  "geminiKey",
  "*.geminiKey",
  "GEMINI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REDIS_URL",
  "SENTRY_DSN",
  "redisUrl",
  "sentryDsn",
  "serviceRoleKey",
];

/** Scrubs JWTs, API keys, Redis creds, signed URLs, and emails from arbitrary strings. */
export function scrubSensitiveText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/g, "[REDACTED_SUPABASE_KEY]")
    .replace(/rediss?:\/\/[^@\s"']+@/gi, "redis://[REDACTED]@")
    .replace(/https?:\/\/[^\s"']*\/storage\/v1\/object\/sign\/[^\s"']+/gi, "[REDACTED_SIGNED_URL]")
    .replace(/([?&](?:token|apikey|access_token|key|sig)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
}

function scrubLogValue(val, depth = 0) {
  if (val == null || depth > 4) return val;
  if (typeof val === "string") return scrubSensitiveText(val);
  if (Array.isArray(val)) return val.map((item) => scrubLogValue(item, depth + 1));
  if (typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (typeof v === "string") out[k] = scrubSensitiveText(v);
      else if (v && typeof v === "object") out[k] = scrubLogValue(v, depth + 1);
      else out[k] = v;
    }
    return out;
  }
  return val;
}

/** Strip the query string so tokens or PII in URLs can never be logged. */
function safePath(url = "") {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Minimal request/response serializers. Headers (Authorization, cookies),
 * query strings, bodies and remote ports are never logged.
 */
export const httpSerializers = Object.freeze({
  req: (req) => ({ id: req.id, method: req.method, path: safePath(req.url) }),
  res: (res) => ({ statusCode: res.statusCode }),
});

function safeErrorSerializer(err) {
  const base = pino.stdSerializers.err(err);
  if (!base) return base;
  return {
    ...base,
    message: scrubSensitiveText(base.message),
    stack: scrubSensitiveText(base.stack),
  };
}

/**
 * @param {object} config validated config
 * @param {import("node:stream").Writable} [destination] optional sink (tests)
 */
export function createLogger(config, destination) {
  const options = {
    level: config.logLevel,
    base: { service: "visualify-api", env: config.nodeEnv },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    formatters: {
      log: (obj) => scrubLogValue(obj),
    },
    serializers: {
      err: safeErrorSerializer,
      ...httpSerializers,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
