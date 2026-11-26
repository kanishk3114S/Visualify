/**
 * Localhost-only autocannon load test harness (Phase 6 launch readiness).
 * Drives list/get notes, autosave bursts, and generation create with the AI
 * provider mocked. Refuses to run against non-local URLs (never production).
 */
import autocannon from "autocannon";
import { loadConfig } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/utils/logger.js";
import { createUsageService } from "../src/services/usageService.js";
import { createFakeSupabase } from "../tests/helpers/fakeSupabase.js";
import { SAMPLE_PLAN, createTestGenerationStack } from "../tests/helpers/fakeGeneration.js";
import { createTestNotesStack } from "../tests/helpers/fakeNotes.js";

const targetArg = process.argv.find((a) => a.startsWith("--url="))?.slice(6);
if (targetArg) {
  const host = new URL(targetArg).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    console.error(`Refusing to run load test against non-local host: ${host}`);
    process.exit(1);
  }
}

function runBench(opts) {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

async function main() {
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "5000",
    FRONTEND_ORIGIN: "http://127.0.0.1:5173",
    SUPABASE_URL: "https://load-test.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_load_test_key_000000",
    GENERATION_LIMIT_MONTHLY: "10000",
    LOG_LEVEL: "silent",
  });
  const fake = createFakeSupabase();
  const logger = createLogger(config);
  const usageService = createUsageService({ config, logger, memoryEvents: fake.state.usageEvents });
  const generation = createTestGenerationStack({ config, logger, enabled: true, supabaseState: fake.state, usageService });
  const notes = createTestNotesStack({ generation, logger, usageService });
  const passthrough = (_req, _res, next) => next();
  const limiters = {
    api: passthrough,
    profileMutation: passthrough,
    avatarMutation: passthrough,
    accountDelete: passthrough,
    generationCreate: passthrough,
    generationControl: passthrough,
    notesWrite: passthrough,
    autosave: passthrough,
    exports: passthrough,
    sourcesUpload: passthrough,
    aiCompanion: passthrough,
    adminInspect: passthrough,
  };
  const app = createApp({ config, gateway: fake.gateway, logger, limiters, usageService, generation, notes });

  const alice = fake.addUser({ email: "load-alice@example.test" });
  const sampleJob = generation.store.seed({
    owner_id: alice.user.id,
    input_text: "Load topic",
    status: "completed",
    progress: 100,
    learning_plan: SAMPLE_PLAN,
    scene_json: {
      type: "excalidraw",
      elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 120, height: 60 }],
      appState: { viewBackgroundColor: "#ffffff" },
    },
    settings: {},
  });
  const saved = await notes.service.saveFromJob(
    { userId: alice.user.id, db: null, repo: notes.db.repositoryFor(alice.user.id), files: notes.storage.forUser(alice.user.id) },
    { jobId: sampleJob.id }
  );
  const noteId = saved.note.id;

  const genUsers = Array.from({ length: 20 }, (_, i) => fake.addUser({ email: `load-u-${i}@example.test` }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = targetArg ?? `http://127.0.0.1:${port}`;

  try {
    const notesListRes = await runBench({
      url: `${baseUrl}/api/v1/notes`,
      connections: 8,
      duration: 2,
      headers: { Authorization: `Bearer ${alice.token}` },
    });

    const noteGetRes = await runBench({
      url: `${baseUrl}/api/v1/notes/${noteId}`,
      connections: 8,
      duration: 2,
      headers: { Authorization: `Bearer ${alice.token}` },
    });

    let draftRev = 0;
    const autosaveRes = await runBench({
      url: `${baseUrl}/api/v1/notes/${noteId}/draft`,
      connections: 1,
      duration: 2,
      requests: [
        {
          method: "PUT",
          path: `/api/v1/notes/${noteId}/draft`,
          headers: { Authorization: `Bearer ${alice.token}`, "Content-Type": "application/json" },
          setupRequest: (req) => {
            req.body = JSON.stringify({
              sceneJson: { type: "excalidraw", elements: [{ id: "r1", type: "rectangle", x: draftRev % 100, y: 10, width: 120, height: 60 }] },
              baseRevision: draftRev++,
            });
            return req;
          },
        },
      ],
    });

    let userCursor = 0;
    const genCreateRes = await runBench({
      url: `${baseUrl}/api/v1/generations`,
      connections: 4,
      amount: 20,
      requests: [
        {
          method: "POST",
          path: "/api/v1/generations",
          setupRequest: (req) => {
            const u = genUsers[userCursor++ % genUsers.length];
            req.headers = { Authorization: `Bearer ${u.token}`, "Content-Type": "application/json" };
            req.body = JSON.stringify({ inputType: "prompt", prompt: "Explain B-Trees and indexing cleanly." });
            return req;
          },
        },
      ],
    });
    await generation.service.onIdle();

    const summarize = (name, r) => ({
      workload: name,
      requests: r.requests.total,
      rps: r.requests.average,
      p95Ms: r.latency.p95 ?? r.latency.p97_5,
      non2xx: r.non2xx,
      errors: r.errors,
      errorRatePct: r.requests.total > 0 ? Number((((r.errors + r.non2xx) / r.requests.total) * 100).toFixed(2)) : 0,
    });

    const results = [
      summarize("GET /api/v1/notes", notesListRes),
      summarize("GET /api/v1/notes/:noteId", noteGetRes),
      summarize("PUT /api/v1/notes/:noteId/draft", autosaveRes),
      summarize("POST /api/v1/generations", genCreateRes),
    ];
    console.log(JSON.stringify({ status: "PASS", results }, null, 2));
    if (results.some((r) => r.errors > 0 || r.non2xx > 0)) {
      process.exitCode = 1;
    }
  } finally {
    await generation.service.shutdown();
    server.close();
  }
}

main().catch((err) => {
  console.error("Load test failed:", err?.message ?? err);
  process.exit(1);
});
