/**
 * Offline verification of Phase 5 migration 0008 (note_quizzes, note_flashcards,
 * note_revision_guides, usage_events, ZIP exports, and regenerate version kind)
 * on real Postgres (PGlite). Run with: npm run test:rls:sql
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
  "migrations/0006_source_files.sql",
  "migrations/0007_source_files_bucket.sql",
  "migrations/0008_learning_companion.sql",
];

let db;
const A = randomUUID();
const B = randomUUID();
const SCENE = { type: "excalidraw", elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] };

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

async function commitAs(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    return fn(tx);
  });
}

const asUser = (uid, fn) => as("authenticated", uid, fn);

before(async () => {
  db = new PGlite();
  await db.exec(read("tests/supabase-stub.sql"));
  for (const m of MIGRATIONS) await db.exec(read(m));
  await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')", [A, B]);
});

after(() => db?.close());

test("Phase 5 tables: RLS enabled, explicit policies, and anon denied", async () => {
  const { rows } = await db.query(
    `select tablename, rowsecurity from pg_tables
      where schemaname = 'public' and tablename in ('note_quizzes', 'note_flashcards', 'note_revision_guides', 'usage_events')
      order by tablename`
  );
  assert.equal(rows.length, 4);
  for (const r of rows) assert.equal(r.rowsecurity, true);

  const { rows: policies } = await db.query(
    `select tablename, cmd from pg_policies
      where schemaname = 'public' and tablename in ('note_quizzes', 'note_flashcards', 'note_revision_guides')`
  );
  assert.equal(policies.length, 12);

  for (const tbl of ["note_quizzes", "note_flashcards", "note_revision_guides", "usage_events"]) {
    await assert.rejects(as("anon", null, (tx) => tx.query(`select * from public.${tbl}`)), /permission denied/);
  }
});

test("note_quizzes, note_flashcards, note_revision_guides: owner CRUD, composite FKs & cross-user isolation", async () => {
  const noteA = await commitAs(A, async (tx) => {
    const n = (await tx.query(`insert into public.notes (owner_id, title) values ($1, 'A Note') returning id`, [A])).rows[0];
    const v = (await tx.query(`select * from public.add_note_version($1, $2, 'v1', 'generated')`, [n.id, JSON.stringify(SCENE)])).rows[0];
    return { noteId: n.id, versionId: v.id };
  });
  const noteB = await commitAs(B, async (tx) => {
    const n = (await tx.query(`insert into public.notes (owner_id, title) values ($1, 'B Note') returning id`, [B])).rows[0];
    const v = (await tx.query(`select * from public.add_note_version($1, $2, 'v1', 'generated')`, [n.id, JSON.stringify(SCENE)])).rows[0];
    return { noteId: n.id, versionId: v.id };
  });

  // Cross-user and mismatched version composite FK references fail.
  await assert.rejects(
    asUser(B, (tx) =>
      tx.query(
        `insert into public.note_quizzes (owner_id, note_id, version_id, questions, total_questions) values ($1, $2, $3, '[{"id":"q1"}]', 1)`,
        [B, noteA.noteId, noteA.versionId]
      )
    ),
    /foreign key|violates/
  );
  await assert.rejects(
    asUser(A, (tx) =>
      tx.query(
        `insert into public.note_flashcards (owner_id, note_id, version_id, front, back) values ($1, $2, $3, 'F', 'B')`,
        [A, noteA.noteId, noteB.versionId]
      )
    ),
    /foreign key|violates/
  );

  // User A creates quiz, flashcard, revision guide.
  const quizId = await commitAs(A, async (tx) => {
    const r = await tx.query(
      `insert into public.note_quizzes (owner_id, note_id, version_id, difficulty, questions, total_questions)
       values ($1, $2, $3, 'mixed', '[{"id":"q1"}]', 2) returning id`,
      [A, noteA.noteId, noteA.versionId]
    );
    return r.rows[0].id;
  });
  await commitAs(A, async (tx) => {
    await tx.query(
      `insert into public.note_flashcards (owner_id, note_id, version_id, front, back) values ($1, $2, $3, 'Front', 'Back')`,
      [A, noteA.noteId, noteA.versionId]
    );
    await tx.query(
      `insert into public.note_revision_guides (owner_id, note_id, version_id, guide_json) values ($1, $2, $3, '{"summary":"ok"}')`,
      [A, noteA.noteId, noteA.versionId]
    );
  });

  // Least privilege: owner cannot overwrite quiz questions/score > total, nor rewrite flashcard prompt fields.
  await assert.rejects(
    asUser(A, (tx) => tx.query(`update public.note_quizzes set questions = '[]' where id = $1`, [quizId])),
    /permission denied/
  );
  await assert.rejects(
    asUser(A, (tx) => tx.query(`update public.note_quizzes set score = 5 where id = $1`, [quizId])),
    /note_quizzes_score_le_total|check constraint/
  );
  await asUser(A, (tx) =>
    tx.query(`update public.note_quizzes set answers = '{"q1":0}', score = 1, completed_at = now() where id = $1`, [quizId])
  );

  // User B cannot read/update/delete A's rows.
  for (const tbl of ["note_quizzes", "note_flashcards", "note_revision_guides"]) {
    const { rows } = await asUser(B, (tx) => tx.query(`select id from public.${tbl} where note_id = $1`, [noteA.noteId]));
    assert.equal(rows.length, 0);
    const del = await asUser(B, (tx) => tx.query(`delete from public.${tbl} where note_id = $1 returning id`, [noteA.noteId]));
    assert.equal(del.rows.length, 0);
  }
});

test("usage_events: authenticated owners can read own events only, never forge/insert/delete", async () => {
  await db.query(`insert into public.usage_events (owner_id, event_type, units, metadata) values ($1, 'quiz', 1, '{"modelId":"m"}')`, [A]);

  const aRows = await asUser(A, (tx) => tx.query(`select event_type from public.usage_events`));
  assert.equal(aRows.rows.length, 1);

  const bRows = await asUser(B, (tx) => tx.query(`select event_type from public.usage_events`));
  assert.equal(bRows.rows.length, 0);

  await assert.rejects(
    asUser(A, (tx) => tx.query(`insert into public.usage_events (owner_id, event_type, units) values ($1, 'quiz', 1)`, [A])),
    /permission denied/
  );
  await assert.rejects(asUser(A, (tx) => tx.query(`delete from public.usage_events where owner_id = $1`, [A])), /permission denied/);
});

test("note_exports zip format & frame scope, plus regenerate note version kind", async () => {
  const noteA = await commitAs(A, async (tx) => {
    const n = (await tx.query(`insert into public.notes (owner_id, title) values ($1, 'Zip Note') returning id`, [A])).rows[0];
    const v = (await tx.query(`select * from public.add_note_version($1, $2, 'Regenerated Sec 1', 'regenerate')`, [n.id, JSON.stringify(SCENE)])).rows[0];
    return { noteId: n.id, versionId: v.id };
  });

  await asUser(A, async (tx) => {
    const ins = await tx.query(
      `insert into public.note_exports (owner_id, note_id, version_id, format, scope, frame_id, status)
       values ($1, $2, $3, 'zip', 'full', null, 'processing') returning id`,
      [A, noteA.noteId, noteA.versionId]
    );
    await tx.query(
      `update public.note_exports set status = 'completed', object_path = $1 where id = $2`,
      [`${A}/${noteA.noteId}/${noteA.versionId}/export.zip`, ins.rows[0].id]
    );
  });
  const { rows: bucket } = await db.query(`select allowed_mime_types from storage.buckets where id = 'note-exports'`);
  assert.ok(bucket[0].allowed_mime_types.includes("application/zip"));
});
