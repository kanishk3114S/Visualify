/**
 * LIVE end-to-end check of the real API against the configured (dev) Supabase
 * project and real Gemini:
 *   1. plants an orphaned "active" job, boots server.js, and verifies boot
 *      recovery marks it INTERRUPTED without errors;
 *   2. signs in a throwaway user and runs a real generation over HTTP
 *      (POST -> SSE -> GET), checking the 1-active-job rule, cross-user 404,
 *      and cancellation;
 *   3. scans the server log for secrets / prompt text, then deletes the
 *      throwaway users (jobs cascade).
 *
 *   npm run smoke:live-api
 *
 * Refuses to run with NODE_ENV=production. Makes ONE full model call (plus one
 * that is cancelled). Prints statuses and counts only - never keys or tokens.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFiles } from "../src/config/env.js";
import { loadWorkerEnv, validateExcalidrawScene } from "@visualify/worker";

loadEnvFiles();
loadWorkerEnv();
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, NODE_ENV } = process.env;
const missing = Object.entries({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY })
  .filter(([, v]) => !v || /YOUR_|your[-_]/.test(v))
  .map(([k]) => k);
if (missing.length) {
  console.log(`NOT RUN (BLOCKED on ${missing.join(", ")})`);
  process.exit(0);
}
if (NODE_ENV === "production") {
  console.log("NOT RUN (refusing to run against NODE_ENV=production)");
  process.exit(0);
}

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const PROMPT = "Explain how DNS resolves a domain name to an IP address, step by step.";
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, opts);
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function makeUser(label) {
  const email = `smoke-${label}-${randomUUID()}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, opts);
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, token: s.session.access_token };
}

const api = (token, p, init = {}) =>
  fetch(BASE + p, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }).then(
    async (r) => ({ status: r.status, body: await r.json().catch(() => null) })
  );

async function readSse(token, jobId, timeoutMs = 240_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(`${BASE}/generations/${jobId}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal });
  const events = [];
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const type = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (type && data) events.push({ type, data: JSON.parse(data), t: Date.now() });
      }
      if (events.some((e) => ["completed", "failed", "cancelled"].includes(e.type))) break;
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  return { headers: res.headers, events };
}

let server;
let A;
let B;
const logPath = path.join(os.tmpdir(), `visualify-live-api-${process.pid}.log`);
try {
  A = await makeUser("a");
  B = await makeUser("b");

  // 1. Orphan left "active" by a dead process.
  const { data: orphan, error: oErr } = await admin
    .from("generation_jobs")
    .insert({ owner_id: A.id, input_text: "orphan from a crashed process" })
    .select("id")
    .single();
  if (oErr) throw oErr;
  await admin.from("generation_jobs").update({ status: "planning", stage: "planning", progress: 30 }).eq("id", orphan.id);

  const log = fs.openSync(logPath, "w");
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, PORT: String(PORT), LOG_LEVEL: "info", NODE_ENV: "development" },
    stdio: ["ignore", log, log],
  });
  for (let i = 0; i < 40; i += 1) {
    const ok = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1500)); // let recovery finish
  const { data: recovered } = await admin.from("generation_jobs").select("status, error_code, finished_at").eq("id", orphan.id).single();
  check("boot recovery marked the orphaned active job INTERRUPTED", recovered.status === "failed" && recovered.error_code === "INTERRUPTED" && !!recovered.finished_at, `${recovered.status}/${recovered.error_code}`);

  // 2. Real generation over HTTP.
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  check("GET /health is ok with supabase reachable", health.success && health.data.checks.supabase === "ok");

  const t0 = Date.now();
  const created = await api(A.token, "/generations", {
    method: "POST",
    body: JSON.stringify({ inputType: "prompt", prompt: PROMPT, settings: { subject: "Computer networks", detail: "standard" } }),
  });
  check("POST /generations returns 202 queued", created.status === 202 && created.body.data.status === "queued", `HTTP ${created.status}`);
  const jobId = created.body?.data?.jobId;

  const dup = await api(A.token, "/generations", { method: "POST", body: JSON.stringify({ inputType: "prompt", prompt: "second" }) });
  check("second concurrent POST returns 409 ACTIVE_JOB_EXISTS", dup.status === 409 && dup.body.error.code === "ACTIVE_JOB_EXISTS" && dup.body.error.details.activeJobId === jobId);

  const foreign = await api(B.token, `/generations/${jobId}`);
  check("another user gets 404 for the job", foreign.status === 404);

  const stream = await readSse(A.token, jobId);
  const types = stream.events.map((e) => e.type);
  const progress = stream.events.map((e) => e.data.progress).filter((p) => typeof p === "number");
  check("SSE: text/event-stream with snapshot ... completed", stream.headers.get("content-type")?.startsWith("text/event-stream") && types[0] === "snapshot" && types.at(-1) === "completed", types.filter((t) => t !== "progress").join(">"));
  check("SSE: progress is monotonic", progress.every((p, i) => i === 0 || p >= progress[i - 1]), `${progress[0]}..${progress.at(-1)}`);

  const got = await api(A.token, `/generations/${jobId}`);
  const job = got.body?.data?.job;
  const valid = job?.sceneJson ? validateExcalidrawScene(job.sceneJson).valid : false;
  check("GET returns completed job with plan + valid scene", got.status === 200 && job.status === "completed" && !!job.learningPlan && valid, `${((Date.now() - t0) / 1000).toFixed(1)}s, ${job?.sceneJson?.elements?.length ?? 0} elements, sections: ${job?.learningPlan?.sections.map((s) => s.visualType).join("+")}`);
  check("response exposes no owner id or usage internals", job && !("owner_id" in job) && !("usage" in job) && !("ownerId" in job));

  const { data: row } = await admin.from("generation_jobs").select("owner_id, status, model_id, prompt_version, usage").eq("id", jobId).single();
  check("DB row: owner from token, model + prompt version recorded", row.owner_id === A.id && row.status === "completed" && !!row.model_id && !!row.prompt_version, `${row.model_id}, ${row.usage?.totalTokens} tokens`);

  // Cancellation of a running job.
  const c2 = await api(A.token, "/generations", { method: "POST", body: JSON.stringify({ inputType: "prompt", prompt: "Explain photosynthesis." }) });
  await new Promise((r) => setTimeout(r, 1500));
  const cancel = await api(A.token, `/generations/${c2.body.data.jobId}/cancel`, { method: "POST" });
  let final;
  for (let i = 0; i < 40; i += 1) {
    final = (await api(A.token, `/generations/${c2.body.data.jobId}`)).body.data.job;
    if (["cancelled", "failed", "completed"].includes(final.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  check("cancel stops a running job with no partial result", [200, 202].includes(cancel.status) && final.status === "cancelled" && final.learningPlan === null && final.sceneJson === null, `HTTP ${cancel.status} -> ${final.status}`);
} catch (err) {
  check("script completed without unexpected errors", false, err?.message?.slice(0, 120));
} finally {
  if (server) {
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
  const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const secrets = [ref, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, A?.token, B?.token].filter(Boolean);
  check("server log: no recovery error", !/recovery failed|Could not find the table/.test(logText));
  check("server log: no secrets, tokens or prompt text", !secrets.some((s) => logText.includes(s)) && !logText.includes(PROMPT) && !logText.includes("photosynthesis"));
  fs.rmSync(logPath, { force: true });
  for (const u of [A, B].filter(Boolean)) await admin.auth.admin.deleteUser(u.id);
  const { count } = await admin.from("generation_jobs").select("id", { count: "exact", head: true }).in("owner_id", [A?.id, B?.id].filter(Boolean));
  check("cleanup: throwaway users and their jobs deleted", count === 0);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} live checks passed`);
  process.exit(failed ? 1 : 0);
}
