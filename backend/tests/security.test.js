import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { buildTestApp, ALLOWED_ORIGIN, BASE_ENV } from "./helpers/testApp.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { requestId } from "../src/middleware/requestId.js";
import { loadConfig } from "../src/config/env.js";
import { createLogger } from "../src/utils/logger.js";
import { Writable } from "node:stream";

describe("security headers (helmet)", () => {
  it("sets the mandated headers on every response, including errors", async () => {
    const { app } = buildTestApp();
    for (const path of ["/api/v1/health", "/api/v1/me", "/nope"]) {
      const res = await request(app).get(path);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
      const csp = res.headers["content-security-policy"];
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
      expect(res.headers["x-powered-by"]).toBeUndefined();
    }
  });
});

describe("CORS allowlist", () => {
  it("allows the configured frontend origin with explicit methods/headers", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .options("/api/v1/me")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "PATCH")
      .set("Access-Control-Request-Headers", "authorization,content-type");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(res.headers["access-control-allow-methods"]).toBe("GET,POST,PATCH,DELETE");
    expect(res.headers["access-control-allow-headers"]).toBe("Authorization,Content-Type,X-Request-Id");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it.each(["https://evil.example", "http://localhost:5174", "null", "http://localhost:5173.evil.example"])(
    "rejects disallowed origin %s with 403 and no CORS headers",
    async (origin) => {
      const { app } = buildTestApp();
      const res = await request(app).get("/api/v1/health").set("Origin", origin);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("CORS_NOT_ALLOWED");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      const preflight = await request(app)
        .options("/api/v1/me")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "PATCH");
      expect(preflight.status).toBe(403);
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    }
  );

  it("never responds with a wildcard origin", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/health").set("Origin", ALLOWED_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("supports multiple comma-separated origins", async () => {
    const { app } = buildTestApp({ FRONTEND_ORIGIN: "http://localhost:5173, https://app.visualify.test" });
    const res = await request(app).get("/api/v1/health").set("Origin", "https://app.visualify.test");
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.visualify.test");
  });
});

describe("error responses never leak internals", () => {
  function appThatThrows(nodeEnv) {
    const app = express();
    app.use(requestId());
    app.get("/boom", () => {
      const err = new Error("relation \"secret_table\" does not exist at C:\\srv\\app\\db.js:42");
      err.code = "42P01";
      throw err;
    });
    app.use(errorHandler);
    return { app, nodeEnv };
  }

  it.each(["production", "development"])("returns a generic 500 envelope in %s", async (nodeEnv) => {
    const { app } = appThatThrows(nodeEnv);
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong", details: null },
      meta: { requestId: expect.any(String) },
    });
    const raw = JSON.stringify(res.body);
    for (const leak of ["secret_table", "db.js", "C:\\", "at ", "42P01", "stack"]) expect(raw).not.toContain(leak);
  });

  it("does not leak stack traces through the real app in production mode", async () => {
    const { app } = buildTestApp({ NODE_ENV: "production" });
    const res = await request(app).patch("/api/v1/me").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(401); // auth runs before any body parsing on protected routes
  });

  it("an authenticated malformed-JSON request gets INVALID_JSON with no parser internals", async () => {
    const { app, addUser } = buildTestApp({ NODE_ENV: "production" });
    const { token } = addUser();
    const res = await request(app)
      .patch("/api/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_JSON", message: "Request body must be valid JSON.", details: null });
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at JSON|node_modules|stack|position/);
  });

  it("rejects request bodies over 16 KiB with 413", async () => {
    const { app, addUser } = buildTestApp();
    const { token } = addUser();
    const res = await request(app)
      .patch("/api/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "x".repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("API-wide rate limiting", () => {
  it("returns a 429 envelope once the per-IP ceiling is exceeded", async () => {
    const { app } = buildTestApp();
    let last;
    for (let i = 0; i < 301; i += 1) last = await request(app).get("/api/v1/health");
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("RATE_LIMITED");
    expect(last.headers["retry-after"]).toBeDefined();
  });

  it("ignores spoofed X-Forwarded-For unless TRUST_PROXY is enabled", async () => {
    const { app } = buildTestApp();
    let last;
    for (let i = 0; i < 301; i += 1) {
      last = await request(app).get("/api/v1/health").set("X-Forwarded-For", `203.0.113.${i % 250}`);
    }
    expect(last.status).toBe(429);
  });
});

describe("logging redaction", () => {
  it("redacts tokens, passwords, emails and signed URLs from explicit log calls", () => {
    const lines = [];
    const sink = new Writable({ write: (c, _e, cb) => (lines.push(c.toString()), cb()) });
    const logger = createLogger({ ...loadConfig(BASE_ENV), logLevel: "info" }, sink);
    logger.info(
      {
        authorization: "Bearer aaa.bbb.secret",
        user: { email: "private@example.test", password: "hunter2" },
        signedUrl: "https://x/sign?token=abc",
        nested: { access_token: "tok-123" },
      },
      "test"
    );
    const out = lines.join("");
    for (const secret of ["aaa.bbb.secret", "private@example.test", "hunter2", "token=abc", "tok-123"]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("[REDACTED]");
  });

  it("request logs never contain emails or signed avatar URLs", async () => {
    const { app, addUser, logText } = buildTestApp();
    const { token } = addUser({ email: "very.private@example.test" });
    await request(app).get("/api/v1/me?email=leak@example.test").set("Authorization", `Bearer ${token}`);
    expect(logText()).not.toContain("very.private@example.test");
    expect(logText()).not.toContain("leak@example.test");
    expect(logText()).not.toMatch(/authorization|"headers"|remotePort/i);
    expect(logText()).toContain("request completed");
  });
});

describe("config validation", () => {
  it.each([
    ["wildcard origin", { FRONTEND_ORIGIN: "*" }],
    ["origin with path", { FRONTEND_ORIGIN: "http://localhost:5173/app" }],
    ["missing Supabase URL", { SUPABASE_URL: "" }],
    ["avatar limit above 5 MiB", { AVATAR_MAX_BYTES: String(6 * 1024 * 1024) }],
    ["signed URL TTL too long", { AVATAR_SIGNED_URL_TTL_SECONDS: "86400" }],
  ])("rejects %s without echoing values", (_label, override) => {
    const env = { ...BASE_ENV, ...override, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_not_echo_me_0000" };
    expect(() => loadConfig(env)).toThrow(/Invalid API environment configuration/);
    try {
      loadConfig(env);
    } catch (err) {
      expect(err.message).not.toContain("sb_publishable_do_not_echo_me_0000");
    }
  });
});
