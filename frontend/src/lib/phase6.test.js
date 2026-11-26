import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "../../..");

describe("Phase 6: Static security headers, CSP sha256 hash & dev-only spike gate", () => {
  it("vercel.json CSP script-src uses exact SHA-256 hash of frontend/index.html pre-paint script (no unsafe-inline)", () => {
    const html = fs.readFileSync(path.join(ROOT, "frontend/index.html"), "utf8");
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const expectedHash = `sha256-${crypto.createHash("sha256").update(match[1], "utf8").digest("base64")}`;

    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const headers = vercel.headers[0].headers;
    const csp = headers.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(csp).toBeTruthy();
    expect(csp).toContain(`'${expectedHash}'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
    expect(headers.find((h) => h.key === "X-Content-Type-Options")?.value).toBe("nosniff");
  });

  it("router.jsx gates /spike/excalidraw behind import.meta.env.DEV", () => {
    const routerSrc = fs.readFileSync(path.join(ROOT, "frontend/src/app/router.jsx"), "utf8");
    expect(routerSrc).toContain("import.meta.env.DEV");
    expect(routerSrc).toContain("/spike/excalidraw");
  });
});
