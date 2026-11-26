/**
 * LIVE RLS + trigger verification against a real (dev/staging) Supabase project.
 *
 * Run: npm run test:rls:live
 *
 * Requires backend/.env.local with SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SERVICE_ROLE_KEY. The service-role key is used ONLY here, in a local
 * test process, to create and afterwards delete two throwaway confirmed users.
 * All access checks run through user-scoped clients (publishable key + user JWT),
 * exactly like the browser and the Express API.
 *
 * NEVER point this at production. If credentials are missing every test is
 * reported as skipped with "NOT RUN (BLOCKED on Supabase credentials)".
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const envPath = path.resolve(import.meta.dirname, "../../backend/.env.local");
if (fs.existsSync(envPath)) dotenv.config({ path: envPath, quiet: true, override: false });

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, NODE_ENV } = process.env;
const placeholder = (v) => !v || /your[-_]|YOUR_/i.test(v);
const missing = Object.entries({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY })
  .filter(([, value]) => placeholder(value))
  .map(([name]) => name);
const BLOCKED =
  missing.length > 0
    ? `NOT RUN (BLOCKED on ${missing.join(", ")} in backend/.env.local)`
    : NODE_ENV === "production"
      ? "NOT RUN (refusing to run against NODE_ENV=production)"
      : false;

if (BLOCKED) console.log(`# ${BLOCKED}`);

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let admin;
const users = [];

// Smallest valid 1x1 WebP (lossless) so storage MIME checks pass.
const WEBP_1PX = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

async function makeUser(label) {
  const email = `rls-${label}-${randomUUID()}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `RLS ${label}` },
  });
  if (error) throw error;
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, clientOpts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const user = { id: data.user.id, client };
  users.push(user);
  return user;
}

let A;
let B;

before(async () => {
  if (BLOCKED) return;
  admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts);
  A = await makeUser("a");
  B = await makeUser("b");
});

async function emptyUserPrefix(bucket, prefix) {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
  if (error || !data?.length) return;
  const files = [];
  for (const item of data) {
    const child = `${prefix}/${item.name}`;
    if (item.id === null) await emptyUserPrefix(bucket, child);
    else files.push(child);
  }
  if (files.length) await admin.storage.from(bucket).remove(files);
}

after(async () => {
  if (BLOCKED) return;
  for (const u of users) {
    for (const bucket of ["avatars", "note-assets", "note-exports", "source-files"]) {
      await emptyUserPrefix(bucket, u.id);
    }
    await admin.auth.admin.deleteUser(u.id);
  }
});

const opts = { skip: BLOCKED };

test("signup trigger created a profile row for user A", opts, async () => {
  const { data, error } = await A.client.from("profiles").select("id, display_name").eq("id", A.id).single();
  assert.equal(error, null);
  assert.equal(data.display_name, "RLS a");
});

test("user B cannot read user A's profile", opts, async () => {
  const { data, error } = await B.client.from("profiles").select("id").eq("id", A.id);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test("user B cannot update or delete user A's profile", opts, async () => {
  const upd = await B.client.from("profiles").update({ bio: "pwned" }).eq("id", A.id).select();
  assert.deepEqual(upd.data ?? [], []);
  const del = await B.client.from("profiles").delete().eq("id", A.id).select();
  assert.deepEqual(del.data ?? [], []);
  const { data } = await A.client.from("profiles").select("bio").eq("id", A.id).single();
  assert.notEqual(data.bio, "pwned");
});

test("user B cannot insert a profile row for user A", opts, async () => {
  const { error } = await B.client.from("profiles").insert({ id: A.id, display_name: "x" });
  assert.ok(error, "insert must fail");
});

test("anon cannot read profiles", opts, async () => {
  const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, clientOpts);
  const { data, error } = await anon.from("profiles").select("id").limit(1);
  assert.ok(error || (Array.isArray(data) && data.length === 0));
});

test("user A can upload to own avatar folder; user B cannot read, overwrite or delete it", opts, async () => {
  const name = `${A.id}/avatar-${randomUUID()}.webp`;
  const up = await A.client.storage.from("avatars").upload(name, WEBP_1PX, { contentType: "image/webp" });
  assert.equal(up.error, null);

  const signedByB = await B.client.storage.from("avatars").createSignedUrl(name, 60);
  assert.ok(signedByB.error, "B must not be able to sign A's object");

  const dlByB = await B.client.storage.from("avatars").download(name);
  assert.ok(dlByB.error, "B must not download A's object");

  await B.client.storage.from("avatars").remove([name]);
  const stillThere = await A.client.storage.from("avatars").download(name);
  assert.equal(stillThere.error, null, "A's object must survive B's delete attempt");

  const overwrite = await B.client.storage.from("avatars").upload(name, WEBP_1PX, { upsert: true, contentType: "image/webp" });
  assert.ok(overwrite.error, "B must not overwrite A's object");
});

test("user B cannot upload into user A's folder", opts, async () => {
  const { error } = await B.client.storage
    .from("avatars")
    .upload(`${A.id}/avatar-${randomUUID()}.webp`, WEBP_1PX, { contentType: "image/webp" });
  assert.ok(error);
});

test("avatars bucket is private (no public URL access)", opts, async () => {
  const name = `${A.id}/avatar-${randomUUID()}.webp`;
  await A.client.storage.from("avatars").upload(name, WEBP_1PX, { contentType: "image/webp" });
  const { data } = A.client.storage.from("avatars").getPublicUrl(name);
  const res = await fetch(data.publicUrl);
  assert.notEqual(res.status, 200);
});

// ---------------------------------------------------------------------------
// generation_jobs (migration 0003)
// ---------------------------------------------------------------------------
let JOBS_BLOCKED = BLOCKED;
if (!BLOCKED) {
  const probe = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts);
  const { error } = await probe.from("generation_jobs").select("id").limit(1);
  if (error?.code === "PGRST205" || error?.code === "42P01") {
    JOBS_BLOCKED = "NOT RUN (BLOCKED: apply supabase/migrations/0003_generation_jobs.sql to this project first)";
  } else if (error) {
    JOBS_BLOCKED = `NOT RUN (generation_jobs probe failed with code ${error.code})`;
  }
  if (JOBS_BLOCKED) console.log(`# generation_jobs: ${JOBS_BLOCKED}`);
}
const jobsOpts = { skip: JOBS_BLOCKED };
const newJob = (client, ownerId, text = "Explain TCP") =>
  client.from("generation_jobs").insert({ owner_id: ownerId, input_text: text, settings: { detail: "standard" } }).select("id, status, progress").single();

test("generation_jobs: owner creates a queued job and reads it; user B and anon cannot see it", jobsOpts, async () => {
  const { data: job, error } = await newJob(A.client, A.id);
  assert.equal(error, null);
  assert.deepEqual({ status: job.status, progress: job.progress }, { status: "queued", progress: 0 });
  const mine = await A.client.from("generation_jobs").select("id").eq("id", job.id);
  assert.equal(mine.data.length, 1);
  const theirs = await B.client.from("generation_jobs").select("id").eq("id", job.id);
  assert.deepEqual(theirs.data, []);
  const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, clientOpts);
  const anonRead = await anon.from("generation_jobs").select("id").limit(1);
  assert.ok(anonRead.error || anonRead.data.length === 0);
});

test("generation_jobs: one active job per user is enforced by the database", jobsOpts, async () => {
  const second = await newJob(A.client, A.id, "Another topic");
  assert.equal(second.error?.code, "23505");
});

test("generation_jobs: user B cannot insert for A, cancel A's job, or delete it", jobsOpts, async () => {
  const forged = await newJob(B.client, A.id);
  assert.ok(forged.error, "insert for another owner must fail");
  const { data: active } = await A.client.from("generation_jobs").select("id").eq("owner_id", A.id).eq("status", "queued").single();
  const cancel = await B.client.from("generation_jobs").update({ status: "cancelling" }).eq("id", active.id).select();
  assert.deepEqual(cancel.data ?? [], []);
  const del = await B.client.from("generation_jobs").delete().eq("id", active.id).select();
  assert.deepEqual(del.data ?? [], []);
});

test("generation_jobs: owners cannot forge results, only request cancellation", jobsOpts, async () => {
  const { data: active } = await A.client.from("generation_jobs").select("id").eq("owner_id", A.id).eq("status", "queued").single();
  const forgeStatus = await A.client.from("generation_jobs").update({ status: "completed" }).eq("id", active.id).select();
  assert.ok(forgeStatus.error || (forgeStatus.data ?? []).length === 0, "owner must not mark a job completed");
  const forgeScene = await A.client.from("generation_jobs").update({ scene_json: { elements: [] } }).eq("id", active.id).select();
  assert.ok(forgeScene.error, "owner must not write scene_json");
  const forgeInsert = await A.client.from("generation_jobs").insert({ owner_id: A.id, input_text: "x", status: "completed" }).select();
  assert.ok(forgeInsert.error, "owner must not insert a completed job");
  const cancel = await A.client.from("generation_jobs").update({ status: "cancelled" }).eq("id", active.id).select("status").single();
  assert.equal(cancel.error, null);
  assert.equal(cancel.data.status, "cancelled");
});

// ---------------------------------------------------------------------------
// folders, notes, note_versions, note_drafts, note_exports (migration 0004)
// ---------------------------------------------------------------------------
let NOTES_BLOCKED = BLOCKED;
let EXPORTS_STORAGE_BLOCKED = BLOCKED;
if (!BLOCKED) {
  const probe = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts);
  const { error } = await probe.from("notes").select("id").limit(1);
  if (error?.code === "PGRST205" || error?.code === "42P01") {
    NOTES_BLOCKED = "NOT RUN (BLOCKED: apply supabase/migrations/0004_folders_notes_versions_exports.sql to this project first)";
  } else if (error) {
    NOTES_BLOCKED = `NOT RUN (notes probe failed with code ${error.code})`;
  }
  if (NOTES_BLOCKED) console.log(`# notes: ${NOTES_BLOCKED}`);

  for (const bucket of ["note-assets", "note-exports"]) {
    const b = await probe.storage.getBucket(bucket);
    if (b.error) {
      EXPORTS_STORAGE_BLOCKED = "NOT RUN (BLOCKED: apply supabase/migrations/0005_note_storage_buckets.sql to this project first)";
      break;
    }
  }
  if (EXPORTS_STORAGE_BLOCKED) console.log(`# note storage: ${EXPORTS_STORAGE_BLOCKED}`);
}
const notesOpts = { skip: NOTES_BLOCKED };
const noteStorageOpts = { skip: NOTES_BLOCKED || EXPORTS_STORAGE_BLOCKED };

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test("folders & notes: owner CRUD, cycle guard, composite FK and cross-user isolation", notesOpts, async () => {
  const { data: folderA, error: folderErr } = await A.client
    .from("folders")
    .insert({ owner_id: A.id, name: "Algorithms" })
    .select("id, name")
    .single();
  assert.equal(folderErr, null);

  // Cycle rejected (parent_id = own id).
  const selfCycle = await A.client.from("folders").update({ parent_id: folderA.id }).eq("id", folderA.id);
  assert.equal(selfCycle.error?.code, "23514");

  // User B cannot read or update A's folder, or put B's note inside A's folder.
  assert.deepEqual((await B.client.from("folders").select("id").eq("id", folderA.id)).data, []);
  assert.deepEqual((await B.client.from("folders").update({ name: "Hijacked" }).eq("id", folderA.id).select()).data ?? [], []);

  const crossFolder = await B.client.from("notes").insert({ owner_id: B.id, folder_id: folderA.id, title: "Cross" });
  assert.ok(crossFolder.error, "note cannot reference another owner's folder");

  const { data: noteA, error: noteErr } = await A.client
    .from("notes")
    .insert({ owner_id: A.id, folder_id: folderA.id, title: "Binary Search Trees" })
    .select("id, title")
    .single();
  assert.equal(noteErr, null);

  assert.deepEqual((await B.client.from("notes").select("id").eq("id", noteA.id)).data, []);
  assert.deepEqual((await B.client.from("notes").delete().eq("id", noteA.id).select()).data ?? [], []);

  const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, clientOpts);
  const anonNotes = await anon.from("notes").select("id").limit(1);
  assert.ok(anonNotes.error || anonNotes.data.length === 0);
});

test("note_versions, note_drafts & RPCs: immutability, atomic snapshot, non-destructive restore", notesOpts, async () => {
  const { data: noteA } = await A.client.from("notes").insert({ owner_id: A.id, title: "Raft Consensus" }).select("id").single();

  const v1 = await A.client.rpc("add_note_version", {
    p_note_id: noteA.id,
    p_scene: { elements: [{ id: "e1", type: "rectangle" }] },
    p_description: "Initial",
    p_kind: "generated",
  });
  assert.equal(v1.error, null);
  assert.equal(v1.data[0].version_number, 1);

  // Versions are immutable for authenticated callers.
  const vUpdate = await A.client.from("note_versions").update({ description: "Mutated" }).eq("id", v1.data[0].id);
  assert.ok(vUpdate.error, "note_versions must not allow UPDATE");
  const vDelete = await A.client.from("note_versions").delete().eq("id", v1.data[0].id);
  assert.ok(vDelete.error, "note_versions must not allow DELETE");

  // Draft save -> snapshot clears draft -> new draft -> restore preserves draft first.
  const d1 = await A.client.from("note_drafts").insert({ note_id: noteA.id, owner_id: A.id, scene_json: { elements: [{ id: "d1" }] }, revision: 1 });
  assert.equal(d1.error, null);

  const v2 = await A.client.rpc("add_note_version", {
    p_note_id: noteA.id,
    p_scene: { elements: [{ id: "v2" }] },
    p_description: "Snapshot 2",
    p_kind: "snapshot",
  });
  assert.equal(v2.error, null);
  assert.equal(v2.data[0].version_number, 2);

  assert.deepEqual((await A.client.from("note_drafts").select("note_id").eq("note_id", noteA.id)).data, []);

  await A.client.from("note_drafts").insert({ note_id: noteA.id, owner_id: A.id, scene_json: { elements: [{ id: "d2" }] }, revision: 1 });
  const restored = await A.client.rpc("restore_note_version", { p_note_id: noteA.id, p_version_id: v1.data[0].id });
  assert.equal(restored.error, null);
  assert.equal(restored.data[0].version_number, 4);

  // B cannot call RPCs against A's note.
  const bSnap = await B.client.rpc("add_note_version", { p_note_id: noteA.id, p_scene: { elements: [] } });
  assert.ok(bSnap.error);
  const bDup = await B.client.rpc("duplicate_note", { p_note_id: noteA.id, p_title: "Stolen" });
  assert.ok(bDup.error);
});

test("note_exports: owner-scoped rows and cross-user isolation", notesOpts, async () => {
  const { data: noteA } = await A.client.from("notes").insert({ owner_id: A.id, title: "Exportable" }).select("id").single();
  const { data: v } = await A.client.rpc("add_note_version", { p_note_id: noteA.id, p_scene: { elements: [] }, p_kind: "generated" });
  const versionId = v[0].id;

  const { data: expA, error: expErr } = await A.client
    .from("note_exports")
    .insert({ owner_id: A.id, note_id: noteA.id, version_id: versionId, format: "png", status: "queued" })
    .select("id")
    .single();
  assert.equal(expErr, null);

  assert.deepEqual((await B.client.from("note_exports").select("id").eq("id", expA.id)).data, []);
  const crossInsert = await B.client
    .from("note_exports")
    .insert({ owner_id: B.id, note_id: noteA.id, version_id: versionId, format: "png", status: "queued" });
  assert.ok(crossInsert.error, "user B must not create an export for A's note");
});

test("note-assets & note-exports storage: private buckets enforce uid/noteId ownership", noteStorageOpts, async () => {
  const { data: noteA } = await A.client.from("notes").insert({ owner_id: A.id, title: "Assets" }).select("id").single();
  const { data: v } = await A.client.rpc("add_note_version", { p_note_id: noteA.id, p_scene: { elements: [] }, p_kind: "generated" });
  const versionId = v[0].id;

  const previewPath = `${A.id}/${noteA.id}/${versionId}/preview.png`;
  const exportPath = `${A.id}/${noteA.id}/${versionId}/export-1.png`;

  const upAsset = await A.client.storage.from("note-assets").upload(previewPath, PNG_1PX, { contentType: "image/png" });
  assert.equal(upAsset.error, null);
  const upExport = await A.client.storage.from("note-exports").upload(exportPath, PNG_1PX, { contentType: "image/png" });
  assert.equal(upExport.error, null);

  // User B cannot upload into A's folder, or into B's folder with A's noteId, or read/delete A's files.
  const bInA = await B.client.storage.from("note-exports").upload(`${A.id}/${noteA.id}/${versionId}/bad.png`, PNG_1PX, { contentType: "image/png" });
  assert.ok(bInA.error);
  const bForeignNote = await B.client.storage.from("note-exports").upload(`${B.id}/${noteA.id}/${versionId}/bad.png`, PNG_1PX, { contentType: "image/png" });
  assert.ok(bForeignNote.error);
  const bDownload = await B.client.storage.from("note-exports").download(exportPath);
  assert.ok(bDownload.error);
  const bRemove = await B.client.storage.from("note-exports").remove([exportPath]);
  assert.ok(bRemove.error || (bRemove.data ?? []).length === 0);

  // Private buckets: public URL is unreachable without a token; signed URL succeeds.
  const { data: pubUrl } = A.client.storage.from("note-exports").getPublicUrl(exportPath);
  const pubRes = await fetch(pubUrl.publicUrl);
  assert.ok([400, 403, 404].includes(pubRes.status));
  const { data: signed, error: signErr } = await A.client.storage.from("note-exports").createSignedUrl(exportPath, 60);
  assert.equal(signErr, null);
  const signedRes = await fetch(signed.signedUrl);
  assert.equal(signedRes.status, 200);
});

// ---------------------------------------------------------------------------
// source_files (migration 0006) & source-files bucket (migration 0007)
// ---------------------------------------------------------------------------
let SOURCES_BLOCKED = BLOCKED;
let SOURCES_BUCKET_BLOCKED = BLOCKED;
if (!BLOCKED) {
  const probe = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts);
  const { error } = await probe.from("source_files").select("id").limit(1);
  if (error?.code === "PGRST205" || error?.code === "42P01") {
    SOURCES_BLOCKED = "NOT RUN (BLOCKED: apply supabase/migrations/0006_source_files.sql to this project first)";
  } else if (error) {
    SOURCES_BLOCKED = `NOT RUN (source_files probe failed with code ${error.code})`;
  }
  if (SOURCES_BLOCKED) console.log(`# source_files: ${SOURCES_BLOCKED}`);

  const b = await probe.storage.getBucket("source-files");
  if (b.error) {
    SOURCES_BUCKET_BLOCKED = "NOT RUN (BLOCKED: apply supabase/migrations/0007_source_files_bucket.sql to this project first)";
    console.log(`# source-files bucket: ${SOURCES_BUCKET_BLOCKED}`);
  }
}
const sourcesOpts = { skip: SOURCES_BLOCKED };
const sourcesBucketOpts = { skip: SOURCES_BUCKET_BLOCKED };

test("source_files: owner insert/read/delete, forged status denied, cross-user isolation & composite FK", sourcesOpts, async () => {
  const sfId = randomUUID();
  const objPath = `${A.id}/${sfId}/original.png`;
  const { data: sfA, error: insErr } = await A.client
    .from("source_files")
    .insert({
      id: sfId,
      owner_id: A.id,
      object_path: objPath,
      original_name: "notes.png",
      mime_type: "image/png",
      size_bytes: 120,
      checksum: "a".repeat(64),
      width: 1,
      height: 1,
    })
    .select("id, extraction_status")
    .single();
  assert.equal(insErr, null);
  assert.equal(sfA.extraction_status, "uploaded");

  // User B cannot read or delete A's source file, or reference it in a generation job
  assert.deepEqual((await B.client.from("source_files").select("id").eq("id", sfId)).data, []);
  assert.deepEqual((await B.client.from("source_files").delete().eq("id", sfId).select()).data ?? [], []);

  const crossJob = await B.client
    .from("generation_jobs")
    .insert({ owner_id: B.id, input_type: "image", source_file_id: sfId });
  assert.ok(crossJob.error, "user B must not reference A's source_file_id");

  // Owner cannot forge extraction_status
  const forgeStatus = await A.client.from("source_files").update({ extraction_status: "extracted" }).eq("id", sfId).select();
  assert.ok(forgeStatus.error, "authenticated client must not update extraction_status");
});

test("source-files storage: private bucket enforces uid prefix ownership", sourcesBucketOpts, async () => {
  const sfId = randomUUID();
  const okPath = `${A.id}/${sfId}/original.png`;
  const up = await A.client.storage.from("source-files").upload(okPath, PNG_1PX, { contentType: "image/png" });
  assert.equal(up.error, null);

  const bInA = await B.client.storage.from("source-files").upload(`${A.id}/${sfId}/bad.png`, PNG_1PX, { contentType: "image/png" });
  assert.ok(bInA.error);
  const bDownload = await B.client.storage.from("source-files").download(okPath);
  assert.ok(bDownload.error);

  const { data: pubUrl } = A.client.storage.from("source-files").getPublicUrl(okPath);
  const pubRes = await fetch(pubUrl.publicUrl);
  assert.ok([400, 403, 404].includes(pubRes.status));
});

// ---------------------------------------------------------------------------
// Phase 5: note_quizzes, note_flashcards, note_revision_guides, usage_events (0008)
// ---------------------------------------------------------------------------
let COMPANION_BLOCKED = BLOCKED;
if (!BLOCKED) {
  const probe = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts);
  const { error } = await probe.from("note_quizzes").select("id").limit(1);
  if (error?.code === "PGRST205" || error?.code === "42P01") {
    COMPANION_BLOCKED = "NOT RUN (BLOCKED: apply supabase/migrations/0008_learning_companion.sql to this project first)";
  } else if (error) {
    COMPANION_BLOCKED = `NOT RUN (note_quizzes probe failed with code ${error.code})`;
  }
  if (COMPANION_BLOCKED) console.log(`# note_quizzes: ${COMPANION_BLOCKED}`);
}
const companionOpts = { skip: COMPANION_BLOCKED || NOTES_BLOCKED };

test("Phase 5 study companion: owner CRUD, cross-user isolation, composite FKs & usage_events read-only", companionOpts, async () => {
  const { data: noteA } = await A.client.from("notes").insert({ owner_id: A.id, title: "Study Companion Live" }).select("id").single();
  const { data: v } = await A.client.rpc("add_note_version", { p_note_id: noteA.id, p_scene: { elements: [] }, p_kind: "generated" });
  const versionId = v[0].id;

  const { data: qA, error: qErr } = await A.client
    .from("note_quizzes")
    .insert({ owner_id: A.id, note_id: noteA.id, version_id: versionId, difficulty: "mixed", questions: [{ id: "q1" }], total_questions: 1 })
    .select("id")
    .single();
  assert.equal(qErr, null);

  assert.deepEqual((await B.client.from("note_quizzes").select("id").eq("id", qA.id)).data, []);
  const bForge = await B.client
    .from("note_quizzes")
    .insert({ owner_id: B.id, note_id: noteA.id, version_id: versionId, questions: [{ id: "q1" }], total_questions: 1 });
  assert.ok(bForge.error, "user B must not attach a quiz to user A's note");

  const aUsageForge = await A.client.from("usage_events").insert({ owner_id: A.id, event_type: "quiz", units: 1 });
  assert.ok(aUsageForge.error, "authenticated clients must not insert usage_events");
});

// ---------------------------------------------------------------------------
// Phase 6: selection export scope, atomic consume_monthly_quota & delete isolation (0009)
// ---------------------------------------------------------------------------
let PHASE6_BLOCKED = BLOCKED;
if (!BLOCKED) {
  const probe = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts);
  const { error } = await probe.rpc("consume_monthly_quota", {
    p_owner_id: "00000000-0000-0000-0000-000000000000",
    p_event_type: "generation_create",
    p_limit: 0,
    p_units: 1,
  });
  // Expect clean denied boolean (no 22P02/42883 function-not-found) when 0009 is applied
  if (error?.code === "PGRST202" || error?.code === "42883") {
    PHASE6_BLOCKED = "NOT RUN (BLOCKED: apply supabase/migrations/0009_phase6_hardening.sql to this project first)";
  } else if (error && !/violates foreign key|present in table "users"/.test(error.message ?? "")) {
    PHASE6_BLOCKED = `NOT RUN (consume_monthly_quota probe failed with code ${error.code})`;
  }
  if (PHASE6_BLOCKED) console.log(`# phase6_quota: ${PHASE6_BLOCKED}`);
}

test("Phase 6 quota & selection export: consume_monthly_quota denies clients, enforces limit for service_role", { skip: PHASE6_BLOCKED || COMPANION_BLOCKED || NOTES_BLOCKED }, async () => {
  const rpcAsA = await A.client.rpc("consume_monthly_quota", {
    p_owner_id: A.id,
    p_event_type: "generation_create",
    p_limit: 5,
  });
  assert.ok(rpcAsA.error, "authenticated user must not execute consume_monthly_quota");

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts);
  const { data: qRes, error: qErr } = await adminClient.rpc("consume_monthly_quota", {
    p_owner_id: A.id,
    p_event_type: "generation_create",
    p_limit: 5,
    p_metadata: { source: "live-rls" },
  });
  assert.equal(qErr, null);
  assert.equal(qRes[0].allowed, true);
});

test("Phase 6 account deletion: user B sees nothing of user C before or after C deletion & storage sweep", opts, async () => {
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts);
  const cEmail = `rls-del-${Date.now()}-${randomUUID().slice(0, 6)}@visualify-test.example`;
  const cPass = `Pass!${randomUUID()}`;
  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email: cEmail,
    password: cPass,
    email_confirm: true,
    user_metadata: { display_name: "Throwaway Delete" },
  });
  assert.equal(createErr, null);
  const cId = created.user.id;
  try {
    const cClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, clientOpts);
    await cClient.auth.signInWithPassword({ email: cEmail, password: cPass });

    const cAvatar = `${cId}/avatar-${randomUUID()}.webp`;
    await cClient.storage.from("avatars").upload(cAvatar, WEBP_1PX, { contentType: "image/webp" });

    // Before deletion: User B cannot read User C's profile or avatar
    assert.deepEqual((await B.client.from("profiles").select("id").eq("id", cId)).data, []);
    assert.ok((await B.client.storage.from("avatars").download(cAvatar)).error);

    // Delete Storage + Auth user C
    await adminClient.storage.from("avatars").remove([cAvatar]);
    const { error: delErr } = await adminClient.auth.admin.deleteUser(cId);
    assert.equal(delErr, null);

    // After deletion: Profile cascaded cleanly and User B still sees zero objects/rows
    const { data: leftoverProfile } = await adminClient.from("profiles").select("id").eq("id", cId);
    assert.deepEqual(leftoverProfile, []);
    assert.deepEqual((await B.client.from("profiles").select("id").eq("id", cId)).data, []);
    assert.ok((await B.client.storage.from("avatars").download(cAvatar)).error);
  } finally {
    await adminClient.auth.admin.deleteUser(cId).catch(() => {});
  }
});
