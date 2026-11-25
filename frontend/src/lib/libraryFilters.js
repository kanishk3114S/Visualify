/**
 * Library filter state <-> URL search params <-> GET /api/v1/notes query.
 * Pure functions (unit-tested). Defaults are omitted from URLs so links stay clean.
 */
export const SORT_OPTIONS = Object.freeze([
  ["updated_at", "Recently updated"],
  ["last_opened_at", "Recently opened"],
  ["created_at", "Newest"],
  ["title", "Title A–Z"],
]);
const SORTS = SORT_OPTIONS.map(([v]) => v);
export const VIEWS = Object.freeze(["grid", "list"]);

export const DEFAULT_FILTERS = Object.freeze({ q: "", tags: [], favorite: false, archived: false, sort: "updated_at", view: "grid" });

const TAG_RE = /^[\p{L}\p{N} _.+#-]{1,40}$/u;

/** Parses (and sanitises) URLSearchParams into a filter object. */
export function parseLibraryParams(params) {
  const get = (k) => params.get(k) ?? "";
  const tags = [...new Set(get("tags").split(",").map((t) => t.trim().toLowerCase()).filter((t) => TAG_RE.test(t)))].slice(0, 5);
  return {
    q: get("q").slice(0, 100),
    tags,
    favorite: get("favorite") === "1",
    archived: get("archived") === "1",
    sort: SORTS.includes(get("sort")) ? get("sort") : DEFAULT_FILTERS.sort,
    view: VIEWS.includes(get("view")) ? get("view") : DEFAULT_FILTERS.view,
  };
}

/** Filter object -> URLSearchParams for the page URL (defaults omitted). */
export function toLibrarySearchParams(filters) {
  const p = new URLSearchParams();
  if (filters.q.trim()) p.set("q", filters.q.trim());
  if (filters.tags.length) p.set("tags", filters.tags.join(","));
  if (filters.favorite) p.set("favorite", "1");
  if (filters.archived) p.set("archived", "1");
  if (filters.sort !== DEFAULT_FILTERS.sort) p.set("sort", filters.sort);
  if (filters.view !== DEFAULT_FILTERS.view) p.set("view", filters.view);
  return p;
}

/**
 * Filter object -> API query string. `folderId` may be a uuid, "root" (unfiled)
 * or null (all folders). The archived toggle shows ONLY archived notes.
 */
export function toNotesQuery(filters, { folderId = null, limit = 24, offset = 0 } = {}) {
  const p = new URLSearchParams();
  const q = filters.q.trim();
  if (q) p.set("q", q);
  if (folderId) p.set("folderId", folderId);
  if (filters.tags.length) p.set("tags", filters.tags.join(","));
  if (filters.favorite) p.set("favorite", "true");
  p.set("archived", filters.archived ? "true" : "false");
  p.set("sort", filters.sort);
  p.set("limit", String(limit));
  if (offset) p.set("offset", String(offset));
  return p.toString();
}

export const hasActiveFilters = (f) => Boolean(f.q.trim() || f.tags.length || f.favorite || f.archived);

/** Folder tree helpers. */
export function buildFolderTree(folders) {
  const byParent = new Map();
  for (const f of folders) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  const walk = (parentId, depth) =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .flatMap((f) => [{ ...f, depth }, ...walk(f.id, depth + 1)]);
  return walk(null, 0);
}

/** Ids of a folder and all its descendants (invalid move targets). */
export function descendantIds(folders, id) {
  const out = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        changed = true;
      }
    }
  }
  return out;
}
