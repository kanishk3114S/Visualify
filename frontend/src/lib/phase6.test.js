import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function parseCspDirectives(csp) {
  const map = new Map();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...values] = tokens;
    map.set(name.toLowerCase(), values);
  }
  return map;
}

describe("Phase 6 + 6.6: Production CSP, deploy/origins.json & dev-only spike gate", () => {
  it("vercel.json CSP script-src uses exact SHA-256 hash of frontend/index.html pre-paint script (no unsafe-inline)", () => {
    const html = fs.readFileSync(path.join(ROOT, "frontend/index.html"), "utf8");
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    // Vercel serves LF; normalize CRLF checkouts on Windows so CSP hash remains cross-platform.
    const expectedHash = `sha256-${crypto.createHash("sha256").update(match[1].replace(/\r\n/g, "\n"), "utf8").digest("base64")}`;

    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const headers = vercel.headers[0].headers;
    const csp = headers.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(csp).toBeTruthy();

    const directives = parseCspDirectives(csp);
    const scriptSrc = directives.get("script-src") ?? [];
    expect(scriptSrc).toContain(`'${expectedHash}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain("*");
    expect(scriptSrc).not.toContain("data:");
    expect(scriptSrc).not.toContain("https:");

    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(headers.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
    expect(headers.find((h) => h.key === "X-Content-Type-Options")?.value).toBe("nosniff");
  });

  it("vercel.json CSP excludes localhost/127.0.0.1 and includes every API origin from deploy/origins.json", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const origins = JSON.parse(fs.readFileSync(path.join(ROOT, "deploy/origins.json"), "utf8"));
    const csp = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";

    expect(csp).not.toMatch(/localhost|127\.0\.0\.1/i);
    const directives = parseCspDirectives(csp);
    const connectSrc = directives.get("connect-src") ?? [];
    expect(connectSrc).not.toContain("*");

    for (const env of ["staging", "production"]) {
      const apiOrigin = origins[env]?.api;
      expect(apiOrigin, `deploy/origins.json ${env}.api`).toMatch(/^https:\/\//);
      expect(connectSrc).toContain(apiOrigin);
    }
  });

  it("router.jsx gates /spike/excalidraw behind import.meta.env.DEV", () => {
    const routerSrc = fs.readFileSync(path.join(ROOT, "frontend/src/app/router.jsx"), "utf8");
    expect(routerSrc).toContain("import.meta.env.DEV");
    expect(routerSrc).toContain("/spike/excalidraw");
  });
});
