import { describe, it, expect } from "vitest";
import { createSupabaseNotesRepository } from "../src/notes/notesRepository.js";
import { mapNotesDbError } from "../src/notes/errors.js";

/** Records every supabase-js builder call; resolves with a canned result. */
function recorder(result = { data: [{ id: "x", note_id: "n", version_id: "v" }], error: null, count: 1 }) {
  const calls = [];
  const builder = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve) => resolve(result);
      if (["maybeSingle", "single"].includes(prop)) return () => (calls.push([prop]), Promise.resolve(result));
      return (...args) => (calls.push([prop, ...args]), builder);
    },
  });
  const db = {
    from: (t) => (calls.push(["from", t]), builder),
    rpc: (fn, params) => (calls.push(["rpc", fn, params]), Promise.resolve(result)),
  };
  return { db, calls };
}

const OWNER = "owner-1";

describe("SupabaseNotesRepository", () => {
  it("adds an explicit owner filter to every table query", async () => {
    const { db, calls } = recorder();
    const repo = createSupabaseNotesRepository(db, OWNER);
    const ops = [
      () => repo.listFolders(),
      () => repo.getFolder("f"),
      () => repo.updateFolder("f", { name: "x" }),
      () => repo.listNotes({ archived: "false", sort: "updated_at", limit: 10, offset: 0 }),
      () => repo.getNote("n"),
      () => repo.updateNote("n", { title: "t" }),
      () => repo.markOpened("n"),
      () => repo.deleteNote("n"),
      () => repo.listVersions("n"),
      () => repo.getVersion("n", "v"),
      () => repo.getDraft("n"),
      () => repo.getExport("e"),
      () => repo.updateExport("e", {}),
      () => repo.exportPaths("n"),
      () => repo.folderNoteCounts(),
    ];
    for (const op of ops) {
      calls.length = 0;
      await op().catch(() => {});
      expect(calls, op.toString()).toContainEqual(["eq", "owner_id", OWNER]);
    }
  });

  it("inserts always carry the verified owner id", async () => {
    const { db, calls } = recorder({ data: { id: "x" }, error: null });
    const repo = createSupabaseNotesRepository(db, OWNER);
    await repo.createFolder({ name: "F" });
    await repo.createExport({ noteId: "n", versionId: "v", format: "png", theme: "light", transparent: false, source: "version" });
    await repo.saveDraft("n", { elements: [] }, 0);
    const inserts = calls.filter((c) => c[0] === "insert").map((c) => c[1]);
    expect(inserts).toHaveLength(3);
    for (const row of inserts) expect(row.owner_id).toBe(OWNER);
  });

  it("calls the atomic database functions with the expected parameters", async () => {
    const { db, calls } = recorder();
    const repo = createSupabaseNotesRepository(db, OWNER);
    await repo.createFromJob({ jobId: "j", title: "T", tags: ["a"] });
    await repo.addVersion("n", { scene: { elements: [] }, description: "d" });
    await repo.restoreVersion("n", "v");
    await repo.duplicate("n", "Copy");
    await repo.deleteFolder("f");
    const rpcs = calls.filter((c) => c[0] === "rpc").map((c) => [c[1], Object.keys(c[2]).sort()]);
    expect(rpcs).toEqual([
      ["create_note_from_job", ["p_description", "p_folder_id", "p_job_id", "p_scene", "p_subject", "p_tags", "p_title"]],
      ["add_note_version", ["p_description", "p_kind", "p_note_id", "p_scene"]],
      ["restore_note_version", ["p_note_id", "p_version_id"]],
      ["duplicate_note", ["p_note_id", "p_title"]],
      ["delete_folder", ["p_folder_id"]],
    ]);
  });

  it("builds list filters (folder root, tags AND, favourites, archived, sanitised search, range)", async () => {
    const { db, calls } = recorder({ data: [], error: null, count: 0 });
    const repo = createSupabaseNotesRepository(db, OWNER);
    await repo.listNotes({ q: "net layers", folderId: "root", tags: ["a", "b"], favorite: true, archived: "true", sort: "title", limit: 5, offset: 10 });
    expect(calls).toContainEqual(["is", "folder_id", null]);
    expect(calls).toContainEqual(["contains", "tags", ["a", "b"]]);
    expect(calls).toContainEqual(["eq", "is_favorite", true]);
    expect(calls).toContainEqual(["eq", "is_archived", true]);
    expect(calls).toContainEqual(["or", "title.ilike.*net layers*,description.ilike.*net layers*,subject.ilike.*net layers*,tags.cs.{net layers}"]);
    expect(calls).toContainEqual(["order", "title", { ascending: true, nullsFirst: false }]);
    expect(calls).toContainEqual(["range", 10, 14]);
  });

  it("draft updates are conditional on the base revision and conflict when nothing matched", async () => {
    const { db, calls } = recorder({ data: [], error: null });
    const repo = createSupabaseNotesRepository(db, OWNER);
    await expect(repo.saveDraft("n", { elements: [] }, 3)).rejects.toMatchObject({ status: 409, code: "DRAFT_CONFLICT" });
    expect(calls).toContainEqual(["update", { scene_json: { elements: [] }, revision: 4 }]);
    expect(calls).toContainEqual(["eq", "revision", 3]);
    const dup = recorder({ data: null, error: { code: "23505" } });
    await expect(createSupabaseNotesRepository(dup.db, OWNER).saveDraft("n", { elements: [] }, 0)).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
  });
});

describe("mapNotesDbError", () => {
  it.each([
    [{ code: "P0002", message: "note_not_found" }, 404, "NOT_FOUND"],
    [{ code: "23514", message: "folder_cycle" }, 400, "FOLDER_CYCLE"],
    [{ code: "23514", message: "folder_too_deep" }, 400, "FOLDER_TOO_DEEP"],
    [{ code: "23505", message: 'duplicate key value violates unique constraint "folders_unique_sibling_name"' }, 409, "FOLDER_NAME_TAKEN"],
    [{ code: "23505", message: 'violates unique constraint "note_versions_one_note_per_job"' }, 409, "JOB_ALREADY_SAVED"],
    [{ code: "23503", message: "fk" }, 404, "FOLDER_NOT_FOUND"],
    [{ code: "22023", message: "job_not_completed" }, 409, "JOB_NOT_COMPLETED"],
    [{ code: "23514", message: "notes_title_length" }, 400, "VALIDATION_ERROR"],
    [{ code: "XX000", message: "relation secret_table" }, 502, "DATABASE_ERROR"],
  ])("maps %j", (err, status, code) => {
    const mapped = mapNotesDbError(err);
    expect([mapped.status, mapped.code]).toEqual([status, code]);
    expect(mapped.message).not.toMatch(/secret_table|constraint/);
  });
});
