import * as Sentry from "@sentry/react";

const scrubText = (s) =>
  typeof s === "string"
    ? s
        .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]")
        .replace(/([?&](?:token|apikey|access_token)=)[^&\s]+/gi, "$1[REDACTED]")
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
    : s;

/** Optional frontend Sentry setup behind `VITE_SENTRY_DSN`; never sends PII. */
export function initFrontendSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn || import.meta.env.MODE === "test") return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    beforeSend(event) {
      if (!event) return event;
      const copy = { ...event };
      if (copy.user) copy.user = copy.user.id ? { id: String(copy.user.id) } : undefined;
      if (copy.request?.url) copy.request = { ...copy.request, url: scrubText(copy.request.url.split("?")[0]) };
      if (copy.message) copy.message = scrubText(copy.message);
      return copy;
    },
  });
}
