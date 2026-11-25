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

after(async () => {
  if (BLOCKED) return;
  for (const u of users) {
    const { data } = await admin.storage.from("avatars").list(u.id);
    if (data?.length) await admin.storage.from("avatars").remove(data.map((o) => `${u.id}/${o.name}`));
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
