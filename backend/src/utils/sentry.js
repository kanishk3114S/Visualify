import * as Sentry from "@sentry/node";
import { scrubSensitiveText } from "./logger.js";

/** Deep string/PII scrubber for Sentry events before transmission. */
export function scrubSentryEvent(event) {
  if (!event || typeof event !== "object") return event;
  const copy = structuredClone(event);
  if (copy.request) {
    delete copy.request.cookies;
    delete copy.request.data;
    if (copy.request.headers) {
      delete copy.request.headers.authorization;
      delete copy.request.headers.cookie;
      delete copy.request.headers["x-supabase-auth"];
    }
    if (typeof copy.request.url === "string") {
      copy.request.url = scrubSensitiveText(copy.request.url.split("?")[0]);
    }
    delete copy.request.query_string;
  }
  if (copy.user) {
    copy.user = copy.user.id ? { id: String(copy.user.id) } : undefined;
  }
  if (copy.extra) {
    for (const key of Object.keys(copy.extra)) {
      if (/prompt|text|email|token|secret|key|url|password/i.test(key)) {
        copy.extra[key] = "[REDACTED]";
      } else if (typeof copy.extra[key] === "string") {
        copy.extra[key] = scrubSensitiveText(copy.extra[key]);
      }
    }
  }
  if (copy.message) copy.message = scrubSensitiveText(copy.message);
  if (copy.exception?.values) {
    for (const ex of copy.exception.values) {
      if (typeof ex.value === "string") ex.value = scrubSensitiveText(ex.value);
    }
  }
  return copy;
}

/**
 * Optional Sentry initialization for the Express API. Disabled cleanly when
 * `SENTRY_DSN` is unset. Never sends default PII.
 */
export function initApiSentry({ config, logger }) {
  if (!config?.sentryDsn) {
    return { enabled: false, captureException: () => {} };
  }
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  });
  logger?.info("Sentry error reporting enabled (PII scrubbing active)");
  return {
    enabled: true,
    captureException(err, { requestId, userId, code } = {}) {
      Sentry.withScope((scope) => {
        if (requestId) scope.setTag("requestId", requestId);
        if (code) scope.setTag("errorCode", code);
        if (userId) scope.setUser({ id: String(userId) });
        Sentry.captureException(err);
      });
    },
  };
}
