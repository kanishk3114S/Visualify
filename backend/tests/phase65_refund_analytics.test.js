import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Writable } from "node:stream";
import { buildTestApp, BASE_ENV } from "./helpers/testApp.js";
import { loadConfig } from "../src/config/env.js";
import { createLogger } from "../src/utils/logger.js";
import { createAnalyticsService, sanitizeEventProperties } from "../src/services/analyticsService.js";
import { deferred } from "./helpers/fakeGeneration.js";

describe("Phase 6.5 §1.6 & §4: Quota Refunds and Product Analytics", () => {
  function setup(envOverrides = {}) {
    const ctx = buildTestApp(envOverrides);
    const alice = ctx.addUser({ email: "alice@example.test", password: "Password123!" });
    const call = (who) => ({
      get: (u) => request(ctx.app).get(u).set("Authorization", `Bearer ${who.token}`),
      post: (u) => request(ctx.app).post(u).set("Authorization", `Bearer ${who.token}`),
      patch: (u) => request(ctx.app).patch(u).set("Authorization", `Bearer ${who.token}`),
      put: (u) => request(ctx.app).put(u).set("Authorization", `Bearer ${who.token}`),
      delete: (u) => request(ctx.app).delete(u).set("Authorization", `Bearer ${who.token}`),
    });
    return { ...ctx, alice, call };
  }

  it("refunds quota automatically on 503 provider failure so remaining quota is restored", async () => {
    const s = setup({ GENERATION_LIMIT_MONTHLY: "1" });
    s.generation.pipelineDeps.plannerError = Object.assign(new Error("Service unavailable"), {
      code: "PROVIDER_TRANSIENT_ERROR",
      status: 503,
    });

    const g1 = await s.call(s.alice).post("/api/v1/generations").send({ inputType: "prompt", prompt: "Explain TCP" });
    expect(g1.status).toBe(202);
    await s.generation.service.onIdle();

    const jobRow = await s.call(s.alice).get(`/api/v1/generations/${g1.body.data.jobId}`);
    expect(jobRow.body.data.job.status).toBe("failed");
    expect(jobRow.body.data.job.safeError.code).toBe("AI_UNAVAILABLE");

    // Usage meter shows 0 used after automatic provider-failure refund
    const usageAfterFail = await s.call(s.alice).get("/api/v1/me/usage");
    expect(usageAfterFail.status).toBe(200);
    expect(usageAfterFail.body.data.usage.used).toBe(0);
    expect(usageAfterFail.body.data.usage.remaining).toBe(1);

    // Next generation is allowed immediately because the slot was refunded
    s.generation.pipelineDeps.plannerError = null;
    const g2 = await s.call(s.alice).post("/api/v1/generations").send({ inputType: "prompt", prompt: "Explain UDP" });
    expect(g2.status).toBe(202);
    await s.generation.service.onIdle();

    const usageAfterOk = await s.call(s.alice).get("/api/v1/me/usage");
    expect(usageAfterOk.body.data.usage.used).toBe(1);
    expect(usageAfterOk.body.data.usage.remaining).toBe(0);
  });

  it("does NOT refund quota when user cancels after the model call started", async () => {
    const s = setup({ GENERATION_LIMIT_MONTHLY: "1" });
    s.generation.pipelineDeps.gate = deferred();

    const g1 = await s.call(s.alice).post("/api/v1/generations").send({ inputType: "prompt", prompt: "Explain DNS" });
    expect(g1.status).toBe(202);
    // Wait briefly so pipeline enters planning stage (model call started)
    await new Promise((r) => setTimeout(r, 20));

    const cancel = await s.call(s.alice).post(`/api/v1/generations/${g1.body.data.jobId}/cancel`);
    expect([200, 202]).toContain(cancel.status);
    await s.generation.service.onIdle();

    const usageAfterCancel = await s.call(s.alice).get("/api/v1/me/usage");
    expect(usageAfterCancel.body.data.usage.used).toBe(1);
    expect(usageAfterCancel.body.data.usage.remaining).toBe(0);

    // Subsequent request hits 429 QUOTA_EXCEEDED
    const g2 = await s.call(s.alice).post("/api/v1/generations").send({ inputType: "prompt", prompt: "Explain HTTP" });
    expect(g2.status).toBe(429);
    expect(g2.body.error.code).toBe("QUOTA_EXCEEDED");
  });

  it("refunds companion calls on provider 503 failure but NOT on 422 content block", async () => {
    const s = setup({ GENERATION_LIMIT_MONTHLY: "1" });
    const job = s.generation.store.seed({
      owner_id: s.alice.user.id,
      input_text: "TCP",
      status: "completed",
      progress: 100,
      learning_plan: { schemaVersion: "1.0", title: "TCP", summary: "s", learningObjectives: ["o"], sections: [{ id: "s1", title: "S1", visualType: "flowchart", keyConcepts: [], relationships: [], explanation: "e", sourceRefs: [] }], warnings: [] },
      scene_json: { type: "excalidraw", elements: [{ id: "e1", type: "rectangle", x: 0, y: 0, width: 50, height: 50 }], appState: {} },
      settings: {},
    });
    const noteRes = await s.call(s.alice).post("/api/v1/notes").send({ jobId: job.id });
    const noteId = noteRes.body.data.note.id;

    // 503 provider error refunds
    s.notes.companion.failWith = Object.assign(new Error("AI busy"), { code: "PROVIDER_TRANSIENT_ERROR", status: 503 });
    const askFail = await s.call(s.alice).post(`/api/v1/notes/${noteId}/ask`).send({ question: "Why SYN?" });
    expect(askFail.status).toBe(503);
    expect((await s.call(s.alice).get("/api/v1/me/usage")).body.data.usage.used).toBe(0);

    // 422 safety block does NOT refund
    s.notes.companion.failWith = Object.assign(new Error("Blocked"), { code: "MODEL_RESPONSE_BLOCKED" });
    const askBlock = await s.call(s.alice).post(`/api/v1/notes/${noteId}/ask`).send({ question: "Bad input" });
    expect(askBlock.status).toBe(422);
    expect((await s.call(s.alice).get("/api/v1/me/usage")).body.data.usage.used).toBe(1);
  });

  it("enforces strict per-event allowlist, drops PII/URLs/prompts, debounces note_opened/note_edited, and warns once without service role", async () => {
    // 1. Fuzz PII values: emails, URLs, JWTs, prompt-length text, unknown keys are stripped
    const fuzzed = sanitizeEventProperties("generation_started", {
      jobId: "job-123",
      inputType: "prompt",
      email: "user@example.com",
      url: "https://evil.example/token",
      detail: "https://bad.url/cannot-pass",
      visualStyle: "secretuser@example.com",
      attemptCount: 1,
      prompt: "Explain how photosynthesis works in detail...",
      arbitrary: "drop-me",
    });
    expect(fuzzed).toEqual({ jobId: "job-123", inputType: "prompt", attemptCount: 1 });

    // 2. Drops unknown event names cleanly
    expect(sanitizeEventProperties("unlisted_event", { jobId: "1" })).toBeNull();

    // 3. Warn once in non-prod when service_role is absent
    const logs = [];
    const sink = new Writable({ write: (c, _, cb) => { logs.push(c.toString()); cb(); } });
    const cfg = loadConfig(BASE_ENV);
    const logger = createLogger({ ...cfg, logLevel: "warn" }, sink);
    const degraded = createAnalyticsService({ config: cfg, adminDb: null, logger });
    expect(degraded.record("folder_created", "u1", { folderId: "f1" })).toBe(false);
    expect(degraded.record("folder_created", "u1", { folderId: "f2" })).toBe(false);
    expect(logs.length).toBe(1);

    // 4. 30-min debounce on note_opened & note_edited
    const events = [];
    const svc = createAnalyticsService({ config: cfg, memoryEvents: events, debounceMs: 5000 });
    expect(svc.record("note_opened", "u1", { noteId: "n1" })).toBe(true);
    expect(svc.record("note_opened", "u1", { noteId: "n1" })).toBe(false);
    expect(svc.record("note_edited", "u1", { noteId: "n1", revision: 1 })).toBe(true);
    expect(svc.record("note_edited", "u1", { noteId: "n1", revision: 2 })).toBe(false);
    // Different note or different user still emits
    expect(svc.record("note_opened", "u1", { noteId: "n2" })).toBe(true);
    await svc.flush();
    expect(events.length).toBe(3);
  });

  it("emits PRD §14.3 server events end-to-end with zero PII across routes and anonymous account_deleted", async () => {
    const s = setup();

    // First /me for a user without a pre-existing profile emits auth_signup_completed
    const fresh = s.addUser({ email: "fresh-analytics@example.test", password: "Password123!", withProfile: false });
    await request(s.app).get("/api/v1/me").set("Authorization", `Bearer ${fresh.token}`).expect(200);

    // Folder created
    const fRes = await s.call(s.alice).post("/api/v1/folders").send({ name: "Networks" });
    expect(fRes.status).toBe(201);

    // Generation started -> stage_changed -> completed -> save -> open -> edit -> restore -> export
    const genRes = await s.call(s.alice).post("/api/v1/generations").send({ inputType: "prompt", prompt: "Explain TCP" });
    expect(genRes.status).toBe(202);
    await s.generation.service.onIdle();

    const saveRes = await s.call(s.alice).post("/api/v1/notes").send({ jobId: genRes.body.data.jobId, title: "PRIVATE_TITLE_NOT_TRACKED" });
    expect(saveRes.status).toBe(201);
    const noteId = saveRes.body.data.note.id;

    await s.call(s.alice).get(`/api/v1/notes/${noteId}`).expect(200);
    await s.call(s.alice).put(`/api/v1/notes/${noteId}/draft`).send({
      baseRevision: 0,
      sceneJson: { type: "excalidraw", elements: [{ id: "e1", type: "rectangle", x: 0, y: 0, width: 50, height: 50 }], appState: {} },
    }).expect(200);
    const vList = await s.call(s.alice).get(`/api/v1/notes/${noteId}/versions`).expect(200);
    await s.call(s.alice).post(`/api/v1/notes/${noteId}/restore/${vList.body.data.items[0].id}`).expect(201);
    await s.call(s.alice).post(`/api/v1/notes/${noteId}/exports`).send({ format: "png", scope: "full" }).expect(201);

    // Account deletion emits account_deleted with owner_id: null and zero PII
    await request(s.app)
      .delete("/api/v1/me")
      .set("Authorization", `Bearer ${fresh.token}`)
      .send({ confirmation: "DELETE MY ACCOUNT", password: "Password123!" })
      .expect(200);

    await s.analyticsService.flush();
    const names = s.state.productEvents.map((e) => e.event_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "auth_signup_completed",
        "folder_created",
        "generation_started",
        "generation_stage_changed",
        "generation_completed",
        "note_saved",
        "note_opened",
        "note_edited",
        "note_version_restored",
        "note_exported",
        "account_deleted",
      ])
    );

    const deletedEvt = s.state.productEvents.find((e) => e.event_name === "account_deleted");
    expect(deletedEvt.owner_id).toBeNull();
    expect(JSON.stringify(s.state.productEvents)).not.toContain("PRIVATE_TITLE_NOT_TRACKED");
    expect(JSON.stringify(s.state.productEvents)).not.toContain("fresh-analytics@example.test");
  });
});
