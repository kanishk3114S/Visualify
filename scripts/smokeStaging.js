/**
 * Staging End-to-End Smoke Verification (PRD §16.2 / §18.3)
 *
 * Required env vars (never printed to stdout/stderr):
 *   STAGING_API_URL
 *   STAGING_FRONTEND_URL
 *   STAGING_TEST_EMAIL
 *   STAGING_TEST_PASSWORD
 *
 * Usage: npm run smoke:staging
 */
import assert from "node:assert/strict";

const REQUIRED = ["STAGING_API_URL", "STAGING_FRONTEND_URL", "STAGING_TEST_EMAIL", "STAGING_TEST_PASSWORD"];

function requireEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k] || /YOUR_|your[-_]/i.test(process.env[k]));
  if (missing.length > 0) {
    console.error(`NOT RUN: missing staging environment variables (${missing.join(", ")})`);
    process.exit(1);
  }
  return {
    apiUrl: process.env.STAGING_API_URL.replace(/\/+$/, ""),
    frontendUrl: process.env.STAGING_FRONTEND_URL.replace(/\/+$/, ""),
    email: process.env.STAGING_TEST_EMAIL,
    password: process.env.STAGING_TEST_PASSWORD,
  };
}

async function checkStep(name, fn) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? ` (${detail})` : ""}`);
    return detail;
  } catch (err) {
    console.error(`FAIL  ${name}: ${err?.message ?? err}`);
    throw err;
  }
}

function assertSecurityHeaders(headers, { expectCsp = false, label }) {
  for (const name of ["strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy"]) {
    assert.ok(headers.get(name), `${label} missing header ${name}`);
  }
  if (expectCsp) {
    assert.ok(headers.get("content-security-policy"), `${label} missing content-security-policy`);
  }
}

async function main() {
  const { apiUrl, frontendUrl, email, password } = requireEnv();

  await checkStep("API /healthz", async () => {
    const res = await fetch(`${apiUrl}/healthz`);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    assertSecurityHeaders(res.headers, { expectCsp: true, label: "API" });
    return `reqId=${res.headers.get("x-request-id") ?? "n/a"}`;
  });

  await checkStep("API /readyz", async () => {
    const res = await fetch(`${apiUrl}/readyz`);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert.equal(body?.data?.status, "ok");
    return `reqId=${res.headers.get("x-request-id") ?? "n/a"}`;
  });

  await checkStep("Frontend origin + CSP & security headers", async () => {
    const res = await fetch(frontendUrl);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    assertSecurityHeaders(res.headers, { expectCsp: true, label: "Frontend" });
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.ok(!/localhost|127\.0\.0\.1/i.test(csp), "Frontend production CSP must not include localhost");
    const apiOrigin = new URL(apiUrl).origin;
    assert.ok(csp.includes(apiOrigin), `Frontend CSP connect-src must permit ${apiOrigin}`);
    return `status=${res.status}, cspAllows=${apiOrigin}`;
  });

  await checkStep("CORS allows frontend origin preflight & GET", async () => {
    const res = await fetch(`${apiUrl}/api/v1/health`, {
      headers: { Origin: frontendUrl },
    });
    assert.equal(res.status, 200, `expected 200 for allowed frontend origin, got ${res.status}`);
    assert.equal(res.headers.get("access-control-allow-origin"), frontendUrl);
    return `reqId=${res.headers.get("x-request-id") ?? "n/a"}`;
  });

  await checkStep("CORS rejects foreign origin", async () => {
    const res = await fetch(`${apiUrl}/api/v1/health`, {
      headers: { Origin: "https://untrusted-origin.invalid" },
    });
    assert.equal(res.status, 403, `expected 403 for foreign origin, got ${res.status}`);
    return `reqId=${res.headers.get("x-request-id") ?? "n/a"}`;
  });

  // Discover Supabase URL + publishable key safely from staging runtime config or env override
  const supabaseUrl = (process.env.STAGING_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const supabaseAnonKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
  assert.ok(supabaseUrl && supabaseAnonKey, "Set STAGING_SUPABASE_URL and STAGING_SUPABASE_PUBLISHABLE_KEY for login step");

  const token = await checkStep("Supabase email/password sign-in", async () => {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200, `auth login failed with status ${res.status}`);
    const data = await res.json();
    assert.ok(data?.access_token, "missing access_token");
    return "authenticated";
  });

  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: frontendUrl };

  const jobId = await checkStep("Create generation job", async () => {
    const res = await fetch(`${apiUrl}/api/v1/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ inputType: "prompt", prompt: "Explain TCP three-way handshake cleanly." }),
    });
    assert.equal(res.status, 202, `expected 202, got ${res.status}`);
    const body = await res.json();
    assert.ok(body?.data?.jobId);
    return `jobId=${body.data.jobId}, reqId=${res.headers.get("x-request-id") ?? "n/a"}`;
  }).then((detail) => detail.match(/jobId=([^,]+)/)[1]);

  await checkStep("Poll generation to completed", async () => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const res = await fetch(`${apiUrl}/api/v1/generations/${jobId}`, { headers: authHeaders });
      assert.equal(res.status, 200);
      const body = await res.json();
      const status = body?.data?.job?.status;
      if (status === "completed") return `status=completed, reqId=${res.headers.get("x-request-id") ?? "n/a"}`;
      if (status === "failed" || status === "cancelled") {
        throw new Error(`job ended with ${status}: ${body?.data?.job?.safeError?.code ?? "unknown"}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("timed out polling generation");
  });

  const noteId = await checkStep("Save note to library", async () => {
    const res = await fetch(`${apiUrl}/api/v1/notes`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ jobId, title: "Staging Smoke Verification Note" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body?.data?.note?.id);
    return `noteId=${body.data.note.id}, reqId=${res.headers.get("x-request-id") ?? "n/a"}`;
  }).then((detail) => detail.match(/noteId=([^,]+)/)[1]);

  try {
    await checkStep("Export PNG", async () => {
      const res = await fetch(`${apiUrl}/api/v1/notes/${noteId}/exports`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ format: "png", scope: "full", theme: "light", transparent: false }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body?.data?.export?.status, "completed");
      return `exportId=${body.data.export.id}, reqId=${res.headers.get("x-request-id") ?? "n/a"}`;
    });
  } finally {
    await checkStep("Delete staging smoke note", async () => {
      const res = await fetch(`${apiUrl}/api/v1/notes/${noteId}`, { method: "DELETE", headers: authHeaders });
      assert.equal(res.status, 200);
      return `reqId=${res.headers.get("x-request-id") ?? "n/a"}`;
    });
  }
}

main().catch(() => process.exit(1));
