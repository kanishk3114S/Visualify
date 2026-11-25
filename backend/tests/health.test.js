import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp, BASE_ENV } from "./helpers/testApp.js";

describe("GET /api/v1/health", () => {
  it("returns 200 with the standard envelope when dependencies are reachable", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      error: null,
      data: { status: "ok", checks: { api: "ok", supabase: "ok" } },
      meta: { requestId: expect.stringMatching(/^req_[0-9a-f]{32}$/) },
    });
    expect(res.headers["x-request-id"]).toBe(res.body.meta.requestId);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("is public (no Authorization header required)", async () => {
    const { app, state } = buildTestApp();
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(state.calls.some((c) => c.op === "auth.getUser")).toBe(false);
  });

  it("exposes zero secrets, keys, URLs or versions", async () => {
    const { app } = buildTestApp({ SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value-xyz" });
    const res = await request(app).get("/api/v1/health");
    const raw = JSON.stringify(res.body) + JSON.stringify(res.headers);
    for (const secret of [
      BASE_ENV.SUPABASE_PUBLISHABLE_KEY,
      BASE_ENV.SUPABASE_URL,
      "unit-test-project",
      "service-role-secret-value-xyz",
      process.version,
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("returns 503 SERVICE_DEGRADED with an envelope when Supabase is unreachable", async () => {
    const { app, state } = buildTestApp();
    state.healthy = false;
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      data: null,
      error: { code: "SERVICE_DEGRADED", details: { status: "degraded", checks: { api: "ok", supabase: "unreachable" } } },
    });
  });

  it("reuses a well-formed incoming X-Request-Id and replaces a malicious one", async () => {
    const { app } = buildTestApp();
    const good = await request(app).get("/api/v1/health").set("X-Request-Id", "client_trace_12345");
    expect(good.body.meta.requestId).toBe("client_trace_12345");
    const bad = await request(app).get("/api/v1/health").set("X-Request-Id", "<script>alert(1)</script>");
    expect(bad.body.meta.requestId).toMatch(/^req_/);
  });

  it("returns a 404 envelope for unknown routes", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, data: null, error: { code: "NOT_FOUND" } });
  });
});
