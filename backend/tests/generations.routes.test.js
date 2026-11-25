import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/testApp.js";
import { deferred, SAMPLE_PLAN } from "./helpers/fakeGeneration.js";

const UNKNOWN_ID = "6f1c2c1e-1111-4a4a-8b8b-123456789abc";
const VALID = { inputType: "prompt", prompt: "Explain the TCP three-way handshake", settings: { audienceLevel: "undergraduate", detail: "standard" } };
const servers = [];

function setup(opts) {
  const ctx = buildTestApp({}, opts);
  const alice = ctx.addUser({ email: "alice@example.test" });
  const bob = ctx.addUser({ email: "bob@example.test" });
  const as = (who) => ({
    get: (url) => request(ctx.app).get(url).set("Authorization", `Bearer ${who.token}`),
    post: (url) => request(ctx.app).post(url).set("Authorization", `Bearer ${who.token}`),
  });
  return { ...ctx, alice, bob, as, store: ctx.generation.store, deps: ctx.generation.pipelineDeps, service: ctx.generation.service };
}

/** Opens an SSE stream over real HTTP with fetch (the same way the browser client does). */
async function openStream(app, path, token) {
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: ac.signal,
  });
  const decoder = new TextDecoder();
  let text = "";
  const reader = res.body?.getReader();
  async function readUntil(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(text)) {
      if (Date.now() > deadline) throw new Error(`timed out; stream so far:\n${text}`);
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 50)),
      ]);
      if (value) text += decoder.decode(value, { stream: true });
      if (done) break;
    }
    return text;
  }
  const events = () =>
    text
      .split("\n\n")
      .map((block) => ({ type: /^event: (.+)$/m.exec(block)?.[1], data: /^data: (.+)$/m.exec(block)?.[1] }))
      .filter((e) => e.type)
      .map((e) => ({ type: e.type, data: JSON.parse(e.data) }));
  return { res, readUntil, events, close: () => ac.abort(), text: () => text };
}

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/generations", () => {
  it("requires authentication before parsing the body", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/v1/generations").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 202 with { jobId, status: queued } in the envelope and runs the job to completion", async () => {
    const { as, alice, store, service, deps } = setup();
    const res = await as(alice).post("/api/v1/generations").send(VALID);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true, error: null, data: { jobId: expect.any(String), status: "queued" }, meta: { requestId: expect.any(String) } });
    expect(res.headers.location).toBe(`/api/v1/generations/${res.body.data.jobId}`);
    await service.onIdle();
    const row = store.rows.get(res.body.data.jobId);
    expect(row).toMatchObject({ owner_id: alice.user.id, status: "completed", progress: 100, model_id: "gemini-test", prompt_version: "planner-test" });
    expect(row.learning_plan.title).toBe(SAMPLE_PLAN.title);
    expect(deps.calls.find((c) => c.op === "planner")).toMatchObject({
      prompt: VALID.prompt,
      settings: { audienceLevel: "undergraduate", detail: "standard", subject: "", visualStyle: "hand_drawn_clean", preferredOutput: "auto" },
    });
    expect(deps.calls.filter((c) => c.op === "compile").every((c) => c.signal)).toBe(true);
  });

  it("normalises the prompt (control chars, blank-line runs) and applies settings defaults", async () => {
    const { as, alice, store, service } = setup();
    const res = await as(alice).post("/api/v1/generations").send({ inputType: "prompt", prompt: "  Explain\u0007 DNS\r\n\n\n\n\nresolution  " });
    expect(res.status).toBe(202);
    await service.onIdle();
    const row = store.rows.get(res.body.data.jobId);
    expect(row.input_text).toBe("Explain DNS\n\nresolution");
    expect(row.settings).toEqual({ subject: "", audienceLevel: "undergraduate", detail: "standard", visualStyle: "hand_drawn_clean", preferredOutput: "auto" });
  });

  it("passes a preferredOutput override to the planner as the only allowed visual type", async () => {
    const { as, alice, deps, service } = setup();
    await as(alice).post("/api/v1/generations").send({ ...VALID, settings: { preferredOutput: "mindmap" } });
    await service.onIdle();
    expect(deps.calls.find((c) => c.op === "planner").preferredVisualTypes).toEqual(["mindmap"]);
  });

  it.each([
    ["missing prompt", { inputType: "prompt" }, "prompt"],
    ["empty prompt", { inputType: "prompt", prompt: "" }, "prompt"],
    ["whitespace-only prompt", { inputType: "prompt", prompt: "   \n\t  " }, "prompt"],
    ["prompt over 8,000 characters", { inputType: "prompt", prompt: "a".repeat(8001) }, "prompt"],
    ["wrong inputType", { inputType: "video", prompt: "x" }, "inputType"],
    ["pdf without sourceFileId", { inputType: "pdf", prompt: "x" }, "sourceFileId"],
    ["image with pageRange", { inputType: "image", sourceFileId: UNKNOWN_ID, pageRange: { startPage: 1, endPage: 2 } }, "pageRange"],
    ["missing inputType", { prompt: "x" }, "inputType"],
    ["unknown top-level field", { ...VALID, ownerId: "someone-else" }, null],
    ["invalid audience level", { ...VALID, settings: { audienceLevel: "phd" } }, "settings.audienceLevel"],
    ["invalid preferred output", { ...VALID, settings: { preferredOutput: "pie_chart" } }, "settings.preferredOutput"],
    ["unknown settings field", { ...VALID, settings: { model: "gpt" } }, null],
    ["subject too long", { ...VALID, settings: { subject: "s".repeat(121) } }, "settings.subject"],
  ])("rejects %s with 400 VALIDATION_ERROR", async (_label, body, field) => {
    const { as, alice, store } = setup();
    const res = await as(alice).post("/api/v1/generations").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    if (field) expect(res.body.error.details.map((d) => d.field)).toContain(field);
    expect(store.rows.size).toBe(0);
  });

  it("accepts exactly 8,000 characters", async () => {
    const { as, alice, service } = setup();
    const res = await as(alice).post("/api/v1/generations").send({ inputType: "prompt", prompt: "a".repeat(8000) });
    expect(res.status).toBe(202);
    await service.onIdle();
  });

  it("enforces one active job per user with 409 ACTIVE_JOB_EXISTS; other users are unaffected", async () => {
    const { as, alice, bob, deps, service } = setup();
    deps.gate = deferred();
    const first = await as(alice).post("/api/v1/generations").send(VALID);
    expect(first.status).toBe(202);
    const second = await as(alice).post("/api/v1/generations").send(VALID);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: "ACTIVE_JOB_EXISTS", details: { activeJobId: first.body.data.jobId } });
    expect((await as(bob).post("/api/v1/generations").send(VALID)).status).toBe(202);
    deps.gate.resolve();
    await service.onIdle();
    expect((await as(alice).post("/api/v1/generations").send(VALID)).status).toBe(202);
    await service.onIdle();
  });

  it("reclaims an orphaned active job (not running in this process, stale) instead of blocking forever", async () => {
    const { as, alice, store, service } = setup();
    const orphan = store.seed({ owner_id: alice.user.id, input_text: "old", status: "planning", updated_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    const res = await as(alice).post("/api/v1/generations").send(VALID);
    expect(res.status).toBe(202);
    expect(store.rows.get(orphan.id)).toMatchObject({ status: "failed", error_code: "INTERRUPTED" });
    await service.onIdle();
  });

  it("does not reclaim a recently updated active job", async () => {
    const { as, alice, store } = setup();
    store.seed({ owner_id: alice.user.id, input_text: "recent", status: "planning", updated_at: new Date().toISOString() });
    expect((await as(alice).post("/api/v1/generations").send(VALID)).status).toBe(409);
  });

  it("returns 503 GENERATION_UNAVAILABLE when generation is not configured", async () => {
    const { as, alice, store } = setup({ generationEnabled: false });
    const res = await as(alice).post("/api/v1/generations").send(VALID);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("GENERATION_UNAVAILABLE");
    expect(store.rows.size).toBe(0);
  });

  it("rate-limits job creation per user (20/hour)", async () => {
    const { as, alice, bob, service } = setup();
    let last;
    for (let i = 0; i < 21; i += 1) {
      last = await as(alice).post("/api/v1/generations").send(VALID);
      await service.onIdle();
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("RATE_LIMITED");
    expect((await as(bob).post("/api/v1/generations").send(VALID)).status).toBe(202);
    await service.onIdle();
  });

  it("never writes the prompt text to logs", async () => {
    const { as, alice, service, logText } = setup();
    await as(alice).post("/api/v1/generations").send({ ...VALID, prompt: "PRIVATE-PROMPT-MARKER about my medical notes" });
    await service.onIdle();
    expect(logText()).toContain("generation completed");
    expect(logText()).not.toContain("PRIVATE-PROMPT-MARKER");
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/v1/generations/:jobId", () => {
  it("returns the owner's completed job with plan, scene, mermaid source and no internals", async () => {
    const { as, alice, service } = setup();
    const { body } = await as(alice).post("/api/v1/generations").send(VALID);
    await service.onIdle();
    const res = await as(alice).get(`/api/v1/generations/${body.data.jobId}`);
    expect(res.status).toBe(200);
    const job = res.body.data.job;
    expect(job).toMatchObject({
      jobId: body.data.jobId,
      status: "completed",
      progress: 100,
      prompt: VALID.prompt,
      safeError: null,
      learningPlan: { title: SAMPLE_PLAN.title },
      mermaidSource: expect.stringContaining("%% section: handshake"),
      warnings: [],
      attemptCount: 1,
    });
    expect(job.sceneJson.elements.some((e) => e.id.startsWith("handshake__"))).toBe(true);
    expect(job.sceneJson.elements.some((e) => e.id.startsWith("states__"))).toBe(true);
    for (const key of ["owner_id", "ownerId", "usage", "model_id", "updated_at"]) expect(job).not.toHaveProperty(key);
  });

  it.each([
    ["another user's job", (ctx, id) => ctx.as(ctx.bob).get(`/api/v1/generations/${id}`)],
    ["an unknown id", (ctx) => ctx.as(ctx.alice).get(`/api/v1/generations/${UNKNOWN_ID}`)],
    ["a malformed id", (ctx) => ctx.as(ctx.alice).get(`/api/v1/generations/not-a-uuid'or'1'='1`)],
  ])("returns the same 404 for %s", async (_label, call) => {
    const ctx = setup();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    await ctx.service.onIdle();
    const res = await call(ctx, body.data.jobId);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Generation not found.", details: null });
  });

  it("requires authentication", async () => {
    const { app } = setup();
    expect((await request(app).get(`/api/v1/generations/${UNKNOWN_ID}`)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("pipeline outcomes (mocked Gemini + CLI)", () => {
  async function run(ctx, body = VALID) {
    const res = await ctx.as(ctx.alice).post("/api/v1/generations").send(body);
    await ctx.service.onIdle();
    return (await ctx.as(ctx.alice).get(`/api/v1/generations/${res.body.data.jobId}`)).body.data.job;
  }

  it.each([
    ["PROVIDER_RATE_LIMIT", "AI_BUSY"],
    ["PROVIDER_TIMEOUT", "GENERATION_TIMEOUT"],
    ["PROVIDER_TRANSIENT_ERROR", "AI_UNAVAILABLE"],
    ["MODEL_RESPONSE_BLOCKED", "CONTENT_BLOCKED"],
    ["SCHEMA_VALIDATION_FAILED", "INVALID_PLAN"],
    ["SOMETHING_UNEXPECTED", "GENERATION_FAILED"],
  ])("maps provider error %s to a safe %s failure with no raw details", async (internal, safeCode) => {
    const ctx = setup();
    ctx.deps.plannerError = Object.assign(new Error(`Gemini API failed: key=AIzaSECRET at /srv/app/node_modules/x.js`), { code: internal });
    const job = await run(ctx);
    expect(job.status).toBe("failed");
    expect(job.safeError.code).toBe(safeCode);
    const raw = JSON.stringify(job);
    for (const leak of ["AIzaSECRET", "node_modules", "/srv/", "Gemini API failed"]) expect(raw).not.toContain(leak);
    expect(job.learningPlan).toBeNull();
    expect(job.sceneJson).toBeNull();
  });

  it("rejects a schema-invalid plan from the planner (output is re-validated) as INVALID_PLAN", async () => {
    const ctx = setup();
    ctx.deps.plan = { ...SAMPLE_PLAN, sections: [] };
    const job = await run(ctx);
    expect(job).toMatchObject({ status: "failed", safeError: { code: "INVALID_PLAN" } });
  });

  it("completes with a warning when one section's diagram fails (partial success)", async () => {
    const ctx = setup();
    ctx.deps.failSections.add("comparison");
    const job = await run(ctx);
    expect(job.status).toBe("completed");
    expect(job.warnings).toEqual(['The diagram for "TCP vs UDP" couldn\'t be drawn; its explanation is still included.']);
    expect(job.sceneJson.elements.some((e) => e.id.startsWith("states__"))).toBe(false);
    expect(job.learningPlan.sections).toHaveLength(2);
    expect(JSON.stringify(job)).not.toContain("secret");
  });

  it("fails with RENDER_FAILED when no section can be drawn", async () => {
    const ctx = setup();
    ctx.deps.failSections.add("comparison").add("sequence");
    const job = await run(ctx);
    expect(job).toMatchObject({ status: "failed", safeError: { code: "RENDER_FAILED" }, sceneJson: null });
  });

  it("fails with GENERATION_TIMEOUT when the whole job exceeds its time limit", async () => {
    const ctx = setup({ generation: { generationOverrides: { jobTimeoutMs: 80 } } });
    ctx.deps.gate = deferred(); // planner never returns
    const job = await run(ctx);
    expect(job).toMatchObject({ status: "failed", safeError: { code: "GENERATION_TIMEOUT" } });
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/v1/generations/:jobId/events (SSE)", () => {
  it("streams snapshot -> stage/progress -> completed with SSE headers and monotonic progress", async () => {
    const ctx = setup();
    ctx.deps.gate = deferred();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    const stream = await openStream(ctx.app, `/api/v1/generations/${body.data.jobId}/events`, ctx.alice.token);
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(stream.res.headers.get("cache-control")).toContain("no-cache");
    expect(stream.res.headers.get("connection")).toBe("keep-alive");
    await stream.readUntil((t) => t.includes("event: snapshot"));
    ctx.deps.gate.resolve();
    await stream.readUntil((t) => t.includes("event: completed"));
    const events = stream.events();
    expect(events[0].type).toBe("snapshot");
    expect(events.at(-1)).toEqual({ type: "completed", data: { status: "completed", progress: 100 } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["stage", "progress"]));
    // The job was already planning when the stream connected: the snapshot carries it.
    expect(events[0].data).toMatchObject({ status: "planning", stage: "planning" });
    const stages = events.filter((e) => e.type === "stage").map((e) => e.data.stage);
    expect(stages).toEqual(["composing", "persisting"]);
    const progress = events.map((e) => e.data.progress).filter((p) => typeof p === "number");
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(stream.text()).toContain("retry: 3000");
  });

  it("sends heartbeat comments while idle", async () => {
    const ctx = setup({ generation: { heartbeatMs: 30 } });
    ctx.deps.gate = deferred();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    const stream = await openStream(ctx.app, `/api/v1/generations/${body.data.jobId}/events`, ctx.alice.token);
    await stream.readUntil((t) => t.includes(": heartbeat"));
    stream.close();
    ctx.deps.gate.resolve();
    await ctx.service.onIdle();
  });

  it("emits snapshot + terminal event and closes for an already-finished job", async () => {
    const ctx = setup();
    ctx.deps.plannerError = Object.assign(new Error("x"), { code: "PROVIDER_RATE_LIMIT" });
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    await ctx.service.onIdle();
    const stream = await openStream(ctx.app, `/api/v1/generations/${body.data.jobId}/events`, ctx.alice.token);
    await stream.readUntil((t) => t.includes("event: failed"));
    const events = stream.events();
    expect(events.map((e) => e.type)).toEqual(["snapshot", "failed"]);
    expect(events[1].data.error).toEqual({ code: "AI_BUSY", message: expect.any(String) });
  });

  it("removes its event-bus listener when the client disconnects", async () => {
    const ctx = setup();
    ctx.deps.gate = deferred();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    const jobId = body.data.jobId;
    const stream = await openStream(ctx.app, `/api/v1/generations/${jobId}/events`, ctx.alice.token);
    await stream.readUntil((t) => t.includes("event: snapshot"));
    expect(ctx.generation.bus.listenerCount(jobId)).toBe(1);
    stream.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.generation.bus.listenerCount(jobId)).toBe(0);
    ctx.deps.gate.resolve();
    await ctx.service.onIdle();
  });

  it("returns a JSON 404 for another user's job and 401 without a token", async () => {
    const ctx = setup();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    await ctx.service.onIdle();
    const other = await ctx.as(ctx.bob).get(`/api/v1/generations/${body.data.jobId}/events`);
    expect(other.status).toBe(404);
    expect(other.headers["content-type"]).toMatch(/application\/json/);
    expect(ctx.generation.bus.listenerCount(body.data.jobId)).toBe(0);
    expect((await request(ctx.app).get(`/api/v1/generations/${body.data.jobId}/events`)).status).toBe(401);
  });

  it("does not accept a token in the query string", async () => {
    const ctx = setup();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    await ctx.service.onIdle();
    const res = await request(ctx.app).get(`/api/v1/generations/${body.data.jobId}/events?access_token=${ctx.alice.token}`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/generations/:jobId/cancel", () => {
  it("cancels a running job: 202 cancelling, then cancelled with no partial results", async () => {
    const ctx = setup();
    ctx.deps.gate = deferred();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    await new Promise((r) => setTimeout(r, 20)); // let it reach "planning"
    const res = await ctx.as(ctx.alice).post(`/api/v1/generations/${body.data.jobId}/cancel`);
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ jobId: body.data.jobId, status: "cancelling" });
    await ctx.service.onIdle();
    const row = ctx.store.rows.get(body.data.jobId);
    expect(row).toMatchObject({ status: "cancelled", learning_plan: null, scene_json: null, error_code: null });
    expect(ctx.deps.calls.some((c) => c.op === "compile")).toBe(false);
  });

  it("cancels a queued job immediately without ever calling the model", async () => {
    const ctx = setup({ generation: { concurrency: 1 } });
    ctx.deps.gate = deferred();
    await ctx.as(ctx.bob).post("/api/v1/generations").send(VALID); // occupies the only slot
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    const res = await ctx.as(ctx.alice).post(`/api/v1/generations/${body.data.jobId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
    expect(ctx.generation.queue.isTracked(body.data.jobId)).toBe(false);
    ctx.deps.gate.resolve();
    await ctx.service.onIdle();
    expect(ctx.deps.calls.filter((c) => c.op === "planner")).toHaveLength(1); // only bob's
    expect(ctx.store.rows.get(body.data.jobId).status).toBe("cancelled");
  });

  it("is idempotent", async () => {
    const ctx = setup();
    ctx.deps.gate = deferred();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    await ctx.as(ctx.alice).post(`/api/v1/generations/${body.data.jobId}/cancel`);
    await ctx.service.onIdle();
    const again = await ctx.as(ctx.alice).post(`/api/v1/generations/${body.data.jobId}/cancel`);
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe("cancelled");
  });

  it("cancels an orphaned active job that is not running in this process", async () => {
    const ctx = setup();
    const orphan = ctx.store.seed({ owner_id: ctx.alice.user.id, input_text: "x", status: "planning" });
    const res = await ctx.as(ctx.alice).post(`/api/v1/generations/${orphan.id}/cancel`);
    expect(res.body.data.status).toBe("cancelled");
  });

  it("returns 409 for a completed job and 404 for another user's job", async () => {
    const ctx = setup();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    await ctx.service.onIdle();
    const done = await ctx.as(ctx.alice).post(`/api/v1/generations/${body.data.jobId}/cancel`);
    expect(done.status).toBe(409);
    expect(done.body.error.code).toBe("JOB_ALREADY_FINISHED");
    expect((await ctx.as(ctx.bob).post(`/api/v1/generations/${body.data.jobId}/cancel`)).status).toBe(404);
    expect(ctx.store.rows.get(body.data.jobId).status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/generations/:jobId/retry", () => {
  it("creates a linked new attempt for a failed job and runs it", async () => {
    const ctx = setup();
    ctx.deps.plannerError = Object.assign(new Error("x"), { code: "PROVIDER_TRANSIENT_ERROR" });
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    await ctx.service.onIdle();
    ctx.deps.plannerError = null;
    const res = await ctx.as(ctx.alice).post(`/api/v1/generations/${body.data.jobId}/retry`);
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ status: "queued", retryOf: body.data.jobId });
    await ctx.service.onIdle();
    const retried = ctx.store.rows.get(res.body.data.jobId);
    expect(retried).toMatchObject({ status: "completed", retry_of: body.data.jobId, attempt_count: 2, input_text: VALID.prompt });
    expect(ctx.store.rows.get(body.data.jobId).status).toBe("failed"); // history preserved
  });

  it("allows retrying a cancelled job", async () => {
    const ctx = setup();
    const cancelled = ctx.store.seed({ owner_id: ctx.alice.user.id, input_text: "x", status: "cancelled" });
    const res = await ctx.as(ctx.alice).post(`/api/v1/generations/${cancelled.id}/retry`);
    expect(res.status).toBe(202);
    await ctx.service.onIdle();
  });

  it("rejects completed/active jobs (409 JOB_NOT_RETRYABLE) and respects the 1-active-job rule", async () => {
    const ctx = setup();
    const { body } = await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    await ctx.service.onIdle();
    expect((await ctx.as(ctx.alice).post(`/api/v1/generations/${body.data.jobId}/retry`)).body.error.code).toBe("JOB_NOT_RETRYABLE");

    const failed = ctx.store.seed({ owner_id: ctx.alice.user.id, input_text: "x", status: "failed", error_code: "X", safe_error_message: "m" });
    ctx.deps.gate = deferred();
    await ctx.as(ctx.alice).post("/api/v1/generations").send(VALID);
    const blocked = await ctx.as(ctx.alice).post(`/api/v1/generations/${failed.id}/retry`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ACTIVE_JOB_EXISTS");
    ctx.deps.gate.resolve();
    await ctx.service.onIdle();
  });

  it("stops after the attempt limit and hides other users' jobs", async () => {
    const ctx = setup();
    const tired = ctx.store.seed({ owner_id: ctx.alice.user.id, input_text: "x", status: "failed", error_code: "X", safe_error_message: "m", attempt_count: 5 });
    expect((await ctx.as(ctx.alice).post(`/api/v1/generations/${tired.id}/retry`)).body.error.code).toBe("RETRY_LIMIT_REACHED");
    expect((await ctx.as(ctx.bob).post(`/api/v1/generations/${tired.id}/retry`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("crash recovery", () => {
  it("marks jobs left active by a previous process as interrupted (cancelling -> cancelled)", async () => {
    const ctx = setup();
    const a = ctx.store.seed({ owner_id: ctx.alice.user.id, input_text: "x", status: "planning" });
    const b = ctx.store.seed({ owner_id: ctx.bob.user.id, input_text: "x", status: "cancelling" });
    const done = ctx.store.seed({ owner_id: ctx.bob.user.id, input_text: "x", status: "completed", learning_plan: {}, scene_json: {}, progress: 100 });
    expect(await ctx.service.recoverInterruptedJobs()).toBe(2);
    expect(ctx.store.rows.get(a.id)).toMatchObject({ status: "failed", error_code: "INTERRUPTED" });
    expect(ctx.store.rows.get(b.id).status).toBe("cancelled");
    expect(ctx.store.rows.get(done.id).status).toBe("completed");
  });
});
