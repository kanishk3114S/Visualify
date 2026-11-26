import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/testApp.js";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const ALLOWLIST_ADMIN_ID = "33333333-3333-4333-8333-333333333333";

describe("Phase 6.5 §4.4: /api/v1/admin/metrics & profile.isAdmin flag", () => {
  let ctx;
  let owner;
  let roleAdmin;
  let allowAdmin;
  let rpcCalls;

  beforeAll(() => {
    ctx = buildTestApp({ ADMIN_USER_IDS: ALLOWLIST_ADMIN_ID });
    owner = ctx.addUser({
      id: OWNER_ID,
      email: "student@example.test",
      appMetadata: { provider: "email", role: "authenticated" },
    });
    roleAdmin = ctx.addUser({
      id: ADMIN_ID,
      email: "admin@example.test",
      appMetadata: { provider: "email", role: "admin" },
    });
    allowAdmin = ctx.addUser({
      id: ALLOWLIST_ADMIN_ID,
      email: "allow@example.test",
      appMetadata: { provider: "email", role: "authenticated" },
    });

    rpcCalls = [];
    const baseCreateAdmin = ctx.gateway.createAdminClient.bind(ctx.gateway);
    vi.spyOn(ctx.gateway, "createAdminClient").mockImplementation(() => ({
      ...baseCreateAdmin(),
      rpc: vi.fn(async (fnName, params) => {
        rpcCalls.push({ fnName, params });
        return {
          data: {
            window: { from: params.p_from, to: params.p_to },
            counts: {
              signups: 10,
              activatedUsers: 6,
              generationStarted: 20,
              generationCompleted: 18,
              generationFailed: 2,
              generationCancelled: 1,
              generationRepaired: 1,
              regenerationActions: 2,
              notesSaved: 12,
              notesExported: 5,
              notesEdited: 4,
              returnEligibleUsers: 8,
              returnUsers: 3,
              promptTokens: 12000,
              outputTokens: 9000,
            },
            metrics: {
              activationRate: 0.6,
              generationCompletionRate: 0.9474,
              timeToFirstUsefulVisualMs: { p50: 4120, p95: 8900 },
              saveRate: 0.6667,
              sevenDayLibraryReturnRate: 0.375,
              exportRate: 0.4167,
              editEngagementRate: 0.3333,
              regenerationRate: 0.15,
              costPerCompletedVisualUsd: 0.000267,
            },
          },
          error: null,
        };
      }),
    }));
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("sets profile.isAdmin=false for regular users and true for JWT role=admin or ADMIN_USER_IDS allowlist", async () => {
    const ownerRes = await request(ctx.app).get("/api/v1/me").set("Authorization", `Bearer ${owner.token}`);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data.profile.isAdmin).toBe(false);

    const roleAdminRes = await request(ctx.app).get("/api/v1/me").set("Authorization", `Bearer ${roleAdmin.token}`);
    expect(roleAdminRes.status).toBe(200);
    expect(roleAdminRes.body.data.profile.isAdmin).toBe(true);

    const allowAdminRes = await request(ctx.app).get("/api/v1/me").set("Authorization", `Bearer ${allowAdmin.token}`);
    expect(allowAdminRes.status).toBe(200);
    expect(allowAdminRes.body.data.profile.isAdmin).toBe(true);
  });

  it("rejects unauthenticated callers (401) and non-admin callers (403 FORBIDDEN) on GET /api/v1/admin/metrics", async () => {
    const unauth = await request(ctx.app).get("/api/v1/admin/metrics");
    expect(unauth.status).toBe(401);

    const forbidden = await request(ctx.app).get("/api/v1/admin/metrics").set("Authorization", `Bearer ${owner.token}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
  });

  it("validates date format, from <= to, and max 90-day window on GET /api/v1/admin/metrics", async () => {
    const badDate = await request(ctx.app)
      .get("/api/v1/admin/metrics?from=not-a-date")
      .set("Authorization", `Bearer ${roleAdmin.token}`);
    expect(badDate.status).toBe(400);
    expect(badDate.body.error.code).toBe("VALIDATION_ERROR");

    const reversed = await request(ctx.app)
      .get("/api/v1/admin/metrics?from=2026-11-20T00:00:00.000Z&to=2026-11-10T00:00:00.000Z")
      .set("Authorization", `Bearer ${roleAdmin.token}`);
    expect(reversed.status).toBe(400);

    const tooWide = await request(ctx.app)
      .get("/api/v1/admin/metrics?from=2026-08-01T00:00:00.000Z&to=2026-11-20T00:00:00.000Z")
      .set("Authorization", `Bearer ${roleAdmin.token}`);
    expect(tooWide.status).toBe(400);
    expect(tooWide.body.error.message).toMatch(/90 days/i);
  });

  it("returns all 9 aggregated PRD §14.1 metrics without PII via single SQL RPC call", async () => {
    rpcCalls.length = 0;
    const res = await request(ctx.app)
      .get("/api/v1/admin/metrics?from=2026-11-01T00:00:00.000Z&to=2026-11-26T00:00:00.000Z")
      .set("Authorization", `Bearer ${allowAdmin.token}`);

    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fnName).toBe("compute_product_metrics");
    const report = res.body.data.report;
    expect(report.metrics).toMatchObject({
      activationRate: 0.6,
      generationCompletionRate: 0.9474,
      timeToFirstUsefulVisualMs: { p50: 4120, p95: 8900 },
      saveRate: 0.6667,
      sevenDayLibraryReturnRate: 0.375,
      exportRate: 0.4167,
      editEngagementRate: 0.3333,
      regenerationRate: 0.15,
      costPerCompletedVisualUsd: 0.000267,
    });
    expect(JSON.stringify(report)).not.toMatch(/student@example\.test|admin@example\.test|allow@example\.test|"prompt":/i);
  });
});
