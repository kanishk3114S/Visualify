/**
 * Offline verification of Phase 6.5 migration 0010 (quota refunds, idempotency,
 * role revokes, product_events RLS, account deletion cascade, and compute_product_metrics)
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
  "migrations/0009_phase6_hardening.sql",
  "migrations/0010_launch_closeout.sql",
];

let db;
const A = randomUUID();
const B = randomUUID();

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

test("refund_usage_event denies clients, is idempotent, frees quota capacity, and stays exact under concurrency", async () => {
  // Clients cannot call refund_usage_event directly
  await assert.rejects(
    commitAs("authenticated", A, (tx) => tx.query(`select public.refund_usage_event($1, $2)`, [A, randomUUID()])),
    /permission denied/
  );
  await assert.rejects(
    commitAs("anon", null, (tx) => tx.query(`select public.refund_usage_event($1, $2)`, [A, randomUUID()])),
    /permission denied/
  );

  const corr1 = randomUUID();
  const corr2 = randomUUID();
  const corr3 = randomUUID();

  // Consume 2 slots at limit = 2
  const r1 = (
    await commitAs("service_role", null, (tx) =>
      tx.query(`select * from public.consume_monthly_quota($1, 'generation_create', 2, p_correlation_id => $2)`, [A, corr1])
    )
  ).rows[0];
  const r2 = (
    await commitAs("service_role", null, (tx) =>
      tx.query(`select * from public.consume_monthly_quota($1, 'generation_create', 2, p_correlation_id => $2)`, [A, corr2])
    )
  ).rows[0];
  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);

  // Blocked when at limit
  const blocked = (
    await commitAs("service_role", null, (tx) =>
      tx.query(`select * from public.consume_monthly_quota($1, 'generation_create', 2, p_correlation_id => $2)`, [A, corr3])
    )
  ).rows[0];
  assert.equal(blocked.allowed, false);

  // First refund succeeds & frees 1 unit
  const ref1 = (await commitAs("service_role", null, (tx) => tx.query(`select public.refund_usage_event($1, $2) as refunded`, [A, corr1]))).rows[0];
  assert.equal(ref1.refunded, true);

  // Second refund on same correlation_id is idempotent no-op
  const ref2 = (await commitAs("service_role", null, (tx) => tx.query(`select public.refund_usage_event($1, $2) as refunded`, [A, corr1]))).rows[0];
  assert.equal(ref2.refunded, false);

  // Refund second slot too, then fire 5 concurrent consumptions at limit = 2 -> exact 2 allowed, 3 denied
  await commitAs("service_role", null, (tx) => tx.query(`select public.refund_usage_event($1, $2)`, [A, corr2]));

  const race = await Promise.all(
    Array.from({ length: 5 }, () =>
      commitAs("service_role", null, (tx) =>
        tx.query(`select allowed from public.consume_monthly_quota($1, 'generation_create', 2, p_correlation_id => $2)`, [A, randomUUID()])
      )
    )
  );
  assert.equal(race.filter((r) => r.rows[0].allowed).length, 2);
  assert.equal(race.filter((r) => !r.rows[0].allowed).length, 3);
});

test("product_events: RLS enabled, denies anon/authenticated, enforces 14 PRD names and deletion cascade", async () => {
  await assert.rejects(
    commitAs("authenticated", A, (tx) => tx.query(`select count(*) from public.product_events`)),
    /permission denied/
  );
  await assert.rejects(
    commitAs("authenticated", A, (tx) => tx.query(`insert into public.product_events (owner_id, event_name) values ($1, 'note_saved')`, [A])),
    /permission denied/
  );
  await assert.rejects(
    commitAs("anon", null, (tx) => tx.query(`select count(*) from public.product_events`)),
    /permission denied/
  );

  // Invalid event name fails check constraint even for service_role
  await assert.rejects(
    commitAs("service_role", null, (tx) =>
      tx.query(`insert into public.product_events (owner_id, event_name) values ($1, 'unknown_event')`, [A])
    ),
    /product_events_name_check/
  );

  // Seed user A & B events + anonymous account_deleted event
  await commitAs("service_role", null, async (tx) => {
    await tx.query(`insert into public.product_events (owner_id, event_name, properties) values ($1, 'note_opened', '{"noteId":"n1"}')`, [A]);
    await tx.query(`insert into public.product_events (owner_id, event_name, properties) values ($1, 'note_opened', '{"noteId":"n2"}')`, [B]);
    await tx.query(`insert into public.product_events (owner_id, event_name, properties) values (null, 'account_deleted', '{"removedObjects":3}')`);
  });

  // Deleting user A cascades user A's product_events & usage_events while leaving B and account_deleted intact
  await db.query(`delete from auth.users where id = $1`, [A]);
  assert.equal((await db.query(`select count(*)::int as c from public.product_events where owner_id = $1`, [A])).rows[0].c, 0);
  assert.equal((await db.query(`select count(*)::int as c from public.usage_events where owner_id = $1`, [A])).rows[0].c, 0);
  assert.equal((await db.query(`select count(*)::int as c from public.product_events where owner_id = $1`, [B])).rows[0].c, 1);
  assert.equal((await db.query(`select count(*)::int as c from public.product_events where event_name = 'account_deleted'`)).rows[0].c, 1);
});

test("compute_product_metrics is service_role-only and computes exact PRD §14.1 math", async () => {
  const U1 = randomUUID();
  const U2 = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, 'u1@example.test'), ($2, 'u2@example.test')", [U1, U2]);

  await assert.rejects(
    commitAs("authenticated", U1, (tx) => tx.query(`select public.compute_product_metrics(now() - interval '7 days', now())`)),
    /permission denied/
  );

  // Deterministic dataset in fixed window [2026-11-01, 2026-11-20]
  await commitAs("service_role", null, async (tx) => {
    const ins = (owner, name, props, ts) =>
      tx.query(`insert into public.product_events (owner_id, event_name, properties, created_at) values ($1, $2, $3::jsonb, $4::timestamptz)`, [
        owner,
        name,
        JSON.stringify(props),
        ts,
      ]);

    // U1 signs up, completes generation in 4000ms, saves n1 within 2h, edits n1, exports n1, reopens 2 days later -> activated & 7d return
    await ins(U1, "auth_signup_completed", { provider: "email" }, "2026-11-05T10:00:00Z");
    await ins(U1, "generation_started", { jobId: "j1" }, "2026-11-05T10:05:00Z");
    await ins(U1, "generation_completed", { jobId: "j1", durationMs: 4000, repaired: false, promptTokens: 1000, outputTokens: 500 }, "2026-11-05T10:05:04Z");
    await ins(U1, "note_saved", { noteId: "n1", jobId: "j1" }, "2026-11-05T10:10:00Z");
    await ins(U1, "note_edited", { noteId: "n1", revision: 1 }, "2026-11-05T10:15:00Z");
    await ins(U1, "note_exported", { noteId: "n1", format: "png", scope: "full" }, "2026-11-05T10:20:00Z");
    await ins(U1, "note_opened", { noteId: "n1" }, "2026-11-07T10:00:00Z");

    // U2 signs up, completes j2 in 6000ms (repaired), saves n2 later (>24h so not activated, no export/edit/return)
    await ins(U2, "auth_signup_completed", { provider: "google" }, "2026-11-06T10:00:00Z");
    await ins(U2, "generation_started", { jobId: "j2" }, "2026-11-06T10:10:00Z");
    await ins(U2, "generation_completed", { jobId: "j2", durationMs: 6000, repaired: true, promptTokens: 2000, outputTokens: 1000 }, "2026-11-06T10:10:06Z");
    await ins(U2, "note_saved", { noteId: "n2", jobId: "j2" }, "2026-11-08T10:00:00Z");

    // U2 also starts j3 (cancelled) and j4 (provider failed)
    await ins(U2, "generation_started", { jobId: "j3" }, "2026-11-08T11:00:00Z");
    await ins(U2, "generation_failed", { jobId: "j3", errorCode: "CANCELLED" }, "2026-11-08T11:00:10Z");
    await ins(U2, "generation_started", { jobId: "j4" }, "2026-11-08T12:00:00Z");
    await ins(U2, "generation_failed", { jobId: "j4", errorCode: "AI_UNAVAILABLE" }, "2026-11-08T12:00:10Z");
  });

  const out = (
    await commitAs("service_role", null, (tx) =>
      tx.query(`select public.compute_product_metrics('2026-11-01T00:00:00Z'::timestamptz, '2026-11-20T00:00:00Z'::timestamptz) as m`)
    )
  ).rows[0].m;

  assert.equal(out.counts.signups, 2);
  assert.equal(out.counts.activatedUsers, 1);
  assert.equal(Number(out.metrics.activationRate), 0.5);
  // 2 completed / (4 started - 1 cancelled = 3 eligible) = 0.6667
  assert.equal(Number(out.metrics.generationCompletionRate), 0.6667);
  assert.equal(Number(out.metrics.timeToFirstUsefulVisualMs.p50), 5000);
  // 2 saved / 2 completed = 1.0
  assert.equal(Number(out.metrics.saveRate), 1);
  // 1 of 2 savers reopened within 7d = 0.5
  assert.equal(Number(out.metrics.sevenDayLibraryReturnRate), 0.5);
  // 1 of 2 saved notes exported = 0.5
  assert.equal(Number(out.metrics.exportRate), 0.5);
  // 1 of 2 saved notes edited = 0.5
  assert.equal(Number(out.metrics.editEngagementRate), 0.5);
  // 1 repaired / 4 started = 0.25
  assert.equal(Number(out.metrics.regenerationRate), 0.25);
  // tokens = 3000 prompt ($0.0003) + 1500 output ($0.0006) = $0.0009 / 2 = $0.00045
  assert.equal(Number(out.metrics.costPerCompletedVisualUsd), 0.00045);
});
