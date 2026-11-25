/**
 * Theme state helpers (pure, unit-tested). The same storage key and resolution
 * rules are used by the pre-paint script in index.html, so the first paint and
 * React always agree (no flash of the wrong theme).
 */
export const THEME_STORAGE_KEY = "visualify:theme";
export const THEME_MODES = Object.freeze(["light", "dark", "system"]);
export const DEFAULT_THEME_MODE = "system";

export const isThemeMode = (value) => THEME_MODES.includes(value);

/** Reads the stored mode; falls back to "system" for missing/invalid values or blocked storage. */
export function readStoredMode(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

export function storeMode(mode, storage = globalThis.localStorage) {
  if (!isThemeMode(mode)) return;
  try {
    storage?.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* storage unavailable (private mode): theme still applies for this session */
  }
}

/** "system" follows the OS preference; explicit modes win. */
export function resolveTheme(mode, prefersDark) {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return prefersDark ? "dark" : "light";
}

/** Applies the resolved theme to <html> (class, color-scheme, data attribute). */
export function applyTheme(resolved, doc = globalThis.document) {
  const root = doc?.documentElement;
  if (!root) return;
  const dark = resolved === "dark";
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  root.dataset.theme = resolved;
}
