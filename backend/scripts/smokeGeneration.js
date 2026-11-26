/**
 * Live smoke test of the real generation pipeline: real Gemini planner + real
 * Excalidraw CLI (Mermaid) + the production generation service, queue,
 * pipeline and scene composer. Only the job store is in-memory, so this runs
 * without the generation_jobs migration and writes nothing to Supabase.
 *
 *   npm run smoke:generation            (uses GEMINI_API_KEY from env files)
 *
 * Makes ONE paid model call. Prints stages, timings and counts only: never the
 * API key, and the prompt is a fixed public example.
 */
import { loadEnvFiles } from "../src/config/env.js";
import { loadWorkerEnv, validateExcalidrawScene } from "@visualify/worker";
import { createPipelineDeps } from "../src/generation/index.js";
import { createGenerationService, toJobDto } from "../src/generation/generationService.js";
import { JobEventBus } from "../src/generation/eventBus.js";
import { InProcessQueue } from "../src/generation/inProcessQueue.js";
import { InMemoryJobStore } from "../tests/helpers/fakeGeneration.js";

loadEnvFiles();
loadWorkerEnv();

const key = process.env.GEMINI_API_KEY ?? "";
if (!key || /YOUR_/i.test(key)) {
  console.log("NOT RUN: GEMINI_API_KEY is not configured (backend/.env.local or backend/worker/.env.local).");
  process.exit(0);
}

const config = {
  generation: {
    enabled: true,
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    maxConcurrency: 1,
    plannerTimeoutMs: 120_000,
    jobTimeoutMs: 300_000,
    browserPath: process.env.EXCALIDRAW_BROWSER_PATH?.trim() || undefined,
    cliTimeoutMs: Number(process.env.CLI_RENDER_TIMEOUT_MS) || 30_000,
  },
};

const store = new InMemoryJobStore();
const bus = new JobEventBus();
const queue = new InProcessQueue({ concurrency: 1 });
const service = createGenerationService({ config, store, queue, bus, pipelineDeps: createPipelineDeps(config) });

const prompt = process.argv[2] ?? "Explain how the TCP three-way handshake establishes a connection, and compare TCP with UDP.";
const t0 = Date.now();
const job = await service.createJob({
  ownerId: "00000000-0000-4000-8000-000000000000",
  prompt,
  settings: { subject: "Computer networks", audienceLevel: "undergraduate", detail: "standard", visualStyle: "hand_drawn_clean", preferredOutput: "auto" },
});
bus.subscribe(job.id, (e) => {
  const t = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
  if (e.type !== "progress") console.log(`${t}s  ${e.type.padEnd(9)} ${JSON.stringify(e.data)}`);
});
await service.onIdle();

const row = await store.getJob({ ownerId: job.owner_id, jobId: job.id });
const dto = toJobDto(row);
console.log("\nstatus:", dto.status, dto.safeError ? JSON.stringify(dto.safeError) : "");
if (dto.status === "completed") {
  const v = validateExcalidrawScene(dto.sceneJson);
  console.log("model:", row.model_id, "| prompt version:", row.prompt_version);
  console.log("plan:", JSON.stringify({ title: dto.learningPlan.title, sections: dto.learningPlan.sections.map((s) => `${s.id}:${s.visualType}`) }));
  console.log("scene elements:", dto.sceneJson.elements.length, "| valid:", v.valid, "| warnings:", JSON.stringify(dto.warnings));
  console.log("usage:", JSON.stringify(row.usage));
}
process.exit(dto.status === "completed" ? 0 : 1);
