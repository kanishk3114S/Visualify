import { describe, it, expect, vi } from "vitest";
import { Writable } from "node:stream";
import { loadConfig } from "../src/config/env.js";
import { createLogger } from "../src/utils/logger.js";
import { createGenerationService } from "../src/generation/generationService.js";
import { createCliRenderer } from "../src/notes/renderer.js";
import { runGenerationPipeline } from "../src/generation/pipeline.js";
import { JobEventBus } from "../src/generation/eventBus.js";
import { InProcessQueue } from "../src/generation/inProcessQueue.js";
import { InMemoryJobStore, SAMPLE_PLAN } from "./helpers/fakeGeneration.js";
import { BASE_ENV } from "./helpers/testApp.js";
import {
  createRenderSemaphore,
  generateLearningPlan,
  renderScene,
} from "@visualify/worker";
import fs from "node:fs/promises";
import path from "node:path";

describe("Phase 6.5 §1: Config validation, traceability, semaphore & sibling cancellation", () => {
  it("validates GEMINI_FALLBACK_MODELS and RENDER_CONCURRENCY bounds", () => {
    const cfg = loadConfig({
      ...BASE_ENV,
      GEMINI_MODEL: "gemini-3.5-flash",
      GEMINI_FALLBACK_MODELS: "gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.5-flash-lite",
      RENDER_CONCURRENCY: "4",
    });
    expect(cfg.generation.fallbackModels).toEqual(["gemini-3.5-flash-lite"]);
    expect(cfg.generation.renderConcurrency).toBe(4);

    expect(() =>
      loadConfig({ ...BASE_ENV, GEMINI_FALLBACK_MODELS: "bad-model-name" })
    ).toThrow(/GEMINI_FALLBACK_MODELS/);
    expect(() =>
      loadConfig({ ...BASE_ENV, GEMINI_FALLBACK_MODELS: "gemini-a,gemini-b,gemini-c,gemini-d" })
    ).toThrow(/at most 3/);
    expect(() =>
      loadConfig({ ...BASE_ENV, RENDER_CONCURRENCY: "9" })
    ).toThrow(/RENDER_CONCURRENCY/);
  });

  it("persists actual fallback model_id + attempts + failedOver to job & logs on primary 503 without leaking prompts", async () => {
    const SECRET_PROMPT = "SENSITIVE_LEARNER_PROMPT_NEVER_LOG_THIS";
    const config = loadConfig({
      ...BASE_ENV,
      GEMINI_MODEL: "gemini-3.5-flash",
      GEMINI_FALLBACK_MODELS: "gemini-3.5-flash-lite",
    });
    const logChunks = [];
    const sink = new Writable({ write: (c, _, cb) => { logChunks.push(c.toString()); cb(); } });
    const logger = createLogger({ ...config, logLevel: "info" }, sink);
    const store = new InMemoryJobStore();
    const bus = new JobEventBus();
    const queue = new InProcessQueue({ concurrency: 2, logger });

    const mockClient = {
      models: {
        generateContent: vi
          .fn()
          .mockRejectedValueOnce({ status: 503, message: "high demand" })
          .mockResolvedValueOnce({
            text: JSON.stringify(SAMPLE_PLAN),
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 90, totalTokenCount: 140 },
          }),
      },
    };

    const service = createGenerationService({
      config,
      store,
      queue,
      bus,
      logger,
      pipelineDeps: {
        planner: (args) =>
          generateLearningPlan({
            ...args,
            client: mockClient,
            model: config.generation.model,
            fallbackModels: config.generation.fallbackModels,
            retryBaseDelayMs: 1,
          }),
        compileSection: async () => ({
          strategy: "direct_scene",
          mermaidSource: null,
          scene: { elements: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }] },
        }),
      },
    });

    const job = await service.createJob({
      ownerId: "00000000-0000-4000-8000-000000000001",
      prompt: SECRET_PROMPT,
      settings: {},
    });
    await service.onIdle();

    const stored = [...store.rows.values()].find((r) => r.id === job.id);
    expect(stored.status).toBe("completed");
    expect(stored.model_id).toBe("gemini-3.5-flash-lite");
    expect(stored.usage).toMatchObject({
      model: "gemini-3.5-flash-lite",
      attempts: 2,
      failedOver: true,
    });

    const logText = logChunks.join("");
    expect(logText).toContain("gemini-3.5-flash-lite");
    expect(logText).not.toContain(SECRET_PROMPT);
  });

  it("caps 3 concurrent jobs x 4 sections + 2 concurrent exports at RENDER_CONCURRENCY via instrumented CLI execFn", async () => {
    const sem = createRenderSemaphore(2);
    let currentCli = 0;
    let peakCli = 0;
    let totalCliCalls = 0;

    // Fake execFn simulates asynchronous Chromium subprocess writing an output PNG.
    const fakeExecFn = vi.fn(async (_node, args, opts) => {
      currentCli += 1;
      peakCli = Math.max(peakCli, currentCli);
      totalCliCalls += 1;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 15);
        opts.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        }, { once: true });
      });
      const outIdx = args.indexOf("--out");
      if (outIdx !== -1 && args[outIdx + 1]) {
        const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 100]);
        await fs.writeFile(path.resolve(args[outIdx + 1]), pngMagic);
      }
      currentCli -= 1;
      return { stdout: "", stderr: "" };
    });

    const fourSectionPlan = {
      ...SAMPLE_PLAN,
      sections: [0, 1, 2, 3].map((i) => ({ ...SAMPLE_PLAN.sections[0], id: `sec_${i}`, title: `Section ${i}` })),
    };

    const runOneJob = (idx) =>
      runGenerationPipeline({
        job: { id: `job-${idx}`, owner_id: "u1", input_type: "prompt", input_text: "test", settings: {} },
        signal: new AbortController().signal,
        onStage: async () => {},
        onProgress: () => {},
        deps: {
          renderSemaphore: sem,
          tickMs: 500,
          planner: async () => ({ plan: fourSectionPlan, model: "m", attempts: 1, failedOver: false, latencyMs: 1 }),
          compileSection: async () => {
            await renderScene({
              sceneJson: { elements: [{ id: "x", type: "rectangle", x: 0, y: 0, width: 50, height: 50 }] },
              format: "png",
              execFn: fakeExecFn,
              semaphore: sem,
              cliScriptPath: import.meta.filename,
              browserPath: import.meta.filename,
            });
            return { strategy: "mermaid", mermaidSource: "graph TD; A-->B;", scene: { elements: [{ id: "x", type: "rectangle", x: 0, y: 0, width: 50, height: 50 }] } };
          },
        },
      });

    const renderer = createCliRenderer({ semaphore: sem });
    const runExport = () =>
      renderScene({
        sceneJson: { elements: [{ id: "x", type: "rectangle", x: 0, y: 0, width: 50, height: 50 }] },
        format: "png",
        execFn: fakeExecFn,
        semaphore: sem,
        cliScriptPath: import.meta.filename,
        browserPath: import.meta.filename,
      });

    await Promise.all([runOneJob(1), runOneJob(2), runOneJob(3), runExport(), runExport(), runExport(), runExport()]);

    expect(totalCliCalls).toBe(16); // 3 * 4 sections + 4 direct exports
    expect(peakCli).toBeLessThanOrEqual(2);
    expect(currentCli).toBe(0);
    expect(renderer).toBeDefined();
  });

  it("aborts sibling compile workers on cancel with 0 lingering CLI calls and 0 subsequent starts", async () => {
    const ac = new AbortController();
    const sem = createRenderSemaphore(2);
    let runningCli = 0;
    let startedCli = 0;

    const sixSectionPlan = {
      ...SAMPLE_PLAN,
      sections: [0, 1, 2, 3, 4, 5].map((i) => ({ ...SAMPLE_PLAN.sections[0], id: `s_${i}`, title: `S ${i}` })),
    };

    const jobPromise = runGenerationPipeline({
      job: { id: "job-cancel", owner_id: "u1", input_type: "prompt", input_text: "test", settings: {} },
      signal: ac.signal,
      onStage: async () => {},
      onProgress: () => {},
      deps: {
        renderSemaphore: sem,
        tickMs: 500,
        planner: async () => ({ plan: sixSectionPlan, model: "m", attempts: 1, failedOver: false, latencyMs: 1 }),
        compileSection: async (_spec, { signal }) => {
          startedCli += 1;
          runningCli += 1;
          if (startedCli === 2) {
            setTimeout(() => ac.abort(new Error("user cancelled")), 10);
          }
          await new Promise((resolve, reject) => {
            const t = setTimeout(() => { runningCli -= 1; resolve(); }, 300);
            signal.addEventListener("abort", () => {
              clearTimeout(t);
              runningCli -= 1;
              const err = new Error("CLI aborted");
              err.name = "AbortError";
              reject(err);
            }, { once: true });
          });
          return { strategy: "mermaid", mermaidSource: null, scene: { elements: [] } };
        },
      },
    });

    await expect(jobPromise).rejects.toMatchObject({ code: "CANCELLED" });
    const countAtCancel = startedCli;
    await new Promise((r) => setTimeout(r, 30));
    expect(runningCli).toBe(0);
    expect(startedCli).toBe(countAtCancel); // no further sections started
    expect(countAtCancel).toBeLessThan(6);
  });
});
