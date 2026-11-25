/** Locale-aware date helpers shared by the library, editor and history views. */
export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(iso, now = Date.now()) {
  if (!iso) return "never";
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(diff)) return "";
  if (diff < 45) return "just now";
  const units = [
    [60, "minute", 60],
    [3600, "hour", 24],
    [86400, "day", 30],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [size, unit, max] of units) {
    const value = Math.round(diff / size);
    if (value < max) return rtf.format(-value, unit);
  }
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
