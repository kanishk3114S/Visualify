import { compileDiagramSpecToScene, generateLearningPlan } from "@visualify/worker";
import { JobEventBus } from "./eventBus.js";
import { InProcessQueue } from "./inProcessQueue.js";
import { SupabaseJobStore } from "./jobStore.js";
import { createGenerationService } from "./generationService.js";

/** Real provider/CLI access, configured from server-side config only. */
export function createPipelineDeps(config) {
  const g = config.generation;
  return {
    planner: (args) => generateLearningPlan({ ...args, model: g.model, timeoutMs: g.plannerTimeoutMs }),
    compileSection: (spec, { signal }) =>
      compileDiagramSpecToScene(spec, { signal, browserPath: g.browserPath, timeoutMs: g.cliTimeoutMs }),
  };
}

/**
 * Builds the generation stack. With no service-role key the store can still
 * serve owner reads (through the user's RLS client) but generation is disabled.
 */
export function createGenerationStack({ config, gateway, logger, pipelineDeps = createPipelineDeps(config) }) {
  const store = new SupabaseJobStore(gateway.createAdminClient());
  const bus = new JobEventBus();
  const queue = new InProcessQueue({ concurrency: config.generation.maxConcurrency, logger });
  const service = createGenerationService({ config, store, queue, bus, pipelineDeps, logger });
  return { service, store, bus, queue };
}
