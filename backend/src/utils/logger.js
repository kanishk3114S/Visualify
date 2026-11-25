import pino from "pino";

/**
 * Paths redacted from every log line. Request/response headers are never
 * serialized at all (see serializers below); these redactions are a second
 * line of defence for anything a developer logs explicitly.
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
];

/** Strip the query string so tokens or PII in URLs can never be logged. */
function safePath(url = "") {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Minimal request/response serializers. Headers (Authorization, cookies),
 * query strings, bodies and remote ports are never logged. pino-http must be
 * given these explicitly - it does not inherit serializers from the logger.
 */
export const httpSerializers = Object.freeze({
  req: (req) => ({ id: req.id, method: req.method, path: safePath(req.url) }),
  res: (res) => ({ statusCode: res.statusCode }),
});

/**
 * @param {object} config validated config
 * @param {import("node:stream").Writable} [destination] optional sink (tests)
 */
export function createLogger(config, destination) {
  const options = {
    level: config.logLevel,
    base: { service: "visualify-api", env: config.nodeEnv },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    serializers: {
      err: pino.stdSerializers.err,
      ...httpSerializers,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
