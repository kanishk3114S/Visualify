/**
 * Offline verification of Phase 6 migration 0009 (selection exports, atomic
 * monthly quota advisory lock under concurrency, and full account cascade
 * deletion) on real Postgres (PGlite). Run with: npm run test:rls:sql
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
  "migrations/0009_phase6_hardening.sql",
];

let db;
const A = randomUUID();
const B = randomUUID();
const SCENE = { type: "excalidraw", elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] };

async function commitAs(role, uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [uid ? JSON.stringify({ sub: uid, role }) : ""]);
    return fn(tx);
  });
}

before(async () => {
  db = new PGlite();
  await db.exec(read("tests/supabase-stub.sql"));
  for (const m of MIGRATIONS) await db.exec(read(m));
  await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')", [A, B]);
});

after(() => db?.close());

test("note_exports accepts selection scope from 0009 migration", async () => {
  const res = await commitAs("authenticated", A, async (tx) => {
    const n = (await tx.query(`insert into public.notes (owner_id, title) values ($1, 'Selection Note') returning id`, [A])).rows[0];
    const v = (await tx.query(`select * from public.add_note_version($1, $2, 'v1', 'generated')`, [n.id, JSON.stringify(SCENE)])).rows[0];
    const exp = (
      await tx.query(
        `insert into public.note_exports (owner_id, note_id, version_id, format, scope, theme)
         values ($1, $2, $3, 'png', 'selection', 'light') returning id, scope`,
        [A, n.id, v.id]
      )
    ).rows[0];
    return exp;
  });
  assert.equal(res.scope, "selection");
});

test("consume_monthly_quota is service_role-only and enforces limit safely under concurrent calls", async () => {
  await assert.rejects(
    commitAs("authenticated", A, (tx) =>
      tx.query(`select * from public.consume_monthly_quota($1, 'generation_create', 2)`, [A])
    ),
    /permission denied/
  );
  await assert.rejects(
    commitAs("anon", null, (tx) =>
      tx.query(`select * from public.consume_monthly_quota($1, 'generation_create', 2)`, [A])
    ),
    /permission denied/
  );

  // Fire 5 concurrent quota consumptions for limit=2; Postgres advisory lock serializes cleanly.
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      commitAs("service_role", null, async (tx) => {
        const r = await tx.query(
          `select allowed, used, "limit", event_id
             from public.consume_monthly_quota(
               p_owner_id => $1,
               p_event_type => 'generation_create',
               p_limit => 2,
               p_units => 1,
               p_metadata => $2::jsonb
             )`,
          [A, JSON.stringify({ seq: i, modelId: "gemini-3.5-flash" })]
        );
        return r.rows[0];
      })
    )
  );
  const allowedCount = results.filter((r) => r.allowed).length;
  const blockedCount = results.filter((r) => !r.allowed).length;
  assert.equal(allowedCount, 2);
  assert.equal(blockedCount, 3);

  const countRow = await db.query(
    `select coalesce(sum(units), 0)::int as total from public.usage_events where owner_id = $1 and event_type = 'generation_create'`,
    [A]
  );
  assert.equal(countRow.rows[0].total, 2);

  // Non-billable exports can still record metering rows cleanly.
  const expEvent = (
    await commitAs("service_role", null, (tx) =>
      tx.query(
        `select allowed, used from public.consume_monthly_quota($1, 'export', 2, array['export']::text[], 1, '{"format":"png"}'::jsonb)`,
        [A]
      )
    )
  ).rows[0];
  assert.equal(expEvent.allowed, true);
  assert.equal(expEvent.used, 1);
});

test("account deletion cascades cleanly from auth.users to all owned tables without affecting user B", async () => {
  const bNote = await commitAs("authenticated", B, async (tx) => {
    const n = (await tx.query(`insert into public.notes (owner_id, title) values ($1, 'Keep B Note') returning id`, [B])).rows[0];
    await tx.query(`select * from public.add_note_version($1, $2, 'v1', 'generated')`, [n.id, JSON.stringify(SCENE)]);
    return n.id;
  });

  // Delete user A's auth.users row cleanly.
  await db.query(`delete from auth.users where id = $1`, [A]);

  for (const tbl of ["profiles", "folders", "notes", "note_versions", "note_drafts", "note_exports", "generation_jobs", "source_files", "note_quizzes", "note_flashcards", "note_revision_guides", "usage_events"]) {
    const { rows } = await db.query(`select count(*)::int as c from public.${tbl} where owner_id = $1` .replace("where owner_id", tbl === "profiles" ? "where id" : "where owner_id"), [A]);
    assert.equal(rows[0].c, 0, `${tbl} must cascade cleanly for deleted user A`);
  }

  // User B's rows remain completely untouched.
  const bRemaining = await db.query(`select count(*)::int as c from public.notes where id = $1`, [bNote]);
  assert.equal(bRemaining.rows[0].c, 1);
});
