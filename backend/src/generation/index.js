import {
  compileDiagramSpecToScene,
  extractSourceContent,
  generateLearningPlan,
} from "@visualify/worker";
import { JobEventBus } from "./eventBus.js";
import { InProcessQueue } from "./inProcessQueue.js";
import { SupabaseJobStore } from "./jobStore.js";
import { toSafeError } from "./jobStates.js";
import { createGenerationService } from "./generationService.js";

/** Real provider/CLI/extraction access, configured from server-side config only. */
export function createPipelineDeps(config, store = null) {
  const g = config.generation;
  return {
    planner: (args) => generateLearningPlan({ ...args, model: g.model, timeoutMs: g.plannerTimeoutMs }),
    compileSection: (spec, { signal, visualStyle }) =>
      compileDiagramSpecToScene(spec, { signal, visualStyle, browserPath: g.browserPath, timeoutMs: g.cliTimeoutMs }),
    extractSource: async ({ job, signal }) => {
      if (!store) throw Object.assign(new Error("Job store required for source extraction"), { code: "EXTRACTION_FAILED" });
      const sf = await store.getSourceFileForRunner({ sourceFileId: job.source_file_id, ownerId: job.owner_id });
      if (!sf) throw Object.assign(new Error("Source file missing"), { code: "SOURCE_NOT_FOUND" });
      await store.updateSourceExtraction(sf.id, job.owner_id, { extraction_status: "extracting", error_code: null, safe_error_message: null });
      try {
        const buffer = await store.downloadSourceObject(sf.object_path);
        const extracted = await extractSourceContent({
          buffer,
          mimeType: sf.mime_type,
          pageRange: job.page_range ?? null,
          maxSelectedPages: config.sourceMaxPdfPages ?? 100,
          signal,
        });
        await store.updateSourceExtraction(sf.id, job.owner_id, {
          extraction_status: "extracted",
          extracted_metadata: extracted.metadata ?? {},
          error_code: null,
          safe_error_message: null,
        });
        return extracted;
      } catch (err) {
        if (err?.code !== "CANCELLED") {
          const safe = toSafeError(err);
          await store
            .updateSourceExtraction(sf.id, job.owner_id, {
              extraction_status: "failed",
              error_code: safe.code,
              safe_error_message: safe.message,
            })
            .catch(() => {});
        }
        throw err;
      }
    },
  };
}

/**
 * Builds the generation stack. With no service-role key the store can still
 * serve owner reads (through the user's RLS client) but generation is disabled.
 */
export function createGenerationStack({ config, gateway, logger, pipelineDeps }) {
  const store = new SupabaseJobStore(gateway.createAdminClient());
  const bus = new JobEventBus();
  const queue = new InProcessQueue({ concurrency: config.generation.maxConcurrency, logger });
  const deps = pipelineDeps ?? createPipelineDeps(config, store);
  const service = createGenerationService({ config, store, queue, bus, pipelineDeps: deps, logger });
  return { service, store, bus, queue };
}
