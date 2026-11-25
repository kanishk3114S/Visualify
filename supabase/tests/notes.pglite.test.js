/**
 * Offline verification of migrations 0004 (folders/notes/versions/drafts/exports)
 * and 0005 (note storage buckets) on a real Postgres engine (PGlite), as the
 * `authenticated` / `anon` roles. Run with: npm run test:rls:sql
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const MIGRATIONS = [
  "migrations/0001_profiles_and_rls.sql",
  "migrations/0002_avatars_storage_bucket.sql",
  "migrations/0003_generation_jobs.sql",
  "migrations/0004_folders_notes_versions_exports.sql",
  "migrations/0005_note_storage_buckets.sql",
];

let db;
const A = randomUUID();
const B = randomUUID();
const SCENE = { type: "excalidraw", elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] };
const SCENE2 = { type: "excalidraw", elements: [{ id: "r2", type: "ellipse", x: 5, y: 5, width: 20, height: 20 }] };

async function as(role, uid, fn) {
  let result;
  let error = null;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [uid ? JSON.stringify({ sub: uid, role }) : ""]);
      result = await fn(tx);
      throw new Error("__rollback__");
    });
  } catch (err) {
    if (err.message !== "__rollback__") error = err;
  }
  if (error) throw error;
  return result;
}

/** Like `as` but COMMITS, for multi-step scenarios. */
async function commitAs(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    return fn(tx);
  });
}

const asUser = (uid, fn) => as("authenticated", uid, fn);

async function completedJob(owner) {
  const { rows } = await db.query(
    `insert into public.generation_jobs (owner_id, input_text) values ($1, 'topic') returning id`,
    [owner]
  );
  await db.query(
    `update public.generation_jobs set status = 'completed', progress = 100, learning_plan = '{"title":"Plan"}', scene_json = $2, mermaid_source = 'graph TD' where id = $1`,
    [rows[0].id, JSON.stringify(SCENE)]
  );
  return rows[0].id;
}

/** Saves a job as a note for `owner` (committed). */
async function saveNote(owner, title = "My note", folderId = null) {
  const job = await completedJob(owner);
  return commitAs(owner, async (tx) => {
    const { rows } = await tx.query(`select * from public.create_note_from_job($1, $2, $3)`, [job, title, folderId]);
    return { job, noteId: rows[0].note_id, versionId: rows[0].version_id };
  });
}

before(async () => {
  db = new PGlite();
  await db.exec(read("tests/supabase-stub.sql"));
  for (const f of MIGRATIONS) await db.exec(read(f));
  for (const f of MIGRATIONS) await db.exec(read(f)); // idempotent
  for (const [id, email] of [[A, "a@example.test"], [B, "b@example.test"]]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
});

after(async () => db?.close());

const TABLES = ["folders", "notes", "note_versions", "note_drafts", "note_exports"];

test("RLS enabled with 4 owner-scoped policies on every Phase 3 table, none USING (true)", async () => {
  for (const t of TABLES) {
    const { rows: rls } = await db.query(`select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass`, [t]);
    assert.equal(rls[0].relrowsecurity, true, t);
    const { rows } = await db.query(`select cmd, qual, with_check, roles from pg_policies where schemaname = 'public' and tablename = $1`, [t]);
    assert.deepEqual(rows.map((r) => r.cmd).sort(), ["DELETE", "INSERT", "SELECT", "UPDATE"], t);
    for (const r of rows) {
      assert.deepEqual(r.roles, ["authenticated"]);
      assert.notEqual((r.qual ?? "").trim(), "true");
      assert.match(`${r.qual ?? ""} ${r.with_check ?? ""}`, /owner_id/);
    }
  }
});

test("anon has no access to any Phase 3 table", async () => {
  for (const t of TABLES) {
    await assert.rejects(as("anon", null, (tx) => tx.query(`select 1 from public.${t} limit 1`)), /permission denied/, t);
  }
});

test("create_note_from_job: creates the note and immutable version 1, linked to the job", async () => {
  const { noteId, versionId, job } = await saveNote(A, "TCP basics");
  const { rows: [note] } = await db.query(`select * from public.notes where id = $1`, [noteId]);
  assert.equal(note.owner_id, A);
  assert.equal(note.title, "TCP basics");
  assert.equal(note.current_version_id, versionId);
  const { rows: [v] } = await db.query(`select * from public.note_versions where id = $1`, [versionId]);
  assert.deepEqual(
    { n: v.version_number, kind: v.kind, job: v.created_by_job_id, plan: v.learning_plan.title, mermaid: v.mermaid_source },
    { n: 1, kind: "generated", job, plan: "Plan", mermaid: "graph TD" }
  );
  assert.deepEqual(v.scene_json, SCENE);
});

test("create_note_from_job: a job can only be saved once (atomic)", async () => {
  const job = await completedJob(A);
  await commitAs(A, (tx) => tx.query(`select * from public.create_note_from_job($1, 'first')`, [job]));
  await assert.rejects(asUser(A, (tx) => tx.query(`select * from public.create_note_from_job($1, 'again')`, [job])), (e) => e.code === "23505");
  const { rows } = await db.query(`select count(*)::int as n from public.notes where title = 'again'`);
  assert.equal(rows[0].n, 0, "no orphan note left behind");
});

test("create_note_from_job: keeps edits passed as p_scene, refuses unfinished and foreign jobs", async () => {
  const job = await completedJob(A);
  const v = await asUser(A, async (tx) => {
    const { rows } = await tx.query(`select * from public.create_note_from_job($1, 'edited', null, '', '', '{}', $2)`, [job, JSON.stringify(SCENE2)]);
    return (await tx.query(`select scene_json from public.note_versions where id = $1`, [rows[0].version_id])).rows[0];
  });
  assert.deepEqual(v.scene_json, SCENE2);

  const { rows: [q] } = await db.query(`insert into public.generation_jobs (owner_id, input_text) values ($1, 'x') returning id`, [B]);
  await assert.rejects(asUser(B, (tx) => tx.query(`select * from public.create_note_from_job($1, 't')`, [q.id])), (e) => e.code === "22023");
  await db.query(`update public.generation_jobs set status = 'cancelled' where id = $1`, [q.id]);
  await assert.rejects(asUser(B, (tx) => tx.query(`select * from public.create_note_from_job($1, 't')`, [job])), (e) => e.code === "P0002");
});

test("user B cannot read, update or delete user A's notes, versions, drafts, exports or folders", async () => {
  const { noteId, versionId } = await saveNote(A, "private");
  await commitAs(A, async (tx) => {
    await tx.query(`insert into public.note_drafts (note_id, owner_id, scene_json) values ($1, $2, $3)`, [noteId, A, JSON.stringify(SCENE2)]);
    await tx.query(`insert into public.folders (owner_id, name) values ($1, 'A folder')`, [A]);
    await tx.query(`insert into public.note_exports (owner_id, note_id, version_id, format) values ($1, $2, $3, 'png')`, [A, noteId, versionId]);
  });
  const result = await asUser(B, async (tx) => {
    const out = {};
    for (const t of TABLES) out[`read_${t}`] = (await tx.query(`select 1 from public.${t} where owner_id = $1`, [A])).rows.length;
    out.updNote = (await tx.query(`update public.notes set title = 'pwned' where id = $1`, [noteId])).affectedRows;
    out.delNote = (await tx.query(`delete from public.notes where id = $1`, [noteId])).affectedRows;
    out.updDraft = (await tx.query(`update public.note_drafts set revision = 9 where note_id = $1`, [noteId])).affectedRows;
    out.delFolder = (await tx.query(`delete from public.folders where owner_id = $1`, [A])).affectedRows;
    out.delExport = (await tx.query(`delete from public.note_exports where owner_id = $1`, [A])).affectedRows;
    return out;
  });
  for (const [k, v] of Object.entries(result)) assert.equal(v, 0, k);
  await assert.rejects(asUser(B, (tx) => tx.query(`select * from public.add_note_version($1, $2)`, [noteId, JSON.stringify(SCENE)])), (e) => e.code === "P0002");
  await assert.rejects(asUser(B, (tx) => tx.query(`select * from public.duplicate_note($1, 'steal')`, [noteId])), (e) => e.code === "P0002");
  await assert.rejects(asUser(B, (tx) => tx.query(`select * from public.restore_note_version($1, $2)`, [noteId, versionId])), (e) => e.code === "P0002");
});

test("cross-user references are impossible even with direct inserts", async () => {
  const { noteId } = await saveNote(A, "a-note");
  const { rows: [bFolder] } = await commitAs(B, (tx) => tx.query(`insert into public.folders (owner_id, name) values ($1, 'B only') returning id`, [B]));
  // A note in someone else's folder
  await assert.rejects(asUser(A, (tx) => tx.query(`update public.notes set folder_id = $1 where id = $2`, [bFolder.id, noteId])), (e) => e.code === "23503");
  // A version claiming another user's note
  await assert.rejects(
    asUser(B, (tx) => tx.query(`insert into public.note_versions (note_id, owner_id, version_number, scene_json) values ($1, $2, 99, '{}')`, [noteId, B])),
    (e) => e.code === "23503"
  );
  // A version referencing another user's generation job
  const aJob = await completedJob(A);
  const { noteId: bNote } = await saveNote(B, "b-note");
  await assert.rejects(
    asUser(B, (tx) =>
      tx.query(`insert into public.note_versions (note_id, owner_id, version_number, scene_json, created_by_job_id) values ($1, $2, 50, '{}', $3)`, [bNote, B, aJob])
    ),
    /row-level security/
  );
  // current_version_id pointing at another note's version
  const { versionId: otherV } = await saveNote(A, "other");
  await assert.rejects(asUser(A, (tx) => tx.query(`update public.notes set current_version_id = $1 where id = $2`, [otherV, noteId])), (e) => e.code === "23503");
});

test("note_versions are immutable for clients and version numbers are unique per note", async () => {
  const { noteId, versionId } = await saveNote(A, "immutable");
  await assert.rejects(asUser(A, (tx) => tx.query(`update public.note_versions set scene_json = '{}' where id = $1`, [versionId])), /permission denied/);
  await assert.rejects(asUser(A, (tx) => tx.query(`delete from public.note_versions where id = $1`, [versionId])), /permission denied/);
  await assert.rejects(
    asUser(A, (tx) => tx.query(`insert into public.note_versions (note_id, owner_id, version_number, scene_json) values ($1, $2, 1, '{}')`, [noteId, A])),
    (e) => e.code === "23505"
  );
});

test("add_note_version: next number, moves current pointer, clears the draft, carries the plan", async () => {
  const { noteId } = await saveNote(A, "versions");
  await commitAs(A, (tx) => tx.query(`insert into public.note_drafts (note_id, owner_id, scene_json) values ($1, $2, $3)`, [noteId, A, JSON.stringify(SCENE2)]));
  const out = await commitAs(A, async (tx) => {
    const v = (await tx.query(`select * from public.add_note_version($1, $2, 'my snapshot')`, [noteId, JSON.stringify(SCENE2)])).rows[0];
    const note = (await tx.query(`select current_version_id from public.notes where id = $1`, [noteId])).rows[0];
    const draft = (await tx.query(`select 1 from public.note_drafts where note_id = $1`, [noteId])).rows.length;
    const plan = (await tx.query(`select learning_plan, description from public.note_versions where id = $1`, [v.id])).rows[0];
    return { v, note, draft, plan };
  });
  assert.equal(out.v.version_number, 2);
  assert.equal(out.v.kind, "snapshot");
  assert.equal(out.note.current_version_id, out.v.id);
  assert.equal(out.draft, 0);
  assert.equal(out.plan.learning_plan.title, "Plan");
  assert.equal(out.plan.description, "my snapshot");
});

test("restore_note_version: keeps the unsnapshotted draft, then appends the restored scene (no history lost)", async () => {
  const { noteId, versionId: v1 } = await saveNote(A, "restore");
  await commitAs(A, (tx) => tx.query(`select * from public.add_note_version($1, $2, 'v2')`, [noteId, JSON.stringify(SCENE2)]));
  const DRAFT = { elements: [{ id: "d", type: "text", x: 1, y: 1, width: 5, height: 5, text: "draft" }] };
  await commitAs(A, (tx) => tx.query(`insert into public.note_drafts (note_id, owner_id, scene_json) values ($1, $2, $3)`, [noteId, A, JSON.stringify(DRAFT)]));
  const restored = await commitAs(A, async (tx) => (await tx.query(`select * from public.restore_note_version($1, $2)`, [noteId, v1])).rows[0]);
  const { rows } = await db.query(`select version_number, kind, scene_json, restored_from_version_id from public.note_versions where note_id = $1 order by version_number`, [noteId]);
  assert.deepEqual(rows.map((r) => [r.version_number, r.kind]), [[1, "generated"], [2, "snapshot"], [3, "draft"], [4, "restore"]]);
  assert.deepEqual(rows[2].scene_json, DRAFT);
  assert.deepEqual(rows[3].scene_json, SCENE);
  assert.equal(rows[3].restored_from_version_id, v1);
  assert.equal(restored.version_number, 4);
  const { rows: [note] } = await db.query(`select current_version_id from public.notes where id = $1`, [noteId]);
  assert.equal(note.current_version_id, restored.id);
});

test("duplicate_note: independent copy of the latest saved scene", async () => {
  const { noteId } = await saveNote(A, "original");
  await commitAs(A, (tx) => tx.query(`insert into public.note_drafts (note_id, owner_id, scene_json) values ($1, $2, $3)`, [noteId, A, JSON.stringify(SCENE2)]));
  const dup = await commitAs(A, async (tx) => (await tx.query(`select * from public.duplicate_note($1, 'Copy of original')`, [noteId])).rows[0]);
  assert.notEqual(dup.note_id, noteId);
  const { rows: [v] } = await db.query(`select version_number, kind, scene_json, learning_plan from public.note_versions where id = $1`, [dup.version_id]);
  assert.deepEqual([v.version_number, v.kind], [1, "duplicate"]);
  assert.deepEqual(v.scene_json, SCENE2, "uses the newer autosaved draft");
  assert.equal(v.learning_plan.title, "Plan");
  await commitAs(A, (tx) => tx.query(`delete from public.notes where id = $1`, [noteId]));
  const { rows } = await db.query(`select 1 from public.notes where id = $1`, [dup.note_id]);
  assert.equal(rows.length, 1, "copy survives deleting the original");
});

test("folders: cycles and self-parenting rejected; sibling names unique; depth limited", async () => {
  const ids = await commitAs(A, async (tx) => {
    const top = (await tx.query(`insert into public.folders (owner_id, name) values ($1, 'Top') returning id`, [A])).rows[0].id;
    const mid = (await tx.query(`insert into public.folders (owner_id, name, parent_id) values ($1, 'Mid', $2) returning id`, [A, top])).rows[0].id;
    const leaf = (await tx.query(`insert into public.folders (owner_id, name, parent_id) values ($1, 'Leaf', $2) returning id`, [A, mid])).rows[0].id;
    return { top, mid, leaf };
  });
  await assert.rejects(asUser(A, (tx) => tx.query(`update public.folders set parent_id = $1 where id = $2`, [ids.leaf, ids.top])), /folder_cycle/);
  await assert.rejects(asUser(A, (tx) => tx.query(`update public.folders set parent_id = $1 where id = $1`, [ids.mid])), (e) => e.code === "23514");
  await assert.rejects(asUser(A, (tx) => tx.query(`insert into public.folders (owner_id, name, parent_id) values ($1, ' mid ', $2)`, [A, ids.top])), (e) => e.code === "23505");
  // same name under a different parent is fine
  await asUser(A, (tx) => tx.query(`insert into public.folders (owner_id, name, parent_id) values ($1, 'Mid', $2)`, [A, ids.leaf]));
  // depth limit
  await assert.rejects(
    commitAs(A, async (tx) => {
      let parent = ids.leaf;
      for (let i = 0; i < 9; i += 1) parent = (await tx.query(`insert into public.folders (owner_id, name, parent_id) values ($1, $2, $3) returning id`, [A, `d${i}`, parent])).rows[0].id;
    }),
    /folder_too_deep/
  );
  await assert.rejects(asUser(A, (tx) => tx.query(`insert into public.folders (owner_id, name) values ($1, '   ')`, [A])), /folders_name_length/);
});

test("delete_folder: notes move to root and subfolders move up one level", async () => {
  const ids = await commitAs(A, async (tx) => {
    const parent = (await tx.query(`insert into public.folders (owner_id, name) values ($1, 'P-del') returning id`, [A])).rows[0].id;
    const doomed = (await tx.query(`insert into public.folders (owner_id, name, parent_id) values ($1, 'Doomed', $2) returning id`, [A, parent])).rows[0].id;
    const child = (await tx.query(`insert into public.folders (owner_id, name, parent_id) values ($1, 'Child', $2) returning id`, [A, doomed])).rows[0].id;
    return { parent, doomed, child };
  });
  const { noteId } = await saveNote(A, "in folder", ids.doomed);
  await commitAs(A, (tx) => tx.query(`select public.delete_folder($1)`, [ids.doomed]));
  const { rows: [n] } = await db.query(`select folder_id from public.notes where id = $1`, [noteId]);
  const { rows: [c] } = await db.query(`select parent_id from public.folders where id = $1`, [ids.child]);
  const { rows: gone } = await db.query(`select 1 from public.folders where id = $1`, [ids.doomed]);
  assert.equal(n.folder_id, null);
  assert.equal(c.parent_id, ids.parent);
  assert.equal(gone.length, 0);
  await assert.rejects(asUser(B, (tx) => tx.query(`select public.delete_folder($1)`, [ids.parent])), (e) => e.code === "P0002");
});

test("updated_at reflects content edits and autosaves, not opening the note", async () => {
  const { noteId } = await saveNote(A, "timestamps");
  await db.query(`update public.notes set updated_at = '2001-01-01' where id = $1`, [noteId]);
  const ts = async () => (await db.query(`select updated_at from public.notes where id = $1`, [noteId])).rows[0].updated_at.toISOString();
  await commitAs(A, (tx) => tx.query(`update public.notes set last_opened_at = now() where id = $1`, [noteId]));
  assert.equal(await ts(), "2001-01-01T00:00:00.000Z");
  await commitAs(A, (tx) => tx.query(`update public.notes set preview_path = $2 where id = $1`, [noteId, `${A}/${noteId}/v/preview.png`]));
  assert.equal(await ts(), "2001-01-01T00:00:00.000Z");
  await commitAs(A, (tx) => tx.query(`insert into public.note_drafts (note_id, owner_id, scene_json) values ($1, $2, '{}')`, [noteId, A]));
  assert.notEqual(await ts(), "2001-01-01T00:00:00.000Z");
  await db.query(`update public.notes set updated_at = '2001-01-01' where id = $1`, [noteId]);
  await commitAs(A, (tx) => tx.query(`update public.notes set title = 'renamed' where id = $1`, [noteId]));
  assert.notEqual(await ts(), "2001-01-01T00:00:00.000Z");
  await assert.rejects(asUser(A, (tx) => tx.query(`update public.notes set updated_at = now() where id = $1`, [noteId])), /permission denied/);
});

test("constraints: tags normalised & bounded, paths owner-scoped, export state invariants", async () => {
  const { noteId, versionId } = await saveNote(A, "constraints");
  for (const [sql, re] of [
    [`update public.notes set tags = '{Uppercase}' where id = $1`, /notes_tags_valid/],
    [`update public.notes set tags = (select array_agg('t' || g) from generate_series(1, 21) g) where id = $1`, /notes_tags_valid/],
    [`update public.notes set title = '' where id = $1`, /notes_title_length/],
    [`update public.notes set preview_path = 'someone-else/x/preview.png' where id = $1`, /notes_preview_path_owner/],
  ]) {
    await assert.rejects(asUser(A, (tx) => tx.query(sql, [noteId])), re, sql);
  }
  const exportId = (await commitAs(A, (tx) => tx.query(`insert into public.note_exports (owner_id, note_id, version_id, format) values ($1, $2, $3, 'svg') returning id`, [A, noteId, versionId]))).rows[0].id;
  for (const [sql, re] of [
    [`update public.note_exports set status = 'completed' where id = $1`, /note_exports_completed_has_object/],
    [`update public.note_exports set status = 'failed' where id = $1`, /note_exports_failed_has_error/],
    [`update public.note_exports set object_path = 'evil/path.svg' where id = $1`, /note_exports_object_path_owner/],
  ]) {
    await assert.rejects(asUser(A, (tx) => tx.query(sql, [exportId])), re, sql);
  }
  await assert.rejects(
    asUser(A, (tx) => tx.query(`insert into public.note_exports (owner_id, note_id, version_id, format) values ($1, $2, $3, 'pdf')`, [A, noteId, versionId])),
    /note_exports_format/
  );
});

test("deleting a note cascades versions/drafts/exports and unlinks its generation job", async () => {
  const { noteId, versionId, job } = await saveNote(A, "doomed");
  await db.query(`update public.generation_jobs set note_id = $2 where id = $1`, [job, noteId]);
  await commitAs(A, async (tx) => {
    await tx.query(`insert into public.note_drafts (note_id, owner_id, scene_json) values ($1, $2, '{}')`, [noteId, A]);
    await tx.query(`insert into public.note_exports (owner_id, note_id, version_id, format) values ($1, $2, $3, 'png')`, [A, noteId, versionId]);
    await tx.query(`delete from public.notes where id = $1`, [noteId]);
  });
  for (const [t, col] of [["note_versions", "note_id"], ["note_drafts", "note_id"], ["note_exports", "note_id"]]) {
    const { rows } = await db.query(`select 1 from public.${t} where ${col} = $1`, [noteId]);
    assert.equal(rows.length, 0, t);
  }
  const { rows: [j] } = await db.query(`select note_id, status from public.generation_jobs where id = $1`, [job]);
  assert.deepEqual(j, { note_id: null, status: "completed" });
});

test("storage: note buckets are private with owner-and-note-scoped write paths", async () => {
  const { rows } = await db.query(`select id, public, allowed_mime_types from storage.buckets where id in ('note-assets', 'note-exports') order by id`);
  assert.deepEqual(rows.map((r) => [r.id, r.public]), [["note-assets", false], ["note-exports", false]]);
  const { noteId, versionId } = await saveNote(A, "files");
  const { noteId: bNote } = await saveNote(B, "b-files");
  const ok = `${A}/${noteId}/${versionId}/preview.png`;
  await commitAs(A, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner) values ('note-assets', $1, $2)`, [ok, A]));
  for (const name of [
    `${B}/${bNote}/${versionId}/preview.png`, // other user's folder
    `${A}/${bNote}/${versionId}/preview.png`, // own folder, someone else's note
    `${A}/${randomUUID()}/x/preview.png`, // own folder, non-existent note
  ]) {
    await assert.rejects(
      asUser(A, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner) values ('note-exports', $1, $2)`, [name, A])),
      /row-level security/,
      name
    );
  }
  const theirs = await asUser(B, async (tx) => ({
    read: (await tx.query(`select 1 from storage.objects where name = $1`, [ok])).rows.length,
    del: (await tx.query(`delete from storage.objects where name = $1`, [ok])).affectedRows,
  }));
  assert.deepEqual(theirs, { read: 0, del: 0 });
  const mine = await asUser(A, async (tx) => (await tx.query(`select 1 from storage.objects where name = $1`, [ok])).rows.length);
  assert.equal(mine, 1);
});
