import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/testApp.js";

const UNKNOWN = "6f1c2c1e-1111-4a4a-8b8b-123456789abc";
const rect = (id = "r1", over = {}) => ({ id, type: "rectangle", x: 0, y: 0, width: 120, height: 60, strokeColor: "#1e1e1e", backgroundColor: "transparent", ...over });
const SCENE = { type: "excalidraw", elements: [rect()], appState: { viewBackgroundColor: "#ffffff" } };
const EDITED = { elements: [rect("r1"), rect("r2", { x: 200 })], appState: { viewBackgroundColor: "#ffffff", selectedElementIds: { r1: true } } };
const PLAN = { title: "TCP Handshake", summary: "How TCP connects.", sections: [] };

function setup() {
  const ctx = buildTestApp();
  const alice = ctx.addUser({ email: "alice@example.test" });
  const bob = ctx.addUser({ email: "bob@example.test" });
  const call = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${who.token}`);
    return {
      get: (u) => auth(request(ctx.app).get(u)),
      post: (u) => auth(request(ctx.app).post(u)),
      put: (u) => auth(request(ctx.app).put(u)),
      patch: (u) => auth(request(ctx.app).patch(u)),
      delete: (u) => auth(request(ctx.app).delete(u)),
    };
  };
  const job = (who, over = {}) =>
    ctx.generation.store.seed({ owner_id: who.user.id, input_text: "Explain TCP", status: "completed", progress: 100, learning_plan: PLAN, scene_json: SCENE, mermaid_source: "graph TD", settings: { subject: "Networks" }, ...over });
  async function saveNote(who, body = {}) {
    const j = job(who);
    const res = await call(who).post("/api/v1/notes").send({ jobId: j.id, ...body });
    expect(res.status).toBe(201);
    return { jobId: j.id, noteId: res.body.data.note.id, res };
  }
  const idle = () => ctx.notes.service.onIdle();
  return { ...ctx, alice, bob, call, job, saveNote, idle };
}

// ---------------------------------------------------------------------------
describe("auth & ownership across every Phase 3 route", () => {
  it("requires authentication (401) before parsing bodies", async () => {
    const { app } = setup();
    for (const [method, url] of [["get", "/api/v1/notes"], ["post", "/api/v1/notes"], ["get", "/api/v1/folders"], ["post", "/api/v1/folders"], ["put", `/api/v1/notes/${UNKNOWN}/draft`], ["get", `/api/v1/exports/${UNKNOWN}`]]) {
      const res = await request(app)[method](url).set("Content-Type", "application/json").send("{bad json");
      expect(res.status, `${method} ${url}`).toBe(401);
    }
  });

  it("returns the same 404 for unknown, malformed and other users' notes on every note route", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    const versions = await s.call(s.alice).get(`/api/v1/notes/${noteId}/versions`);
    const v1 = versions.body.data.items[0].id;
    const probes = (id) => [
      s.call(s.bob).get(`/api/v1/notes/${id}`),
      s.call(s.bob).patch(`/api/v1/notes/${id}`).send({ title: "pwned" }),
      s.call(s.bob).delete(`/api/v1/notes/${id}`),
      s.call(s.bob).post(`/api/v1/notes/${id}/duplicate`).send({}),
      s.call(s.bob).get(`/api/v1/notes/${id}/versions`),
      s.call(s.bob).get(`/api/v1/notes/${id}/versions/${v1}`),
      s.call(s.bob).post(`/api/v1/notes/${id}/versions`).send({ sceneJson: SCENE }),
      s.call(s.bob).post(`/api/v1/notes/${id}/restore/${v1}`),
      s.call(s.bob).put(`/api/v1/notes/${id}/draft`).send({ sceneJson: SCENE, baseRevision: 0 }),
      s.call(s.bob).post(`/api/v1/notes/${id}/exports`).send({ format: "png" }),
    ];
    for (const id of [noteId, UNKNOWN, "not-a-uuid"]) {
      for (const res of await Promise.all(probes(id))) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("NOT_FOUND");
      }
    }
    const still = await s.call(s.alice).get(`/api/v1/notes/${noteId}`);
    expect(still.body.data.note.title).toBe("TCP Handshake");
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/notes (save from a completed generation)", () => {
  it("creates the note + version 1 from the job and links the job", async () => {
    const s = setup();
    const { noteId, jobId, res } = await s.saveNote(s.alice);
    expect(res.headers.location).toBe(`/api/v1/notes/${noteId}`);
    expect(res.body.data).toMatchObject({
      note: { title: "TCP Handshake", description: "How TCP connects.", subject: "Networks", tags: [], isFavorite: false, folderId: null },
      currentVersion: { versionNumber: 1, kind: "generated", isCurrent: true, learningPlan: PLAN, mermaidSource: "graph TD" },
      draft: null,
      draftRevision: 0,
      sceneJson: SCENE,
    });
    expect(res.body.data.note).not.toHaveProperty("owner_id");
    expect(s.generation.store.rows.get(jobId).note_id).toBe(noteId);
  });

  it("keeps edits made in the generation workspace (sanitised) and custom metadata", async () => {
    const s = setup();
    const { res } = await s.saveNote(s.alice, { sceneJson: EDITED, title: "My TCP notes", tags: [" Networking ", "networking", "TCP"] });
    expect(res.body.data.note).toMatchObject({ title: "My TCP notes", tags: ["networking", "tcp"] });
    expect(res.body.data.sceneJson.elements.map((e) => e.id)).toEqual(["r1", "r2"]);
    expect(res.body.data.sceneJson.appState).toEqual({ viewBackgroundColor: "#ffffff" }); // editor UI state dropped
  });

  it("renders a background preview and exposes it only as a short-lived signed URL", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    await s.idle();
    expect(s.notes.renderer.calls).toEqual([{ format: "png", theme: "light", transparent: false, elements: 1 }]);
    const detail = await s.call(s.alice).get(`/api/v1/notes/${noteId}`);
    expect(detail.body.data.note.previewUrl).toMatch(/^https:\/\/storage\.test\/note-assets\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\/preview\.png\?ttl=600$/);
    expect(JSON.stringify(detail.body)).not.toMatch(/preview_path/);
  });

  it("is idempotent per job: a second save returns 409 JOB_ALREADY_SAVED with the note id", async () => {
    const s = setup();
    const { noteId, jobId } = await s.saveNote(s.alice);
    const again = await s.call(s.alice).post("/api/v1/notes").send({ jobId });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "JOB_ALREADY_SAVED", details: { noteId } });
    expect([...s.notes.db.notes.values()]).toHaveLength(1);
  });

  it("rejects unfinished jobs, other users' jobs, invalid scenes and unknown folders", async () => {
    const s = setup();
    const running = s.job(s.alice, { status: "planning", scene_json: null });
    expect((await s.call(s.alice).post("/api/v1/notes").send({ jobId: running.id })).body.error.code).toBe("JOB_NOT_COMPLETED");
    const theirs = s.job(s.bob);
    expect((await s.call(s.alice).post("/api/v1/notes").send({ jobId: theirs.id })).status).toBe(404);
    const mine = s.job(s.alice);
    const bad = await s.call(s.alice).post("/api/v1/notes").send({ jobId: mine.id, sceneJson: { elements: [rect("x", { type: "image" })] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_SCENE");
    const nofolder = await s.call(s.alice).post("/api/v1/notes").send({ jobId: mine.id, folderId: UNKNOWN });
    expect(nofolder.body.error.code).toBe("FOLDER_NOT_FOUND");
    for (const body of [{}, { jobId: "x" }, { jobId: mine.id, ownerId: s.bob.user.id }, { jobId: mine.id, tags: ["<script>"] }]) {
      expect((await s.call(s.alice).post("/api/v1/notes").send(body)).status).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/v1/notes (library list)", () => {
  async function library() {
    const s = setup();
    // Explicit subjects: the job fixture's default subject ("Networks") would match q=network.
    const a = await s.saveNote(s.alice, { title: "Alpha networking", subject: "Computing", tags: ["net"] });
    const b = await s.saveNote(s.alice, { title: "Beta databases", subject: "Computing", tags: ["db", "sql"] });
    const c = await s.saveNote(s.alice, { title: "Gamma biology", subject: "Science" });
    await s.saveNote(s.bob, { title: "Bob secret networking" });
    return { s, a, b, c };
  }

  it("returns only the caller's notes with total, newest-updated first", async () => {
    const { s } = await library();
    const res = await s.call(s.alice).get("/api/v1/notes");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 3, limit: 24, offset: 0 });
    expect(res.body.data.items.map((n) => n.title)).toEqual(["Gamma biology", "Beta databases", "Alpha networking"]);
    expect(JSON.stringify(res.body)).not.toContain("Bob secret");
  });

  it("searches title and tags, filters by tags, favourites, archived and folder, and sorts", async () => {
    const { s, a, b, c } = await library();
    const titles = async (qs) => (await s.call(s.alice).get(`/api/v1/notes?${qs}`)).body.data.items.map((n) => n.title);
    expect(await titles("q=network")).toEqual(["Alpha networking"]);
    expect(await titles("q=SQL")).toEqual(["Beta databases"]); // tag match, case-insensitive
    expect(await titles("tags=db,sql")).toEqual(["Beta databases"]);
    expect(await titles("tags=db,net")).toEqual([]); // tags combine with AND
    await s.call(s.alice).patch(`/api/v1/notes/${a.noteId}`).send({ isFavorite: true });
    await s.call(s.alice).patch(`/api/v1/notes/${c.noteId}`).send({ isArchived: true });
    expect(await titles("favorite=true")).toEqual(["Alpha networking"]);
    expect(await titles("archived=true")).toEqual(["Gamma biology"]);
    expect((await titles("archived=all")).sort()).toEqual(["Alpha networking", "Beta databases", "Gamma biology"]);
    expect(await titles("sort=title")).toEqual(["Alpha networking", "Beta databases"]);
    await s.call(s.alice).get(`/api/v1/notes/${b.noteId}`); // opening sets last_opened_at
    expect((await titles("sort=last_opened_at"))[0]).toBe("Beta databases");
    const folder = (await s.call(s.alice).post("/api/v1/folders").send({ name: "Courses" })).body.data.folder;
    await s.call(s.alice).patch(`/api/v1/notes/${b.noteId}`).send({ folderId: folder.id });
    expect(await titles(`folderId=${folder.id}`)).toEqual(["Beta databases"]);
    expect(await titles("folderId=root")).toEqual(["Alpha networking"]);
  });

  it("paginates and neutralises filter-grammar characters in q", async () => {
    const { s } = await library();
    const page = await s.call(s.alice).get("/api/v1/notes?limit=2&offset=2");
    expect(page.body.data).toMatchObject({ total: 3, limit: 2, offset: 2 });
    expect(page.body.data.items).toHaveLength(1);
    const evil = await s.call(s.alice).get(`/api/v1/notes?q=${encodeURIComponent("net*),owner_id.neq.(x")}`);
    expect(evil.status).toBe(200);
    for (const qs of ["limit=0", "limit=61", "sort=owner_id", "folderId=abc", "tags=" + "x".repeat(41), "unknown=1"]) {
      expect((await s.call(s.alice).get(`/api/v1/notes?${qs}`)).status, qs).toBe(400);
    }
  });

  it("opening a note updates last_opened_at but not updated_at", async () => {
    const { s, a } = await library();
    const before = s.notes.db.notes.get(a.noteId).updated_at;
    await s.call(s.alice).get(`/api/v1/notes/${a.noteId}`);
    const row = s.notes.db.notes.get(a.noteId);
    expect(row.last_opened_at).not.toBeNull();
    expect(row.updated_at).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe("PATCH / duplicate / DELETE notes", () => {
  it("patches allowlisted metadata only", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    const ok = await s.call(s.alice).patch(`/api/v1/notes/${noteId}`).send({ title: "Renamed", topic: "Transport", tags: ["Exam"], isFavorite: true });
    expect(ok.body.data.note).toMatchObject({ title: "Renamed", topic: "Transport", tags: ["exam"], isFavorite: true });
    for (const body of [{}, { currentVersionId: UNKNOWN }, { previewPath: "x" }, { title: "" }, { title: "t".repeat(161) }, { tags: Array(21).fill("a") }]) {
      expect((await s.call(s.alice).patch(`/api/v1/notes/${noteId}`).send(body)).status).toBe(400);
    }
  });

  it("can't move a note into another user's folder", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    const bobFolder = (await s.call(s.bob).post("/api/v1/folders").send({ name: "Bob" })).body.data.folder;
    const res = await s.call(s.alice).patch(`/api/v1/notes/${noteId}`).send({ folderId: bobFolder.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("FOLDER_NOT_FOUND");
  });

  it("duplicate creates an independent note from the latest saved scene", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    await s.call(s.alice).put(`/api/v1/notes/${noteId}/draft`).send({ sceneJson: EDITED, baseRevision: 0 });
    const dup = await s.call(s.alice).post(`/api/v1/notes/${noteId}/duplicate`).send({});
    expect(dup.status).toBe(201);
    expect(dup.body.data.note.title).toBe("Copy of TCP Handshake");
    const copy = await s.call(s.alice).get(`/api/v1/notes/${dup.body.data.note.id}`);
    expect(copy.body.data.sceneJson.elements).toHaveLength(2);
    expect(copy.body.data.currentVersion).toMatchObject({ versionNumber: 1, kind: "duplicate" });
    await s.call(s.alice).delete(`/api/v1/notes/${noteId}`);
    expect((await s.call(s.alice).get(`/api/v1/notes/${dup.body.data.note.id}`)).status).toBe(200);
  });

  it("delete removes Storage objects (previews + exports) before the database rows", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    await s.idle();
    await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({ format: "png" });
    await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({ format: "excalidraw" });
    const keysFor = () => [...s.notes.storage.objects.keys()].filter((k) => k.includes(noteId));
    expect(keysFor()).toHaveLength(3);
    const res = await s.call(s.alice).delete(`/api/v1/notes/${noteId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true, removedFiles: 3 });
    expect(keysFor()).toHaveLength(0);
    expect(s.notes.db.notes.has(noteId)).toBe(false);
    expect([...s.notes.db.versions.values()].some((v) => v.note_id === noteId)).toBe(false);
  });

  it("keeps the note if Storage cleanup fails (no orphaned private files)", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    await s.idle();
    s.notes.storage.fail.remove = true;
    const res = await s.call(s.alice).delete(`/api/v1/notes/${noteId}`);
    expect(res.status).toBe(502);
    expect(s.notes.db.notes.has(noteId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("folders", () => {
  it("CRUD with note counts; names unique among siblings", async () => {
    const s = setup();
    const c = s.call(s.alice);
    const parent = (await c.post("/api/v1/folders").send({ name: "Year 1" })).body.data.folder;
    const child = (await c.post("/api/v1/folders").send({ name: "Networks", parentId: parent.id })).body.data.folder;
    expect(child).toMatchObject({ name: "Networks", parentId: parent.id, noteCount: 0 });
    expect((await c.post("/api/v1/folders").send({ name: " networks ", parentId: parent.id })).body.error.code).toBe("FOLDER_NAME_TAKEN");
    const { noteId } = await s.saveNote(s.alice, { folderId: child.id });
    const list = (await c.get("/api/v1/folders")).body.data.items;
    expect(list.find((f) => f.id === child.id).noteCount).toBe(1);
    const renamed = await c.patch(`/api/v1/folders/${child.id}`).send({ name: "Computer networks" });
    expect(renamed.body.data.folder.name).toBe("Computer networks");
    expect(noteId).toBeTruthy();
  });

  it("rejects circular moves (self and descendants) with 400 FOLDER_CYCLE", async () => {
    const s = setup();
    const c = s.call(s.alice);
    const a = (await c.post("/api/v1/folders").send({ name: "A" })).body.data.folder;
    const b = (await c.post("/api/v1/folders").send({ name: "B", parentId: a.id })).body.data.folder;
    const d = (await c.post("/api/v1/folders").send({ name: "D", parentId: b.id })).body.data.folder;
    for (const target of [a.id, b.id, d.id]) {
      const res = await c.patch(`/api/v1/folders/${a.id}`).send({ parentId: target });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("FOLDER_CYCLE");
    }
    expect((await c.patch(`/api/v1/folders/${d.id}`).send({ parentId: null })).status).toBe(200);
  });

  it("delete moves contained notes to root and subfolders up a level", async () => {
    const s = setup();
    const c = s.call(s.alice);
    const top = (await c.post("/api/v1/folders").send({ name: "Top" })).body.data.folder;
    const doomed = (await c.post("/api/v1/folders").send({ name: "Doomed", parentId: top.id })).body.data.folder;
    const sub = (await c.post("/api/v1/folders").send({ name: "Sub", parentId: doomed.id })).body.data.folder;
    const { noteId } = await s.saveNote(s.alice, { folderId: doomed.id });
    expect((await c.delete(`/api/v1/folders/${doomed.id}`)).status).toBe(200);
    expect((await c.get(`/api/v1/notes/${noteId}`)).body.data.note.folderId).toBeNull();
    expect((await c.get("/api/v1/folders")).body.data.items.find((f) => f.id === sub.id).parentId).toBe(top.id);
  });

  it("isolates users and validates input", async () => {
    const s = setup();
    const mine = (await s.call(s.alice).post("/api/v1/folders").send({ name: "Mine" })).body.data.folder;
    expect((await s.call(s.bob).get("/api/v1/folders")).body.data.items).toEqual([]);
    expect((await s.call(s.bob).patch(`/api/v1/folders/${mine.id}`).send({ name: "x" })).status).toBe(404);
    expect((await s.call(s.bob).delete(`/api/v1/folders/${mine.id}`)).status).toBe(404);
    expect((await s.call(s.bob).post("/api/v1/folders").send({ name: "Inside yours", parentId: mine.id })).body.error.code).toBe("FOLDER_NOT_FOUND");
    for (const body of [{}, { name: "" }, { name: "n".repeat(81) }, { name: "ok", ownerId: s.alice.user.id }]) {
      expect((await s.call(s.alice).post("/api/v1/folders").send(body)).status).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
describe("autosave, snapshots and restore", () => {
  it("autosave stores a working draft with optimistic revisions and 409 on conflicts", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    const c = s.call(s.alice);
    const first = await c.put(`/api/v1/notes/${noteId}/draft`).send({ sceneJson: EDITED, baseRevision: 0 });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ revision: 1, savedAt: expect.any(String) });
    const second = await c.put(`/api/v1/notes/${noteId}/draft`).send({ sceneJson: SCENE, baseRevision: 1 });
    expect(second.body.data.revision).toBe(2);
    const stale = await c.put(`/api/v1/notes/${noteId}/draft`).send({ sceneJson: EDITED, baseRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("DRAFT_CONFLICT");
    const reload = await c.get(`/api/v1/notes/${noteId}`);
    expect(reload.body.data).toMatchObject({ draftRevision: 2, draft: { revision: 2 } });
    expect(reload.body.data.sceneJson.elements).toHaveLength(1); // reload restores the last confirmed save
    expect(reload.body.data.currentVersion.versionNumber).toBe(1); // autosave never creates versions
  });

  it("rejects unsafe or malformed scenes on autosave", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    for (const sceneJson of [{ elements: [rect("a", { link: "javascript:alert(1)" })] }, { elements: [rect("a", { type: "embeddable" })] }, { nope: true }]) {
      const res = await s.call(s.alice).put(`/api/v1/notes/${noteId}/draft`).send({ sceneJson, baseRevision: 0 });
      expect(res.status).toBe(400);
    }
    expect((await s.call(s.alice).put(`/api/v1/notes/${noteId}/draft`).send({ sceneJson: SCENE, baseRevision: -1 })).status).toBe(400);
  });

  it("snapshot creates the next immutable version, clears the draft and refreshes the preview", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    const c = s.call(s.alice);
    await c.put(`/api/v1/notes/${noteId}/draft`).send({ sceneJson: EDITED, baseRevision: 0 });
    const snap = await c.post(`/api/v1/notes/${noteId}/versions`).send({ sceneJson: EDITED, description: "Added UDP box" });
    expect(snap.status).toBe(201);
    expect(snap.body.data).toMatchObject({ version: { versionNumber: 2, kind: "snapshot", description: "Added UDP box", isCurrent: true }, draftRevision: 0 });
    const list = (await c.get(`/api/v1/notes/${noteId}/versions`)).body.data.items;
    expect(list.map((v) => [v.versionNumber, v.kind, v.isCurrent])).toEqual([[2, "snapshot", true], [1, "generated", false]]);
    const detail = (await c.get(`/api/v1/notes/${noteId}`)).body.data;
    expect(detail.draft).toBeNull();
    expect(detail.sceneJson.elements).toHaveLength(2);
    await s.idle();
    expect(s.notes.renderer.calls.length).toBe(2); // initial + snapshot previews
  });

  it("restore is non-destructive: unsnapshotted edits become a version, then the old scene is appended", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    const c = s.call(s.alice);
    const v1 = (await c.get(`/api/v1/notes/${noteId}/versions`)).body.data.items[0];
    await c.post(`/api/v1/notes/${noteId}/versions`).send({ sceneJson: EDITED });
    await c.put(`/api/v1/notes/${noteId}/draft`).send({ sceneJson: { elements: [rect("draft-only")] }, baseRevision: 0 });
    const res = await c.post(`/api/v1/notes/${noteId}/restore/${v1.id}`);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ version: { versionNumber: 4, kind: "restore", restoredFromVersionId: v1.id }, draftRevision: 0 });
    expect(res.body.data.sceneJson).toEqual(SCENE);
    const list = (await c.get(`/api/v1/notes/${noteId}/versions`)).body.data.items;
    expect(list.map((v) => v.kind)).toEqual(["restore", "draft", "snapshot", "generated"]);
    const kept = await c.get(`/api/v1/notes/${noteId}/versions/${list[1].id}`);
    expect(kept.body.data.version.sceneJson.elements[0].id).toBe("draft-only");
  });

  it("version detail returns scene + plan; unknown versions 404", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    const v1 = (await s.call(s.alice).get(`/api/v1/notes/${noteId}/versions`)).body.data.items[0];
    const res = await s.call(s.alice).get(`/api/v1/notes/${noteId}/versions/${v1.id}`);
    expect(res.body.data.version).toMatchObject({ versionNumber: 1, sceneJson: SCENE, learningPlan: PLAN });
    expect((await s.call(s.alice).get(`/api/v1/notes/${noteId}/versions/${UNKNOWN}`)).status).toBe(404);
    expect((await s.call(s.alice).post(`/api/v1/notes/${noteId}/restore/${UNKNOWN}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("exports", () => {
  it.each([
    ["png", "image/png", "light", false],
    ["svg", "image/svg+xml", "dark", true],
  ])("renders %s, stores it privately and returns a download URL", async (format, type, theme, transparent) => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    const res = await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({ format, theme, transparent });
    expect(res.status).toBe(201);
    const e = res.body.data.export;
    expect(e).toMatchObject({ format, theme, transparent, status: "completed", width: 800, height: 600, source: "version" });
    expect(e.downloadUrl).toContain(`/note-exports/${s.alice.user.id}/${noteId}/`);
    expect(e.downloadUrl).toContain("ttl=600");
    expect(e.downloadUrl).toContain(`download=tcp-handshake.${format}`);
    const stored = [...s.notes.storage.objects.entries()].find(([k]) => k.startsWith("note-exports/"));
    expect(stored[0]).toMatch(new RegExp(`/export-${e.id}\\.${format}$`));
    expect(stored[1].contentType).toBe(type);
    expect(s.notes.renderer.calls.at(-1)).toMatchObject({ format, theme, transparent });
  });

  it("exports an editable .excalidraw file of the latest autosaved scene without rendering", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    await s.idle();
    const rendersBefore = s.notes.renderer.calls.length;
    await s.call(s.alice).put(`/api/v1/notes/${noteId}/draft`).send({ sceneJson: EDITED, baseRevision: 0 });
    const res = await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({ format: "excalidraw", transparent: true });
    const e = res.body.data.export;
    expect(e).toMatchObject({ format: "excalidraw", source: "draft", transparent: false, status: "completed" });
    expect(s.notes.renderer.calls.length).toBe(rendersBefore);
    const [, obj] = [...s.notes.storage.objects.entries()].find(([k]) => k.endsWith(".excalidraw"));
    const file = JSON.parse(obj.buffer.toString("utf8"));
    expect(file).toMatchObject({ type: "excalidraw", version: 2, files: {} });
    expect(file.elements.map((el) => el.id)).toEqual(["r1", "r2"]);
    expect(obj.contentType).toBe("application/json");
  });

  it("GET /exports/:id returns a fresh signed URL to the owner only", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    const e = (await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({ format: "png" })).body.data.export;
    const mine = await s.call(s.alice).get(`/api/v1/exports/${e.id}`);
    expect(mine.body.data.export).toMatchObject({ id: e.id, status: "completed", downloadUrl: expect.stringContaining("ttl=600") });
    expect(new Date(mine.body.data.export.downloadExpiresAt).getTime() - Date.now()).toBeLessThanOrEqual(600_000);
    expect((await s.call(s.bob).get(`/api/v1/exports/${e.id}`)).status).toBe(404);
    expect((await s.call(s.alice).get(`/api/v1/exports/${UNKNOWN}`)).status).toBe(404);
  });

  it("rejects invalid formats/themes and reports render failures safely", async () => {
    const s = setup();
    const { noteId } = await s.saveNote(s.alice);
    for (const body of [{ format: "pdf" }, { format: "png", theme: "neon" }, { format: "png", transparent: "yes" }, {}]) {
      expect((await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send(body)).status).toBe(400);
    }
    s.notes.renderer.fail = true;
    const res = await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({ format: "png" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: "EXPORT_FAILED", message: "The export couldn't be created. Please try again." });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|CLI_EXEC/);
    const row = s.notes.db.exports.get(res.body.error.details.exportId);
    expect(row).toMatchObject({ status: "failed", error_code: "EXPORT_FAILED", object_path: null });
  });
});

// ---------------------------------------------------------------------------
describe("PATCH /api/v1/me preferences.theme", () => {
  it.each(["light", "dark", "system"])("accepts theme=%s", async (theme) => {
    const s = setup();
    const res = await s.call(s.alice).patch("/api/v1/me").send({ preferences: { theme } });
    expect(res.status).toBe(200);
    expect(res.body.data.profile.preferences.theme).toBe(theme);
  });

  it("rejects unknown themes", async () => {
    const s = setup();
    const res = await s.call(s.alice).patch("/api/v1/me").send({ preferences: { theme: "neon" } });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain("preferences.theme");
  });
});

// ---------------------------------------------------------------------------
describe("Phase 5: selective/ZIP export, study companion & single-section regeneration", () => {
  const MULTI_PLAN = {
    schemaVersion: "1.0",
    title: "TCP Handshake",
    summary: "How TCP connects.",
    learningObjectives: ["Trace SYN"],
    sections: [
      { id: "sec1", title: "Handshake", visualType: "flowchart", keyConcepts: ["SYN"], relationships: [], explanation: "Client sends SYN.", sourceRefs: [] },
      { id: "sec2", title: "Teardown", visualType: "flowchart", keyConcepts: ["FIN"], relationships: [], explanation: "Client sends FIN.", sourceRefs: [] },
    ],
    warnings: [],
  };
  const MULTI_SCENE = {
    type: "excalidraw",
    elements: [
      { id: "sec1__frame", type: "frame", name: "1. Handshake", x: 0, y: 0, width: 200, height: 120 },
      { id: "sec1__box", type: "rectangle", x: 10, y: 10, width: 120, height: 60, frameId: "sec1__frame" },
      { id: "sec2__frame", type: "frame", name: "2. Teardown", x: 0, y: 300, width: 200, height: 120 },
      { id: "sec2__box", type: "rectangle", x: 10, y: 310, width: 120, height: 60, frameId: "sec2__frame" },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
  };

  it("enforces auth, 404 ownership isolation, and 503 when AI is disabled across Phase 5 endpoints", async () => {
    const ctx = buildTestApp({}, { notes: { companionEnabled: false } });
    const alice = ctx.addUser({ email: "a@example.test" });
    const bob = ctx.addUser({ email: "b@example.test" });
    const call = (who) => ({
      get: (u) => request(ctx.app).get(u).set("Authorization", `Bearer ${who.token}`),
      post: (u) => request(ctx.app).post(u).set("Authorization", `Bearer ${who.token}`),
      patch: (u) => request(ctx.app).patch(u).set("Authorization", `Bearer ${who.token}`),
    });
    const j = ctx.generation.store.seed({ owner_id: alice.user.id, input_text: "TCP", status: "completed", progress: 100, learning_plan: MULTI_PLAN, scene_json: MULTI_SCENE, settings: {} });
    const noteRes = await call(alice).post("/api/v1/notes").send({ jobId: j.id });
    const noteId = noteRes.body.data.note.id;

    // 401 before body parsing
    const unauth = await request(ctx.app).post(`/api/v1/notes/${noteId}/ask`).set("Content-Type", "application/json").send("{bad");
    expect(unauth.status).toBe(401);

    // Identical 404 for Bob vs unknown/malformed note ID
    for (const id of [noteId, UNKNOWN, "bad-id"]) {
      expect((await call(bob).get(`/api/v1/notes/${id}/study`)).status).toBe(404);
      expect((await call(bob).post(`/api/v1/notes/${id}/quiz`).send({})).status).toBe(404);
      expect((await call(bob).post(`/api/v1/notes/${id}/ask`).send({ question: "Why?" })).status).toBe(404);
      expect((await call(bob).post(`/api/v1/notes/${id}/sections/sec1/regenerate`).send({ title: "X" })).status).toBe(404);
    }

    // 503 AI_UNAVAILABLE for owner when Gemini disabled
    const noAi = await call(alice).post(`/api/v1/notes/${noteId}/quiz`).send({});
    expect(noAi.status).toBe(503);
    expect(noAi.body.error.code).toBe("AI_UNAVAILABLE");
  });

  it("supports single-frame export and multi-slide ZIP export with valid PKZIP buffer", async () => {
    const s = setup();
    const j = s.job(s.alice, { learning_plan: MULTI_PLAN, scene_json: MULTI_SCENE });
    const noteId = (await s.call(s.alice).post("/api/v1/notes").send({ jobId: j.id })).body.data.note.id;

    const frameExp = await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({ format: "png", scope: "frame", frameId: "sec2__frame" });
    expect(frameExp.status).toBe(201);
    expect(frameExp.body.data.export).toMatchObject({ format: "png", scope: "frame", frameId: "sec2__frame", status: "completed" });
    expect(s.notes.renderer.calls.at(-1).elements).toBe(1);

    const zipExp = await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({ format: "zip", slideFormat: "svg", theme: "dark" });
    expect(zipExp.status).toBe(201);
    expect(zipExp.body.data.export).toMatchObject({ format: "zip", scope: "full", status: "completed" });
    const [, obj] = [...s.notes.storage.objects.entries()].find(([k]) => k.endsWith(".zip"));
    expect(obj.contentType).toBe("application/zip");
    expect(obj.buffer.subarray(0, 4).toString("hex")).toBe("504b0304"); // PK\x03\x04
    expect(obj.buffer.toString("utf8")).toContain("manifest.json");
  });

  it("runs full study companion lifecycle (explain, quiz, flashcards, revision, ask, section regenerate) & logs zero secrets", async () => {
    const s = setup();
    const j = s.job(s.alice, { learning_plan: MULTI_PLAN, scene_json: MULTI_SCENE });
    const noteId = (await s.call(s.alice).post("/api/v1/notes").send({ jobId: j.id })).body.data.note.id;
    const SECRET_QUESTION = "SECRET_PROMPT_STRING_MUST_NOT_APPEAR_IN_LOGS";

    const explain = await s.call(s.alice).post(`/api/v1/notes/${noteId}/explain`).send({ selectedElements: [{ id: "sec1__box", type: "rectangle", text: "SYN" }], question: SECRET_QUESTION });
    expect(explain.status).toBe(200);
    expect(explain.body.data.keyPoint).toBeTruthy();

    const quizRes = await s.call(s.alice).post(`/api/v1/notes/${noteId}/quiz`).send({ difficulty: "mixed", questionCount: 3 });
    expect(quizRes.status).toBe(201);
    const quizId = quizRes.body.data.quiz.id;
    const quizPatch = await s.call(s.alice).patch(`/api/v1/notes/${noteId}/quiz/${quizId}`).send({ answers: { q1: 0, q2: 1, q3: 0 } });
    expect(quizPatch.status).toBe(200);
    expect(quizPatch.body.data.quiz).toMatchObject({ score: 3, totalQuestions: 3 });

    const cardsRes = await s.call(s.alice).post(`/api/v1/notes/${noteId}/flashcards`).send({ cardCount: 4 });
    expect(cardsRes.status).toBe(201);
    const cardId = cardsRes.body.data.items[0].id;
    const cardPatch = await s.call(s.alice).patch(`/api/v1/notes/${noteId}/flashcards/${cardId}`).send({ mastery: "known" });
    expect(cardPatch.status).toBe(200);
    expect(cardPatch.body.data.flashcard).toMatchObject({ mastery: "known", reviewCount: 1 });

    const revRes = await s.call(s.alice).post(`/api/v1/notes/${noteId}/revision`).send({});
    expect(revRes.status).toBe(201);
    expect(revRes.body.data.revisionGuide.summary).toBeTruthy();

    const askRes = await s.call(s.alice).post(`/api/v1/notes/${noteId}/ask`).send({ question: SECRET_QUESTION });
    expect(askRes.status).toBe(200);
    expect(askRes.body.data).toMatchObject({ grounded: true, citations: [{ sectionId: "sec1" }] });

    const studyState = await s.call(s.alice).get(`/api/v1/notes/${noteId}/study`);
    expect(studyState.status).toBe(200);
    expect(studyState.body.data.quiz.score).toBe(3);
    expect(studyState.body.data.flashcards).toHaveLength(4);
    expect(studyState.body.data.revisionGuide.keyTerms).toHaveLength(1);

    const regen = await s.call(s.alice).post(`/api/v1/notes/${noteId}/sections/sec1/regenerate`).send({ title: "New Handshake", visualType: "flowchart" });
    expect(regen.status).toBe(201);
    expect(regen.body.data.version).toMatchObject({ versionNumber: 2, kind: "regenerate" });
    expect(regen.body.data.sceneJson.elements.some((e) => e.id === "sec1__regen_box")).toBe(true);
    expect(regen.body.data.sceneJson.elements.some((e) => e.id === "sec2__box")).toBe(true);

    expect(s.notes.db.usageEvents.length).toBeGreaterThanOrEqual(6);
    expect(s.logText()).not.toContain(SECRET_QUESTION);
  });
});
