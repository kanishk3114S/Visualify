import { describe, it, expect } from "vitest";
import { THEME_STORAGE_KEY, applyTheme, readStoredMode, resolveTheme, storeMode } from "./theme.js";
import { autosaveReducer, hasUnsavedChanges, initialAutosaveState, sceneFingerprint, statusLabel, toScenePayload } from "./autosave.js";
import { buildFolderTree, descendantIds, hasActiveFilters, parseLibraryParams, toLibrarySearchParams, toNotesQuery, DEFAULT_FILTERS } from "./libraryFilters.js";

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};

describe("theme", () => {
  it("reads a stored mode and falls back to system for missing/invalid values or blocked storage", () => {
    expect(readStoredMode(memoryStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
    expect(readStoredMode(memoryStorage({ [THEME_STORAGE_KEY]: "neon" }))).toBe("system");
    expect(readStoredMode(memoryStorage())).toBe("system");
    expect(readStoredMode({ getItem: () => { throw new Error("blocked"); } })).toBe("system");
  });

  it("persists only valid modes and never throws when storage is blocked", () => {
    const s = memoryStorage();
    storeMode("light", s);
    storeMode("purple", s);
    expect(s.map.get(THEME_STORAGE_KEY)).toBe("light");
    expect(() => storeMode("dark", { setItem: () => { throw new Error("quota"); } })).not.toThrow();
  });

  it("resolves system against the OS preference; explicit modes win", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("applies class, color-scheme and data-theme to <html>", () => {
    const classes = new Set();
    const root = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) }, style: {}, dataset: {} };
    applyTheme("dark", { documentElement: root });
    expect([...classes]).toEqual(["dark"]);
    expect(root.style.colorScheme).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    applyTheme("light", { documentElement: root });
    expect(classes.size).toBe(0);
    expect(root.style.colorScheme).toBe("light");
  });
});

describe("autosaveReducer", () => {
  const s0 = initialAutosaveState(3);

  it("change -> pending -> saving -> saved with the new revision", () => {
    let s = autosaveReducer(s0, { type: "CHANGE" });
    expect(s.status).toBe("pending");
    s = autosaveReducer(s, { type: "SAVE_START" });
    expect(s.status).toBe("saving");
    s = autosaveReducer(s, { type: "SAVE_SUCCESS", revision: 4, savedAt: "2026-11-26T10:00:00Z" });
    expect(s).toMatchObject({ status: "saved", revision: 4, savedAt: "2026-11-26T10:00:00Z" });
  });

  it("edits during a save leave the state pending afterwards (a follow-up save is needed)", () => {
    let s = autosaveReducer(autosaveReducer(s0, { type: "CHANGE" }), { type: "SAVE_START" });
    s = autosaveReducer(s, { type: "CHANGE" });
    expect(s.status).toBe("saving");
    s = autosaveReducer(s, { type: "SAVE_SUCCESS", revision: 4, savedAt: "x" });
    expect(s.status).toBe("pending");
  });

  it("failures keep unsaved state; conflicts freeze further changes until reset", () => {
    let s = autosaveReducer({ ...s0, status: "saving" }, { type: "SAVE_FAILURE", error: { message: "offline" } });
    expect(s.status).toBe("error");
    expect(hasUnsavedChanges(s)).toBe(true);
    s = autosaveReducer(s0, { type: "CONFLICT" });
    expect(autosaveReducer(s, { type: "CHANGE" }).status).toBe("conflict");
    s = autosaveReducer(s, { type: "RESET", revision: 0 });
    expect(s).toMatchObject({ status: "saved", revision: 0 });
    expect(hasUnsavedChanges(s)).toBe(false);
  });

  it("labels each state for the status pill", () => {
    expect(statusLabel({ status: "pending" })).toBe("Unsaved changes");
    expect(statusLabel({ status: "saving" })).toBe("Saving…");
    expect(statusLabel({ status: "error" })).toBe("Save failed");
    expect(statusLabel({ status: "conflict" })).toBe("Changed elsewhere");
    expect(statusLabel({ status: "saved", savedAt: new Date().toISOString() })).toBe("Saved just now");
    expect(statusLabel({ status: "saved", savedAt: null })).toBe("All changes saved");
  });
});

describe("scene helpers", () => {
  const el = (id, version, extra = {}) => ({ id, version, ...extra });
  it("fingerprint changes with edits, deletions and new elements, and is stable otherwise", () => {
    const a = [el("a", 1), el("b", 1)];
    expect(sceneFingerprint(a)).toBe(sceneFingerprint([el("a", 1), el("b", 1)]));
    expect(sceneFingerprint(a)).not.toBe(sceneFingerprint([el("a", 2), el("b", 1)]));
    expect(sceneFingerprint(a)).not.toBe(sceneFingerprint([el("a", 1), el("b", 1, { isDeleted: true })]));
    expect(sceneFingerprint(a)).not.toBe(sceneFingerprint([...a, el("c", 1)]));
  });

  it("payload drops deleted elements and editor UI state", () => {
    const payload = toScenePayload([el("a", 1), el("b", 1, { isDeleted: true })], { viewBackgroundColor: "#fff", gridSize: 20, selectedElementIds: { a: true } });
    expect(payload.elements.map((e) => e.id)).toEqual(["a"]);
    expect(payload.appState).toEqual({ viewBackgroundColor: "#fff", gridSize: 20 });
    expect(payload.files).toEqual({});
  });
});

describe("library filters", () => {
  it("parses and sanitises URL params with defaults", () => {
    const f = parseLibraryParams(new URLSearchParams("q=tcp&tags=Net,%3Cscript%3E,db,net&favorite=1&archived=0&sort=owner_id&view=list"));
    expect(f).toEqual({ q: "tcp", tags: ["net", "db"], favorite: true, archived: false, sort: "updated_at", view: "list" });
    expect(parseLibraryParams(new URLSearchParams(""))).toEqual(DEFAULT_FILTERS);
  });

  it("round-trips through URL params, omitting defaults", () => {
    expect(toLibrarySearchParams(DEFAULT_FILTERS).toString()).toBe("");
    const f = { ...DEFAULT_FILTERS, q: " dns ", tags: ["net"], archived: true, sort: "title" };
    const params = toLibrarySearchParams(f);
    expect(params.toString()).toBe("q=dns&tags=net&archived=1&sort=title");
    expect(parseLibraryParams(params)).toEqual({ ...f, q: "dns" });
  });

  it("builds the API query (archived toggle shows only archived; folder filter; paging)", () => {
    const q = new URLSearchParams(toNotesQuery({ ...DEFAULT_FILTERS, q: "tcp", tags: ["a", "b"], favorite: true }, { folderId: "root", limit: 24, offset: 48 }));
    expect(Object.fromEntries(q)).toEqual({ q: "tcp", folderId: "root", tags: "a,b", favorite: "true", archived: "false", sort: "updated_at", limit: "24", offset: "48" });
    expect(new URLSearchParams(toNotesQuery({ ...DEFAULT_FILTERS, archived: true })).get("archived")).toBe("true");
    expect(new URLSearchParams(toNotesQuery(DEFAULT_FILTERS)).has("folderId")).toBe(false);
  });

  it("detects active filters", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, q: "  " })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, favorite: true })).toBe(true);
  });

  it("builds an indented folder tree and finds descendants (invalid move targets)", () => {
    const folders = [
      { id: "b", name: "Beta", parentId: null, sortOrder: 0 },
      { id: "a", name: "Alpha", parentId: null, sortOrder: 0 },
      { id: "c", name: "Child", parentId: "a", sortOrder: 0 },
      { id: "d", name: "Deep", parentId: "c", sortOrder: 0 },
    ];
    expect(buildFolderTree(folders).map((f) => `${f.depth}:${f.name}`)).toEqual(["0:Alpha", "1:Child", "2:Deep", "0:Beta"]);
    expect([...descendantIds(folders, "a")].sort()).toEqual(["a", "c", "d"]);
    expect([...descendantIds(folders, "b")]).toEqual(["b"]);
  });
});
