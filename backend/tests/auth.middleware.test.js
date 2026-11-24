import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { extractBearerToken, requireAuth } from "../src/middleware/auth.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { requestId } from "../src/middleware/requestId.js";
import { buildTestApp } from "./helpers/testApp.js";

describe("extractBearerToken", () => {
  it("accepts a well-formed Bearer JWT (case-insensitive scheme)", () => {
    expect(extractBearerToken("Bearer aaa.bbb.ccc")).toBe("aaa.bbb.ccc");
    expect(extractBearerToken("bearer aaa.bbb.ccc")).toBe("aaa.bbb.ccc");
  });

  it.each([
    [undefined],
    [""],
    ["Bearer"],
    ["Bearer "],
    ["Basic dXNlcjpwYXNz"],
    ["Token aaa.bbb.ccc"],
    ["Bearer not-a-jwt"],
    ["Bearer aaa.bbb"],
    ["Bearer aaa.bbb.ccc extra"],
    ["Bearer aaa.b$b.ccc"],
    [`Bearer ${"a".repeat(9000)}.b.c`],
  ])("rejects %j", (header) => {
    expect(extractBearerToken(header)).toBeNull();
  });
});

describe("requireAuth on protected routes", () => {
  it("returns 401 UNAUTHORIZED when the Authorization header is missing", async () => {
    const { app, state } = buildTestApp();
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, data: null, error: { code: "UNAUTHORIZED" } });
    expect(state.calls).toEqual([]); // never reached Supabase
  });

  it("returns 401 for a malformed Bearer value without calling Supabase", async () => {
    const { app, state } = buildTestApp();
    const res = await request(app).get("/api/v1/me").set("Authorization", "Bearer garbage");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(state.calls).toEqual([]);
  });

  it("returns 401 INVALID_TOKEN for an expired/revoked token rejected by Supabase", async () => {
    const { app, state } = buildTestApp();
    const res = await request(app)
      .get("/api/v1/me")
      .set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.expiredsignature");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
    expect(state.calls.map((c) => c.op)).toEqual(["auth.getUser"]); // no DB access
  });

  it("applies to every /me route, including uploads (before multipart is parsed)", async () => {
    const { app } = buildTestApp();
    const routes = [
      request(app).patch("/api/v1/me").send({ bio: "x" }),
      request(app).post("/api/v1/me/avatar").attach("avatar", Buffer.from("x"), "a.png"),
      request(app).delete("/api/v1/me/avatar"),
    ];
    for (const res of await Promise.all(routes)) {
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }
  });

  it("returns 503 (not 401) when Supabase Auth is unreachable, so clients don't sign users out", async () => {
    const { app, state, addUser } = buildTestApp();
    const { token } = addUser();
    state.authDown = true;
    const res = await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AUTH_UNAVAILABLE");
  });

  it("populates req.user / req.accessToken / req.db from the verified token", async () => {
    const gateway = {
      verifyAccessToken: vi.fn(async () => ({ id: "user-123", email: "u@example.test", metadata: {} })),
      createUserClient: vi.fn(() => ({ scoped: true })),
    };
    const app = express();
    app.use(requestId());
    app.get("/probe", requireAuth(gateway), (req, res) =>
      res.json({ user: req.user, token: req.accessToken, db: req.db })
    );
    app.use(errorHandler);
    const res = await request(app).get("/probe").set("Authorization", "Bearer aaa.bbb.ccc");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: "user-123", email: "u@example.test", metadata: {} },
      token: "aaa.bbb.ccc",
      db: { scoped: true },
    });
    expect(gateway.verifyAccessToken).toHaveBeenCalledWith("aaa.bbb.ccc");
    expect(gateway.createUserClient).toHaveBeenCalledWith("aaa.bbb.ccc");
  });

  it("never writes the bearer token to logs", async () => {
    const { app, addUser, logText } = buildTestApp();
    const { token } = addUser();
    await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`);
    await request(app).get("/api/v1/me").set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJ4IjoxfQ.badsig");
    expect(logText().length).toBeGreaterThan(0);
    expect(logText()).not.toContain(token);
    expect(logText()).not.toContain("badsig");
  });
});
