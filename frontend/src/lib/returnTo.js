export const DEFAULT_RETURN_TO = "/app";

// Auth pages are never valid destinations (prevents redirect loops).
const BLOCKED_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/"];

/**
 * Returns a safe, same-origin, in-app path for post-login redirects, or the
 * fallback. Never trust a user-supplied returnTo (PRD 7.1). Rejects:
 *  - absolute / protocol-relative URLs (https://evil.com, //evil.com)
 *  - backslash tricks (/\evil.com is treated as //evil.com by browsers)
 *  - control characters (browsers strip tabs/newlines: "/\t/evil.com" -> "//evil.com")
 *  - any scheme (javascript:, data:)
 *  - anything that resolves to another origin
 *
 * @param {unknown} value
 * @param {{ origin?: string, fallback?: string }} [options]
 */
export function sanitizeReturnTo(value, { origin = globalThis.location?.origin, fallback = DEFAULT_RETURN_TO } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 || !origin) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  // Control characters U+0000-U+001F and U+007F
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return fallback;
  }

  let url;
  try {
    url = new URL(value, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(origin).origin) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;
  if (BLOCKED_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))) {
    return fallback;
  }
  return path;
}

const STORAGE_KEY = "visualify:returnTo";

/** Remembers a sanitized destination across an OAuth round-trip (same tab). */
export function rememberReturnTo(value) {
  try {
    sessionStorage.setItem(STORAGE_KEY, sanitizeReturnTo(value));
  } catch {
    /* storage unavailable (private mode) - fall back to the default route */
  }
}

/** Reads and clears the remembered destination; always re-sanitized. */
export function consumeReturnTo() {
  let stored = null;
  try {
    stored = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return sanitizeReturnTo(stored);
}
