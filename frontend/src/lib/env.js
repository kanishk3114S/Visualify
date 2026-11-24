/**
 * Public, browser-safe configuration only. Vite inlines every VITE_* value
 * into the bundle, so NOTHING secret may ever be read here.
 */
const raw = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
};

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const problems = [];
if (!isHttpUrl(raw.VITE_SUPABASE_URL)) problems.push("VITE_SUPABASE_URL");
if (!raw.VITE_SUPABASE_PUBLISHABLE_KEY || /YOUR_/i.test(raw.VITE_SUPABASE_PUBLISHABLE_KEY)) {
  problems.push("VITE_SUPABASE_PUBLISHABLE_KEY");
}
if (!isHttpUrl(raw.VITE_API_BASE_URL)) problems.push("VITE_API_BASE_URL");

/** Names (never values) of missing/invalid variables; empty when config is usable. */
export const envProblems = Object.freeze(problems);

export const env = Object.freeze({
  supabaseUrl: raw.VITE_SUPABASE_URL ?? "",
  supabasePublishableKey: raw.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
  apiBaseUrl: (raw.VITE_API_BASE_URL ?? "").replace(/\/+$/, ""),
});
