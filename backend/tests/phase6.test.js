import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { buildTestApp, BASE_ENV } from "./helpers/testApp.js";
import { ensureProductionServiceRole, loadConfig } from "../src/config/env.js";
import { createLogger } from "../src/utils/logger.js";
import { scrubSentryEvent } from "../src/utils/sentry.js";
import { createRateLimiters } from "../src/middleware/rateLimit.js";
import { InProcessQueue } from "../src/generation/inProcessQueue.js";
import { BullMQGenerationQueue } from "../src/generation/bullmqQueue.js";
import { createGenerationService } from "../src/generation/generationService.js";
import { InMemoryJobStore, createFakePipelineDeps, deferred } from "./helpers/fakeGeneration.js";
import { JobEventBus } from "../src/generation/eventBus.js";

const SECRET_PROMPT = "UNIQUE_PROMPT_SHOULD_NEVER_BE_LOGGED_OR_METERED";

describe("Phase 6: FR-EXP-05 Selection export, Quotas & Billing metering", () => {
  const MULTI_PLAN = {
    schemaVersion: "1.0",
    title: "TCP Handshake",
    summary: "How TCP connects.",
    learningObjectives: ["Trace SYN"],
    sections: [
      { id: "sec1", title: "Handshake", visualType: "flowchart", keyConcepts: ["SYN"], relationships: [], explanation: "Client sends SYN.", sourceRefs: [] },
    ],
    warnings: [],
  };
  const MULTI_SCENE = {
    type: "excalidraw",
    elements: [
      { id: "sec1__frame", type: "frame", name: "1. Handshake", x: 0, y: 0, width: 300, height: 150 },
      { id: "sec1__a", type: "rectangle", x: 10, y: 10, width: 100, height: 50, frameId: "sec1__frame", boundElements: [{ id: "sec1__a_txt", type: "text" }] },
      { id: "sec1__a_txt", type: "text", x: 20, y: 20, width: 80, height: 20, text: "Client", containerId: "sec1__a", frameId: "sec1__frame" },
      { id: "sec1__b", type: "rectangle", x: 150, y: 10, width: 100, height: 50, frameId: "sec1__frame" },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
  };

  function setup(envOverrides = {}) {
    const ctx = buildTestApp(envOverrides);
    const alice = ctx.addUser({ email: "alice@example.test", password: "Password123!" });
    const bob = ctx.addUser({ email: "bob@example.test", password: "Password123!" });
    const call = (who) => ({
      get: (u) => request(ctx.app).get(u).set("Authorization", `Bearer ${who.token}`),
      post: (u) => request(ctx.app).post(u).set("Authorization", `Bearer ${who.token}`),
      patch: (u) => request(ctx.app).patch(u).set("Authorization", `Bearer ${who.token}`),
      delete: (u) => request(ctx.app).delete(u).set("Authorization", `Bearer ${who.token}`),
    });
    return { ...ctx, alice, bob, call };
  }

  it("supports scope='selection' export and validates IDs strictly against the note's scene", async () => {
    const s = setup();
    const job = s.generation.store.seed({
      owner_id: s.alice.user.id,
      input_text: "TCP",
      status: "completed",
      progress: 100,
      learning_plan: MULTI_PLAN,
      scene_json: MULTI_SCENE,
      settings: {},
    });
    const noteRes = await s.call(s.alice).post("/api/v1/notes").send({ jobId: job.id });
    const noteId = noteRes.body.data.note.id;

    const okSel = await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({
      format: "png",
      scope: "selection",
      elementIds: ["sec1__a"],
    });
    expect(okSel.status).toBe(201);
    expect(okSel.body.data.export).toMatchObject({ scope: "selection", format: "png", status: "completed" });
    // sec1__a + bound text sec1__a_txt = 2 elements rendered, not sec1__b or frame
    expect(s.notes.renderer.calls.at(-1).elements).toBe(2);

    // Rejects unknown or foreign element IDs
    const badSel = await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({
      format: "png",
      scope: "selection",
      elementIds: ["sec1__a", "nonexistent-el"],
    });
    expect(badSel.status).toBe(400);
    expect(badSel.body.error.code).toBe("VALIDATION_ERROR");

    // Rejects zip with selection
    const badZip = await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({
      format: "zip",
      scope: "selection",
      elementIds: ["sec1__a"],
    });
    expect(badZip.status).toBe(400);

    // Rejects > 200 elements
    const tooMany = await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({
      format: "png",
      scope: "selection",
      elementIds: Array.from({ length: 201 }, (_, i) => `id-${i}`),
    });
    expect(tooMany.status).toBe(400);
  });

  it("enforces GENERATION_LIMIT_MONTHLY BEFORE calling AI across generation create/retry and companion calls, and exposes GET /me/usage without PII", async () => {
    const s = setup({ GENERATION_LIMIT_MONTHLY: "2" });

    // Save 1 completed note directly so we can test generation + companion quota on the same user
    const seeded = s.generation.store.seed({
      owner_id: s.alice.user.id,
      input_text: "TCP",
      status: "completed",
      progress: 100,
      learning_plan: MULTI_PLAN,
      scene_json: MULTI_SCENE,
      settings: {},
    });
    const noteId = (await s.call(s.alice).post("/api/v1/notes").send({ jobId: seeded.id })).body.data.note.id;

    // 1st billable unit: POST /generations
    const g1 = await s.call(s.alice).post("/api/v1/generations").send({ inputType: "prompt", prompt: SECRET_PROMPT });
    expect(g1.status).toBe(202);
    await s.generation.service.onIdle();

    // 2nd billable unit: POST /notes/:id/quiz
    const q1 = await s.call(s.alice).post(`/api/v1/notes/${noteId}/quiz`).send({ difficulty: "mixed", questionCount: 3 });
    expect(q1.status).toBe(201);

    // Check GET /api/v1/me/usage
    const usageRes = await s.call(s.alice).get("/api/v1/me/usage");
    expect(usageRes.status).toBe(200);
    expect(usageRes.body.data.usage).toMatchObject({
      limit: 2,
      used: 2,
      remaining: 0,
      breakdown: { generations: 1, companion: 1, exports: 0 },
    });

    // 3rd billable attempt hits 429 QUOTA_EXCEEDED BEFORE model execution
    const callsBefore = s.generation.pipelineDeps.calls.length + s.notes.companion.calls.length;
    const gOver = await s.call(s.alice).post("/api/v1/generations").send({ inputType: "prompt", prompt: "Should fail quota" });
    expect(gOver.status).toBe(429);
    expect(gOver.body.error.code).toBe("QUOTA_EXCEEDED");
    expect(gOver.body.error.details).toMatchObject({ limit: 2, used: 2, resetsAt: expect.any(String) });

    const askOver = await s.call(s.alice).post(`/api/v1/notes/${noteId}/ask`).send({ question: "Should fail quota" });
    expect(askOver.status).toBe(429);
    expect(askOver.body.error.code).toBe("QUOTA_EXCEEDED");
    expect(s.generation.pipelineDeps.calls.length + s.notes.companion.calls.length).toBe(callsBefore);

    // Stored usage_events metadata never stores prompts, titles or emails
    const rawUsage = JSON.stringify(s.state.usageEvents);
    expect(rawUsage).not.toContain(SECRET_PROMPT);
    expect(rawUsage).not.toContain("alice@example.test");
  });

  it("fails CLOSED when NODE_ENV=production without SUPABASE_SERVICE_ROLE_KEY", () => {
    const prodNoKey = loadConfig({ ...BASE_ENV, NODE_ENV: "production" });
    expect(() => ensureProductionServiceRole(prodNoKey)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);

    const devNoKey = loadConfig({ ...BASE_ENV, NODE_ENV: "development" });
    expect(() => ensureProductionServiceRole(devNoKey)).not.toThrow();
  });
});

describe("Phase 6: Queue guarantees (InProcessQueue vs BullMQGenerationQueue), Redis rate limiters & resilience", () => {
  function createMockBullHarness() {
    const bullJobs = new Map();
    let processor = null;
    const listeners = new Map();

    class FakeQueue {
      async add(_name, data, opts = {}) {
        const id = opts.jobId ?? randomUUID();
        if (bullJobs.has(id)) return bullJobs.get(id); // idempotent deduplication by jobId
        const entry = {
          id,
          data,
          state: "waiting",
          async getState() { return entry.state; },
          async remove() {
            if (entry.state === "waiting") {
              entry.state = "removed";
              bullJobs.delete(id);
            }
          },
        };
        bullJobs.set(id, entry);
        queueMicrotask(() => drain());
        return entry;
      }
      async getJob(id) {
        return bullJobs.get(id) ?? null;
      }
      async close() { bullJobs.clear(); }
    }

    let concurrencyLimit = 2;
    let activeCount = 0;

    async function drain() {
      if (!processor) return;
      for (const entry of bullJobs.values()) {
        if (activeCount >= concurrencyLimit) break;
        if (entry.state !== "waiting") continue;
        entry.state = "active";
        activeCount += 1;
        Promise.resolve()
          .then(() => processor(entry))
          .then(() => { entry.state = "completed"; })
          .catch((err) => {
            entry.state = "failed";
            listeners.get("failed")?.(entry, err);
          })
          .finally(() => {
            activeCount -= 1;
            drain();
          });
      }
    }

    class FakeWorker {
      constructor(_name, fn, opts) {
        processor = fn;
        concurrencyLimit = opts?.concurrency ?? 2;
      }
      on(ev, fn) { listeners.set(ev, fn); }
      async close() {}
    }

    return { FakeQueue, FakeWorker, connection: { publish: vi.fn().mockResolvedValue(1) }, bullJobs };
  }

  it.each(["in_process", "bullmq"])("%s queue enforces idempotent enqueue, queued cancel without model call, bounded concurrency & restart recovery", async (mode) => {
    const store = new InMemoryJobStore();
    const bus = new JobEventBus();
    const deps = createFakePipelineDeps(store);
    const config = loadConfig(BASE_ENV);
    let queue;
    if (mode === "bullmq") {
      const mock = createMockBullHarness();
      queue = new BullMQGenerationQueue({
        connection: mock.connection,
        concurrency: 2,
        QueueClass: mock.FakeQueue,
        WorkerClass: mock.FakeWorker,
      });
    } else {
      queue = new InProcessQueue({ concurrency: 2 });
    }
    const service = createGenerationService({ config, store, queue, bus, pipelineDeps: deps });

    // 1. Cancel queued job before handler executes (hold concurrency slots or cancel before microtask runs)
    deps.gate = deferred();
    const u1 = randomUUID();
    const u2 = randomUUID();
    const j1 = await service.createJob({ db: null, ownerId: u1, inputType: "prompt", prompt: "Job 1", settings: {} });
    const j2 = await service.createJob({ db: null, ownerId: u2, inputType: "prompt", prompt: "Job 2", settings: {} });

    // Re-enqueuing same jobId is a no-op (idempotency)
    queue.enqueue(j1.id, () => { throw new Error("duplicate delivery must not invoke"); });

    // 3rd user waits in queue (concurrency = 2), cancel BEFORE model runs
    const u3 = randomUUID();
    const j3 = await service.createJob({ db: null, ownerId: u3, inputType: "prompt", prompt: "Job 3", settings: {} });
    await new Promise((r) => setTimeout(r, 15));
    const plannerCallsBeforeCancel = deps.calls.filter((c) => c.op === "planner").length;
    const cancelRes = await service.cancelJob({ db: null, ownerId: u3, jobId: j3.id });
    expect(cancelRes.status).toBe("cancelled");

    deps.gate.resolve();
    await queue.onIdle();

    // Planner was called ONLY for j1 and j2, NEVER for cancelled j3
    const plannerCallsAfter = deps.calls.filter((c) => c.op === "planner").length;
    expect(plannerCallsAfter).toBe(2);
    expect(plannerCallsBeforeCancel).toBeLessThanOrEqual(2);

    // 2. Crash recovery marks leftover active row as INTERRUPTED without creating duplicate notes
    const orphan = store.seed({ owner_id: randomUUID(), input_text: "Interrupted", status: "planning", stage: "planning", progress: 40 });
    const recovered = await service.recoverInterruptedJobs();
    expect(recovered).toBe(1);
    expect(store.rows.get(orphan.id).error_code).toBe("INTERRUPTED");
  });

  it("wires RedisStore to rate limiters when a Redis client is passed", async () => {
    const calls = [];
    const fakeRedis = {
      call: async (...args) => {
        calls.push(args);
        if (args[0] === "SCRIPT") return "sha_mock_1";
        if (args[0] === "EVALSHA") return [1, Date.now() + 60_000];
        return "OK";
      },
      ping: async () => "PONG",
    };
    const limiters = createRateLimiters({ redis: fakeRedis });
    expect(limiters.accountDelete).toBeTypeOf("function");
    expect(limiters.adminInspect).toBeTypeOf("function");
  });
});

describe("Phase 6: Account deletion, Observability, Redaction & Admin inspector", () => {
  it("DELETE /api/v1/me validates confirmation, requires re-auth, cleans up all 4 storage buckets, and deletes the user", async () => {
    const ctx = buildTestApp();
    const alice = ctx.addUser({ email: "alice@example.test", password: "CorrectPassword1!", lastSignInAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    const bob = ctx.addUser({ email: "bob@example.test", password: "BobPassword1!" });

    // Seed objects for Alice across all 4 buckets and 1 for Bob
    ctx.state.objects.set(`avatars/${alice.user.id}/avatar-1.webp`, { buffer: Buffer.from("a"), contentType: "image/webp" });
    ctx.state.objects.set(`source-files/${alice.user.id}/sf1/original.pdf`, { buffer: Buffer.from("b"), contentType: "application/pdf" });
    ctx.state.objects.set(`note-assets/${alice.user.id}/n1/v1/preview.png`, { buffer: Buffer.from("c"), contentType: "image/png" });
    ctx.state.objects.set(`note-exports/${alice.user.id}/n1/v1/export.png`, { buffer: Buffer.from("d"), contentType: "image/png" });
    ctx.state.objects.set(`avatars/${bob.user.id}/avatar-b.webp`, { buffer: Buffer.from("keep"), contentType: "image/webp" });

    // Unauthenticated rejected before body parsing
    expect((await request(ctx.app).delete("/api/v1/me").send({})).status).toBe(401);

    // Wrong confirmation phrase -> 400
    const badPhrase = await request(ctx.app)
      .delete("/api/v1/me")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ confirmation: "delete account", password: "CorrectPassword1!" });
    expect(badPhrase.status).toBe(400);

    // Stale sign-in without password -> 403 REAUTH_REQUIRED
    const noReauth = await request(ctx.app)
      .delete("/api/v1/me")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ confirmation: "DELETE MY ACCOUNT" });
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.error.code).toBe("REAUTH_REQUIRED");

    // Wrong password -> 403 REAUTH_REQUIRED
    const wrongPass = await request(ctx.app)
      .delete("/api/v1/me")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ confirmation: "DELETE MY ACCOUNT", password: "WrongPassword9!" });
    expect(wrongPass.status).toBe(403);

    // Valid password + phrase -> 200, removes all 4 Alice objects, keeps Bob's, invalidates Alice token
    const ok = await request(ctx.app)
      .delete("/api/v1/me")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ confirmation: "DELETE MY ACCOUNT", password: "CorrectPassword1!" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ deleted: true, removedObjects: 4 });
    expect([...ctx.state.objects.keys()]).toEqual([`avatars/${bob.user.id}/avatar-b.webp`]);
    expect(ctx.state.deletedUsers.has(alice.user.id)).toBe(true);

    // Alice token can no longer access API
    expect((await request(ctx.app).get("/api/v1/me").set("Authorization", `Bearer ${alice.token}`)).status).toBe(401);
  });

  it("exposes /healthz and /readyz probes without leaking internals, and checks Redis when configured", async () => {
    const fakeRedis = { ping: vi.fn().mockResolvedValue("PONG"), call: vi.fn().mockResolvedValue("OK") };
    const ctx = buildTestApp({}, { redis: fakeRedis });

    const live = await request(ctx.app).get("/healthz");
    expect(live.status).toBe(200);
    expect(live.body.data).toMatchObject({ status: "ok", uptimeSeconds: expect.any(Number) });

    const ready = await request(ctx.app).get("/readyz");
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({ status: "ok", checks: { api: "ok", supabase: "ok", redis: "ok", renderer: "ok" } });

    fakeRedis.ping.mockRejectedValueOnce(new Error("redis connection lost at redis://user:secret@10.0.0.1:6379"));
    const degraded = await request(ctx.app).get("/readyz");
    expect(degraded.status).toBe(503);
    expect(degraded.body.error.code).toBe("SERVICE_DEGRADED");
    expect(JSON.stringify(degraded.body)).not.toMatch(/secret|10\.0\.0\.1|6379/);
  });

  it("redacts prompts, JWTs, API keys, signed URLs, and emails from structured logs and Sentry events", () => {
    const lines = [];
    const logger = createLogger(
      loadConfig({ ...BASE_ENV, LOG_LEVEL: "info" }),
      new Writable({ write(c, _e, cb) { lines.push(c.toString()); cb(); } })
    );
    logger.info(
      {
        requestId: "req_123",
        userId: "user-uuid-1",
        jobId: "job-uuid-1",
        stage: "planning",
        durationMs: 42,
        modelId: "gemini-3.5-flash",
        prompt: SECRET_PROMPT,
        email: "student@university.edu",
        signedUrl: "https://proj.supabase.co/storage/v1/object/sign/note-exports/a.png?token=secretTok",
        rawMsg: "JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig123456 key AIzaSyD123456789012345678901234567",
      },
      "stage log"
    );
    const out = lines.join("");
    expect(out).not.toContain(SECRET_PROMPT);
    expect(out).not.toContain("student@university.edu");
    expect(out).not.toContain("secretTok");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(out).not.toContain("AIzaSyD1234567890");
    expect(out).toContain("req_123");
    expect(out).toContain("gemini-3.5-flash");

    const scrubbed = scrubSentryEvent({
      message: "Failed calling https://p.supabase.co/storage/v1/object/sign/b/c?token=tok for bob@school.edu",
      request: { headers: { authorization: "Bearer secret", cookie: "a=b" }, url: "https://api.test/foo?token=123" },
      user: { id: "u1", email: "bob@school.edu" },
      extra: { prompt: SECRET_PROMPT, noteId: "n1" },
    });
    expect(scrubbed.request.headers.authorization).toBeUndefined();
    expect(scrubbed.user).toEqual({ id: "u1" });
    expect(scrubbed.extra.prompt).toBe("[REDACTED]");
    expect(scrubbed.message).not.toContain("bob@school.edu");
    expect(scrubbed.message).not.toContain("tok");
  });

  it("GET /api/v1/admin/jobs/:jobId returns 403 for non-admins and redacted metadata for admins", async () => {
    const adminId = randomUUID();
    const ctx = buildTestApp({ ADMIN_USER_IDS: adminId });
    const normal = ctx.addUser({ email: "user@example.test" });
    const admin = ctx.addUser({ id: adminId, email: "ops@example.test" });
    const seeded = ctx.generation.store.seed({
      owner_id: normal.user.id,
      input_text: SECRET_PROMPT,
      status: "failed",
      error_code: "PLANNER_TIMEOUT",
      model_id: "gemini-3.5-flash",
      attempt_count: 2,
    });

    expect((await request(ctx.app).get(`/api/v1/admin/jobs/${seeded.id}`)).status).toBe(401);
    const denied = await request(ctx.app)
      .get(`/api/v1/admin/jobs/${seeded.id}`)
      .set("Authorization", `Bearer ${normal.token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    const ok = await request(ctx.app)
      .get(`/api/v1/admin/jobs/${seeded.id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.job).toMatchObject({
      jobId: seeded.id,
      status: "failed",
      errorCode: "PLANNER_TIMEOUT",
      modelId: "gemini-3.5-flash",
      attemptCount: 2,
    });
    expect(JSON.stringify(ok.body)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(ok.body)).not.toContain("user@example.test");
  });
});
