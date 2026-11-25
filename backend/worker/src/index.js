/**
 * Public programmatic API of the generation worker. The Express API's
 * in-process job runner imports only from here, so the boundary stays the
 * same when generation later moves to a separate BullMQ worker process.
 */
export {
  generateLearningPlan,
  GeminiPlannerError,
  PROMPT_VERSION,
  wrapUntrustedInput,
  buildPlannerContents,
} from "./services/geminiPlanner.js";
export { LearningPlanSchema, SUPPORTED_VISUAL_TYPES } from "./schemas/learningPlan.js";
export { validateExcalidrawScene } from "./schemas/excalidrawScene.js";
export { compileDiagramSpecToScene, ADAPTER_ROUTING_TABLE } from "./adapters/sceneRouter.js";
export { composeLessonScene, namespaceElements, sectionElementPrefix, SECTION_ID_SEPARATOR } from "./adapters/sceneComposer.js";
export { CliRendererError } from "./renderer/cliRenderer.js";
export { loadWorkerEnv, getGeminiConfig, resolveBrowserPath, getCliRenderTimeoutMs } from "./config/env.js";
