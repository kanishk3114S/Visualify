/**
 * Offline verification of Phase 4 migrations 0006 (source_files + generation_jobs
 * PDF/image support + extracting stage) and 0007 (source-files storage bucket)
 * on a real Postgres engine (PGlite). Run with: npm run test:rls:sql
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
];

let db;
const A = randomUUID();
const B = randomUUID();
const SHA256_A = "a".repeat(64);
const SHA256_B = "b".repeat(64);
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

async function insertSourceFile(owner, { mime = "application/pdf", pageCount = 12, width = null, height = null } = {}) {
  const id = randomUUID();
  const ext = mime === "application/pdf" ? "pdf" : "png";
  const objectPath = `${owner}/${id}/original.${ext}`;
  await commitAs(owner, (tx) =>
    tx.query(
      `insert into public.source_files (id, owner_id, bucket, object_path, original_name, mime_type, size_bytes, checksum, page_count, width, height)
       values ($1, $2, 'source-files', $3, 'lecture.pdf', $4, 4096, $5, $6, $7, $8)`,
      [id, owner, objectPath, mime, owner === A ? SHA256_A : SHA256_B, pageCount, width, height]
    )
  );
  return { id, objectPath };
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

test("source_files: RLS enabled with 4 explicit owner-scoped policies and anon denied", async () => {
  const { rows: rls } = await db.query(`select relrowsecurity from pg_class where oid = 'public.source_files'::regclass`);
  assert.equal(rls[0].relrowsecurity, true);
  const { rows } = await db.query(`select cmd, qual, with_check, roles from pg_policies where schemaname = 'public' and tablename = 'source_files'`);
  assert.deepEqual(rows.map((r) => r.cmd).sort(), ["DELETE", "INSERT", "SELECT", "UPDATE"]);
  for (const r of rows) {
    assert.deepEqual(r.roles, ["authenticated"]);
    assert.notEqual((r.qual ?? "").trim(), "true");
    assert.match(`${r.qual ?? ""} ${r.with_check ?? ""}`, /owner_id/);
  }
  await assert.rejects(as("anon", null, (tx) => tx.query(`select 1 from public.source_files limit 1`)), /permission denied/);
});

test("source_files: owner CRUD, cross-user isolation, path/mime/size/checksum constraints, and forged status denial", async () => {
  const sfA = await insertSourceFile(A);

  // User B cannot read or delete A's source file, or insert under A's owner_id
  assert.equal((await asUser(B, (tx) => tx.query(`select 1 from public.source_files where id = $1`, [sfA.id]))).rows.length, 0);
  assert.equal((await asUser(B, (tx) => tx.query(`delete from public.source_files where id = $1`, [sfA.id]))).affectedRows, 0);
  await assert.rejects(
    asUser(B, (tx) =>
      tx.query(
        `insert into public.source_files (id, owner_id, object_path, original_name, mime_type, size_bytes, checksum)
         values ($1, $2, $3, 'x.pdf', 'application/pdf', 100, $4)`,
        [randomUUID(), A, `${A}/${randomUUID()}/original.pdf`, SHA256_B]
      )
    ),
    /row-level security/
  );

  // Authenticated client cannot forge extraction_status, extracted_metadata, or note_id
  await assert.rejects(
    asUser(A, (tx) => tx.query(`update public.source_files set extraction_status = 'extracted' where id = $1`, [sfA.id])),
    /permission denied/
  );
  await assert.rejects(
    asUser(A, (tx) =>
      tx.query(
        `insert into public.source_files (id, owner_id, object_path, original_name, mime_type, size_bytes, checksum, extraction_status)
         values ($1, $2, $3, 'x.pdf', 'application/pdf', 100, $4, 'extracted')`,
        [randomUUID(), A, `${A}/${randomUUID()}/original.pdf`, SHA256_A]
      )
    ),
    /permission denied/
  );

  // Constraint checks: foreign path, bad mime, size > 20 MiB, bad checksum
  const badId = randomUUID();
  for (const [args, re] of [
    [[badId, A, `${B}/${badId}/original.pdf`, "application/pdf", 100, SHA256_A], /source_files_object_path_owner/],
    [[badId, A, `${A}/${badId}/original.svg`, "image/svg+xml", 100, SHA256_A], /source_files_mime_type/],
    [[badId, A, `${A}/${badId}/original.pdf`, "application/pdf", 20971521, SHA256_A], /source_files_size_bytes/],
    [[badId, A, `${A}/${badId}/original.pdf`, "application/pdf", 100, "not-sha256"], /source_files_checksum_hex/],
  ]) {
    await assert.rejects(
      asUser(A, (tx) =>
        tx.query(
          `insert into public.source_files (id, owner_id, object_path, original_name, mime_type, size_bytes, checksum)
           values ($1, $2, $3, 'f', $4, $5, $6)`,
          args
        )
      ),
      re
    );
  }
});

test("generation_jobs: supports pdf/image source_file_id + extracting stage, and blocks cross-owner source_file_id", async () => {
  const sfA = await insertSourceFile(A, { mime: "application/pdf", pageCount: 24 });
  const sfB = await insertSourceFile(B, { mime: "image/png", pageCount: null, width: 800, height: 600 });

  // Authenticated user A can insert a PDF job referencing own source_file_id and optional null input_text
  const jobA = await commitAs(A, async (tx) => {
    const { rows } = await tx.query(
      `insert into public.generation_jobs (owner_id, input_type, input_text, settings, source_file_id, page_range)
       values ($1, 'pdf', null, '{"detail":"standard"}'::jsonb, $2, '{"startPage":1,"endPage":5}'::jsonb)
       returning id, status, input_type, source_file_id`,
      [A, sfA.id]
    );
    return rows[0];
  });
  assert.equal(jobA.status, "queued");
  assert.equal(jobA.input_type, "pdf");
  assert.equal(jobA.source_file_id, sfA.id);

  // One-active-job index still applies across extracting stage
  await db.query(`update public.generation_jobs set status = 'extracting', stage = 'extracting', progress = 10 where id = $1`, [jobA.id]);
  await assert.rejects(
    asUser(A, (tx) =>
      tx.query(`insert into public.generation_jobs (owner_id, input_type, input_text) values ($1, 'prompt', 'another')`, [A])
    ),
    (e) => e.code === "23505"
  );

  // User A can request cancellation while in 'extracting'
  await asUser(A, async (tx) => {
    const { rows } = await tx.query(`update public.generation_jobs set status = 'cancelling' where id = $1 returning status`, [jobA.id]);
    assert.equal(rows[0].status, "cancelling");
  });

  // User B cannot create a job referencing user A's source_file_id (composite FK 23503)
  await assert.rejects(
    asUser(B, (tx) =>
      tx.query(
        `insert into public.generation_jobs (owner_id, input_type, input_text, source_file_id)
         values ($1, 'pdf', null, $2)`,
        [B, sfA.id]
      )
    ),
    (e) => e.code === "23503"
  );

  // Prompt job without input_text is rejected; pdf job without source_file_id is rejected
  await assert.rejects(
    asUser(B, (tx) => tx.query(`insert into public.generation_jobs (owner_id, input_type, input_text) values ($1, 'prompt', null)`, [B])),
    /generation_jobs_input_invariant/
  );
  await assert.rejects(
    asUser(B, (tx) => tx.query(`insert into public.generation_jobs (owner_id, input_type, input_text, source_file_id) values ($1, 'image', 'focus', null)`, [B])),
    /generation_jobs_input_invariant/
  );

  // Complete job A and save as note -> propagates source_type='pdf' and links source_files.note_id
  await db.query(
    `update public.generation_jobs set status = 'completed', stage = null, progress = 100, learning_plan = '{"title":"PDF Lesson"}', scene_json = $2 where id = $1`,
    [jobA.id, JSON.stringify(SCENE)]
  );
  const saved = await commitAs(A, async (tx) => {
    const { rows } = await tx.query(`select * from public.create_note_from_job($1, 'Lecture visual')`, [jobA.id]);
    return rows[0];
  });
  const { rows: [note] } = await db.query(`select source_type from public.notes where id = $1`, [saved.note_id]);
  assert.equal(note.source_type, "pdf");
  const { rows: [linkedSf] } = await db.query(`select note_id from public.source_files where id = $1`, [sfA.id]);
  assert.equal(linkedSf.note_id, saved.note_id);

  // Duplicating preserves source_type
  const dup = await commitAs(A, async (tx) => (await tx.query(`select * from public.duplicate_note($1, 'Copy PDF')`, [saved.note_id])).rows[0]);
  const { rows: [dupNote] } = await db.query(`select source_type from public.notes where id = $1`, [dup.note_id]);
  assert.equal(dupNote.source_type, "pdf");

  // Deleting note sets source_files.note_id back to null (doesn't crash)
  await commitAs(A, (tx) => tx.query(`delete from public.notes where id = $1`, [saved.note_id]));
  const { rows: [unlinkedSf] } = await db.query(`select note_id from public.source_files where id = $1`, [sfA.id]);
  assert.equal(unlinkedSf.note_id, null);

  // link_source_file_to_note cannot link someone else's note or source file
  const jobB = await commitAs(B, async (tx) => {
    const { rows } = await tx.query(
      `insert into public.generation_jobs (owner_id, input_type, input_text, source_file_id)
       values ($1, 'image', 'notes photo', $2) returning id`,
      [B, sfB.id]
    );
    return rows[0];
  });
  await db.query(
    `update public.generation_jobs set status = 'completed', progress = 100, learning_plan = '{"title":"Img"}', scene_json = $2 where id = $1`,
    [jobB.id, JSON.stringify(SCENE)]
  );
  const savedB = await commitAs(B, async (tx) => (await tx.query(`select * from public.create_note_from_job($1, 'Img note')`, [jobB.id])).rows[0]);
  await assert.rejects(
    asUser(A, (tx) => tx.query(`select public.link_source_file_to_note($1, $2)`, [sfA.id, savedB.note_id])),
    (e) => e.code === "P0002"
  );
});

test("storage: source-files bucket is private and enforces uid prefix ownership", async () => {
  const { rows } = await db.query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'source-files'`);
  assert.equal(rows[0].public, false);
  assert.equal(Number(rows[0].file_size_limit), 20971520);
  assert.deepEqual(rows[0].allowed_mime_types, ["application/pdf", "image/jpeg", "image/png", "image/webp"]);

  const okPath = `${A}/${randomUUID()}/original.pdf`;
  await commitAs(A, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner) values ('source-files', $1, $2)`, [okPath, A]));

  await assert.rejects(
    asUser(B, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner) values ('source-files', $1, $2)`, [`${A}/${randomUUID()}/bad.pdf`, B])),
    /row-level security/
  );
  const theirs = await asUser(B, async (tx) => ({
    read: (await tx.query(`select 1 from storage.objects where name = $1`, [okPath])).rows.length,
    del: (await tx.query(`delete from storage.objects where name = $1`, [okPath])).affectedRows,
  }));
  assert.deepEqual(theirs, { read: 0, del: 0 });
});
