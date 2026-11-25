/**
 * Offline SQL verification of the Phase 1 migrations on a real Postgres engine
 * (PGlite = Postgres compiled to WASM). Applies a minimal Supabase platform
 * stub, then the actual migration files, then exercises the trigger, grants,
 * constraints and RLS policies as the `authenticated` / `anon` roles.
 *
 * Run: npm run test:rls:sql   (uses node:test, no network, no credentials)
 *
 * This proves the SQL logic. It does NOT replace the live check against a real
 * Supabase project (rls.live.test.js), which also covers GoTrue + Storage API.
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
];

let db;
const userA = { id: randomUUID(), email: "alice@example.test" };
const userB = { id: randomUUID(), email: "bob@example.test" };

/** Run fn inside a transaction impersonating a Supabase API role. Always rolls back. */
async function as(role, uid, fn) {
  let result;
  let error = null;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        uid ? JSON.stringify({ sub: uid, role }) : "",
      ]);
      result = await fn(tx);
      throw new Error("__rollback__");
    });
  } catch (err) {
    if (err.message !== "__rollback__") error = err;
  }
  if (error) throw error;
  return result;
}

const asUser = (uid, fn) => as("authenticated", uid, fn);
const asAnon = (fn) => as("anon", null, fn);
const avatarPath = (uid) => `${uid}/avatar-${randomUUID()}.webp`;

before(async () => {
  db = new PGlite();
  await db.exec(read("tests/supabase-stub.sql"));
  for (const file of MIGRATIONS) await db.exec(read(file));
  // Migrations must be idempotent (re-runnable without error).
  for (const file of MIGRATIONS) await db.exec(read(file));

  for (const u of [userA, userB]) {
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [u.id, u.email, JSON.stringify({ display_name: `  ${u.email.split("@")[0]} display  ` })]
    );
  }
});

after(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// Trigger: handle_new_user
// ---------------------------------------------------------------------------
test("signup trigger creates a profile row with trimmed display_name", async () => {
  const { rows } = await db.query(`select * from public.profiles where id = $1`, [userA.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].display_name, "alice display");
  assert.equal(rows[0].bio, "");
  assert.equal(rows[0].username, null);
  assert.deepEqual(rows[0].preferences, {
    theme: "light",
    defaultExportFormat: "png",
    learningLevel: "undergraduate",
  });
});

test("trigger falls back to OAuth full_name, then email local part, then empty", async () => {
  const oauth = randomUUID();
  const emailOnly = randomUUID();
  const nothing = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    oauth, "g@example.test", JSON.stringify({ full_name: "Grace Hopper" }),
  ]);
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`, [
    emailOnly, "local.part@example.test",
  ]);
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, null, null)`, [nothing]);
  const name = async (id) =>
    (await db.query(`select display_name from public.profiles where id = $1`, [id])).rows[0]?.display_name;
  assert.equal(await name(oauth), "Grace Hopper");
  assert.equal(await name(emailOnly), "local.part");
  assert.equal(await name(nothing), "");
});

test("trigger never blocks signup: oversized metadata name is truncated to 80 chars", async () => {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id, "long@example.test", JSON.stringify({ display_name: "x".repeat(500) }),
  ]);
  const { rows } = await db.query(`select display_name from public.profiles where id = $1`, [id]);
  assert.equal(rows[0].display_name.length, 80);
});

test("deleting the auth user cascades to the profile", async () => {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, 'gone@example.test')`, [id]);
  await db.query(`delete from auth.users where id = $1`, [id]);
  const { rows } = await db.query(`select 1 from public.profiles where id = $1`, [id]);
  assert.equal(rows.length, 0);
});

test("handle_new_user is not executable by API roles", async () => {
  for (const role of ["anon", "authenticated"]) {
    const { rows } = await db.query(
      `select has_function_privilege($1, 'public.handle_new_user()', 'EXECUTE') as ok`,
      [role]
    );
    assert.equal(rows[0].ok, false, `${role} must not execute handle_new_user`);
  }
});

// ---------------------------------------------------------------------------
// profiles: grants + RLS
// ---------------------------------------------------------------------------
test("RLS is enabled on public.profiles", async () => {
  const { rows } = await db.query(
    `select relrowsecurity from pg_class where oid = 'public.profiles'::regclass`
  );
  assert.equal(rows[0].relrowsecurity, true);
});

test("no profiles policy uses USING (true) and every command has a policy", async () => {
  const { rows } = await db.query(
    `select cmd, qual, with_check, roles from pg_policies where schemaname = 'public' and tablename = 'profiles'`
  );
  const cmds = rows.map((r) => r.cmd).sort();
  assert.deepEqual(cmds, ["DELETE", "INSERT", "SELECT", "UPDATE"]);
  for (const r of rows) {
    assert.notEqual((r.qual ?? "").trim(), "true");
    assert.notEqual((r.with_check ?? "").trim(), "true");
    assert.deepEqual(r.roles, ["authenticated"]);
  }
});

test("user A can read only their own profile", async () => {
  const rows = await asUser(userA.id, async (tx) => (await tx.query(`select id from public.profiles`)).rows);
  assert.deepEqual(rows.map((r) => r.id), [userA.id]);
});

test("user B cannot read user A's profile", async () => {
  const rows = await asUser(userB.id, async (tx) =>
    (await tx.query(`select id from public.profiles where id = $1`, [userA.id])).rows
  );
  assert.equal(rows.length, 0);
});

test("user A can update their own allowlisted fields", async () => {
  const row = await asUser(userA.id, async (tx) =>
    (await tx.query(
      `update public.profiles set display_name = 'Alice', username = 'alice_1', bio = 'hi'
       where id = $1 returning display_name, username, bio`,
      [userA.id]
    )).rows[0]
  );
  assert.deepEqual(row, { display_name: "Alice", username: "alice_1", bio: "hi" });
});

test("updated_at trigger overwrites any supplied value on update", async () => {
  // Run as table owner: authenticated has no UPDATE grant on updated_at at all
  // (asserted separately below), so prove the trigger wins even for the owner.
  const { rows } = await db.query(
    `update public.profiles set bio = 'changed', updated_at = '2000-01-01' where id = $1 returning updated_at`,
    [userA.id]
  );
  assert.ok(rows[0].updated_at.getTime() > new Date("2000-01-02").getTime());
});

test("user B cannot update user A's profile (0 rows affected)", async () => {
  const count = await asUser(userB.id, async (tx) =>
    (await tx.query(`update public.profiles set bio = 'pwned' where id = $1`, [userA.id])).affectedRows
  );
  assert.equal(count, 0);
  const { rows } = await db.query(`select bio from public.profiles where id = $1`, [userA.id]);
  assert.notEqual(rows[0].bio, "pwned");
});

test("user B cannot re-key their own row to user A's id (column not updatable)", async () => {
  await assert.rejects(
    asUser(userB.id, (tx) => tx.query(`update public.profiles set id = $1 where id = $2`, [userA.id, userB.id])),
    /permission denied/
  );
});

test("user B cannot insert a profile for user A", async () => {
  const fresh = randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, 'fresh@example.test')`, [fresh]);
  await db.query(`delete from public.profiles where id = $1`, [fresh]);
  await assert.rejects(
    asUser(userB.id, (tx) => tx.query(`insert into public.profiles (id, display_name) values ($1, 'x')`, [fresh])),
    /row-level security/
  );
  // ...but the owner can (hydration path used by GET /api/v1/me)
  const row = await asUser(fresh, async (tx) =>
    (await tx.query(`insert into public.profiles (id, display_name) values ($1, 'me') returning id`, [fresh])).rows[0]
  );
  assert.equal(row.id, fresh);
});

test("user B cannot delete user A's profile", async () => {
  const count = await asUser(userB.id, async (tx) =>
    (await tx.query(`delete from public.profiles where id = $1`, [userA.id])).affectedRows
  );
  assert.equal(count, 0);
  const { rows } = await db.query(`select 1 from public.profiles where id = $1`, [userA.id]);
  assert.equal(rows.length, 1);
});

test("anon has no access to profiles at all", async () => {
  await assert.rejects(asAnon((tx) => tx.query(`select * from public.profiles`)), /permission denied/);
  await assert.rejects(
    asAnon((tx) => tx.query(`update public.profiles set bio = 'x'`)),
    /permission denied/
  );
});

test("authenticated cannot write created_at / updated_at directly via grants", async () => {
  await assert.rejects(
    asUser(userA.id, (tx) => tx.query(`update public.profiles set created_at = now() where id = $1`, [userA.id])),
    /permission denied/
  );
  await assert.rejects(
    asUser(userA.id, (tx) => tx.query(`update public.profiles set updated_at = now() where id = $1`, [userA.id])),
    /permission denied/
  );
});

test("constraints reject invalid username, oversized bio, long display_name, non-object preferences", async () => {
  const bad = [
    [`update public.profiles set username = 'ab' where id = $1`, /profiles_username_format/],
    [`update public.profiles set username = 'bad name!' where id = $1`, /profiles_username_format/],
    [`update public.profiles set bio = repeat('b', 301) where id = $1`, /profiles_bio_length/],
    [`update public.profiles set display_name = repeat('d', 81) where id = $1`, /profiles_display_name_length/],
    [`update public.profiles set preferences = '[]'::jsonb where id = $1`, /profiles_preferences_is_object/],
  ];
  for (const [sql, re] of bad) {
    await assert.rejects(asUser(userA.id, (tx) => tx.query(sql, [userA.id])), re, sql);
  }
});

test("usernames are unique case-insensitively (23505)", async () => {
  await db.query(`update public.profiles set username = 'TakenName' where id = $1`, [userA.id]);
  await assert.rejects(
    asUser(userB.id, (tx) => tx.query(`update public.profiles set username = 'takenname' where id = $1`, [userB.id])),
    (err) => err.code === "23505"
  );
});

test("avatar_path must live in the owner's folder with the server naming scheme", async () => {
  const ok = avatarPath(userA.id);
  const row = await asUser(userA.id, async (tx) =>
    (await tx.query(`update public.profiles set avatar_path = $1 where id = $2 returning avatar_path`, [ok, userA.id])).rows[0]
  );
  assert.equal(row.avatar_path, ok);
  for (const evil of [avatarPath(userB.id), `${userA.id}/../${userB.id}/x.webp`, `${userA.id}/avatar.png`]) {
    await assert.rejects(
      asUser(userA.id, (tx) => tx.query(`update public.profiles set avatar_path = $1 where id = $2`, [evil, userA.id])),
      /profiles_avatar_path_owner/,
      evil
    );
  }
});

// ---------------------------------------------------------------------------
// storage: avatars bucket + storage.objects policies
// ---------------------------------------------------------------------------
test("avatars bucket is private with a 2 MiB limit and image MIME allowlist", async () => {
  const { rows } = await db.query(`select * from storage.buckets where id = 'avatars'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].public, false);
  assert.equal(Number(rows[0].file_size_limit), 2097152);
  assert.deepEqual(rows[0].allowed_mime_types, ["image/jpeg", "image/png", "image/webp"]);
});

test("user A can upload, read and delete objects in their own avatar folder", async () => {
  const name = avatarPath(userA.id);
  const result = await asUser(userA.id, async (tx) => {
    await tx.query(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)`, [name, userA.id]);
    const read = (await tx.query(`select name from storage.objects where name = $1`, [name])).rows.length;
    const del = (await tx.query(`delete from storage.objects where name = $1`, [name])).affectedRows;
    return { read, del };
  });
  assert.deepEqual(result, { read: 1, del: 1 });
});

test("user A cannot upload outside the naming scheme or into user B's folder", async () => {
  for (const name of [avatarPath(userB.id), `${userA.id}/evil.svg`, `${userA.id}/avatar-not-a-uuid.webp`, `avatar-${randomUUID()}.webp`]) {
    await assert.rejects(
      asUser(userA.id, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)`, [name, userA.id])
      ),
      /row-level security/,
      name
    );
  }
});

test("user B cannot read, update or delete user A's avatar object", async () => {
  const name = avatarPath(userA.id);
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)`, [name, userA.id]);
  const result = await asUser(userB.id, async (tx) => ({
    read: (await tx.query(`select 1 from storage.objects where name = $1`, [name])).rows.length,
    upd: (await tx.query(`update storage.objects set name = $1 where name = $2`, [avatarPath(userB.id), name])).affectedRows,
    del: (await tx.query(`delete from storage.objects where name = $1`, [name])).affectedRows,
  }));
  assert.deepEqual(result, { read: 0, upd: 0, del: 0 });
  const { rows } = await db.query(`select 1 from storage.objects where name = $1`, [name]);
  assert.equal(rows.length, 1);
});

test("anon cannot read any avatar object", async () => {
  const rows = await asAnon(async (tx) => (await tx.query(`select 1 from storage.objects where bucket_id = 'avatars'`)).rows);
  assert.equal(rows.length, 0);
});

test("avatar policies do not grant access to other buckets", async () => {
  await db.query(`insert into storage.buckets (id, name, public) values ('source-files', 'source-files', false) on conflict do nothing`);
  await assert.rejects(
    asUser(userA.id, (tx) =>
      tx.query(`insert into storage.objects (bucket_id, name, owner) values ('source-files', $1, $2)`, [
        avatarPath(userA.id), userA.id,
      ])
    ),
    /row-level security/
  );
});
