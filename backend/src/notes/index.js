import { Queue as BullQueue } from "bullmq";
import {
  askNote,
  compileDiagramSpecToScene,
  configureRenderConcurrency,
  explainSelection,
  generateFlashcards,
  generateQuiz,
  generateRevisionGuide,
  globalRenderSemaphore,
  regenerateSectionPlan,
} from "@visualify/worker";
import { InProcessQueue } from "../generation/inProcessQueue.js";
import { createSupabaseNotesRepository } from "./notesRepository.js";
import { createSupabaseNoteFiles, NOTE_ASSETS_BUCKET } from "./noteFiles.js";
import { createCliRenderer } from "./renderer.js";
import { createNotesService } from "./notesService.js";

export const PREVIEW_QUEUE_NAME = "visualify-previews";

/** Executes one background note preview render using server-side storage & global CLI semaphore. */
export async function runNotePreviewJob({ adminDb, config, payload, logger }) {
  if (!adminDb || !payload?.noteId || !payload?.versionId || !payload?.userId || !payload?.scene) return;
  const renderer = createCliRenderer({
    browserPath: config?.generation?.browserPath,
    timeoutMs: config?.generation?.cliTimeoutMs,
    semaphore: globalRenderSemaphore,
  });
  try {
    const out = await renderer.render({ scene: payload.scene, format: "png", theme: "light", transparent: false });
    const objectPath = `${payload.userId}/${payload.noteId}/${payload.versionId}/preview.png`;
    await adminDb.storage.from(NOTE_ASSETS_BUCKET).upload(objectPath, out.buffer, { contentType: "image/png", upsert: true });
    await adminDb.from("notes").update({ preview_path: objectPath }).eq("id", payload.noteId).eq("owner_id", payload.userId);
  } catch (err) {
    logger?.warn({ noteId: payload?.noteId, errorCode: err?.code ?? "PREVIEW_FAILED" }, "worker note preview failed");
  }
}

/**
 * Notes stack. Note CRUD, versions, study artifacts & exports run through the
 * caller's RLS client (`req.db`); optional usage metering writes via service_role.
 */
export function createNotesStack({ config, gateway, generation, logger, renderer, companion, compileSection, usageService = null, analyticsService = null, redis = null }) {
  let tasks;
  if (config?.processRole === "api" && redis) {
    const previewQueue = new BullQueue(PREVIEW_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 200 },
    });
    tasks = {
      enqueue(jobId, _fn, payload) {
        if (!payload?.scene) return;
        previewQueue.add("preview", payload, { jobId }).catch((err) => {
          logger?.warn({ errorCode: err?.code ?? "PREVIEW_ENQUEUE_WARN" }, "failed to enqueue note preview");
        });
      },
      onIdle: () => previewQueue.close?.() ?? Promise.resolve(),
    };
  } else {
    tasks = new InProcessQueue({ concurrency: 1, logger });
  }
  const g = config.generation;
  if (g.renderConcurrency) {
    configureRenderConcurrency(g.renderConcurrency);
  }

  const defaultCompanion = {
    enabled: Boolean(g.geminiConfigured),
    explainSelection: (args) => explainSelection({ ...args, model: g.model, fallbackModels: g.fallbackModels, timeoutMs: g.plannerTimeoutMs }),
    generateQuiz: (args) => generateQuiz({ ...args, model: g.model, fallbackModels: g.fallbackModels, timeoutMs: g.plannerTimeoutMs }),
    generateFlashcards: (args) => generateFlashcards({ ...args, model: g.model, fallbackModels: g.fallbackModels, timeoutMs: g.plannerTimeoutMs }),
    generateRevisionGuide: (args) => generateRevisionGuide({ ...args, model: g.model, fallbackModels: g.fallbackModels, timeoutMs: g.plannerTimeoutMs }),
    askNote: (args) => askNote({ ...args, model: g.model, fallbackModels: g.fallbackModels, timeoutMs: g.plannerTimeoutMs }),
    regenerateSectionPlan: (args) => regenerateSectionPlan({ ...args, model: g.model, fallbackModels: g.fallbackModels, timeoutMs: g.plannerTimeoutMs }),
  };

  const defaultCompileSection = (spec, { visualStyle, signal } = {}) =>
    globalRenderSemaphore.run(
      () => compileDiagramSpecToScene(spec, { signal, visualStyle, browserPath: g.browserPath, timeoutMs: g.cliTimeoutMs }),
      { signal }
    );

  const service = createNotesService({
    renderer: renderer ?? createCliRenderer({ browserPath: g.browserPath, timeoutMs: g.cliTimeoutMs, semaphore: globalRenderSemaphore }),
    jobStore: generation.store,
    tasks,
    companion: companion ?? defaultCompanion,
    compileSection: compileSection ?? defaultCompileSection,
    usageService,
    analyticsService,
    logger,
  });
  const contextFor = (req) => ({
    userId: req.user.id,
    db: req.db,
    repo: createSupabaseNotesRepository(req.db, req.user.id),
    files: createSupabaseNoteFiles(req.db.storage),
  });
  return { service, contextFor, tasks };
}
