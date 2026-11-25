/**
 * Public programmatic API of the generation worker. The Express API's
 * in-process job runner imports only from here, so the boundary stays the
 * same when generation later moves to a separate BullMQ worker process.
 */
export {
  generateLearningPlan,
  generateStructuredJson,
  GeminiPlannerError,
  PROMPT_VERSION,
  wrapUntrustedInput,
  wrapUntrustedDocument,
  buildPlannerContents,
} from "./services/geminiPlanner.js";
export {
  COMPANION_PROMPT_VERSION,
  explainSelection,
  generateQuiz,
  generateFlashcards,
  generateRevisionGuide,
  askNote,
  regenerateSectionPlan,
} from "./services/studyCompanionService.js";
export {
  ExplainSelectionOutputSchema,
  QuizQuestionSchema,
  QuizOutputSchema,
  FlashcardItemSchema,
  FlashcardsOutputSchema,
  RevisionGuideOutputSchema,
  AskNoteCitationSchema,
  AskNoteOutputSchema,
  SectionRegenerateOutputSchema,
  summarizeSelectedElements,
  buildCompactNoteContext,
} from "./schemas/studyCompanion.js";
export {
  SOURCE_MIME_TYPES,
  DEFAULT_MAX_SOURCE_BYTES,
  DEFAULT_MAX_PDF_PAGES_STORAGE,
  DEFAULT_MAX_PDF_PAGES_PER_JOB,
  DEFAULT_MAX_IMAGE_PIXELS,
  DEFAULT_MAX_IMAGE_EDGE,
  SourceExtractionError,
  parsePageRange,
  inspectSourceBuffer,
  extractSourceContent,
} from "./services/sourceExtractor.js";
export { LearningPlanSchema, LearningPlanSectionSchema, SUPPORTED_VISUAL_TYPES } from "./schemas/learningPlan.js";
export { validateExcalidrawScene, validateEditableScene, sanitizeEditableScene } from "./schemas/excalidrawScene.js";
export { compileDiagramSpecToScene, ADAPTER_ROUTING_TABLE } from "./adapters/sceneRouter.js";
export {
  composeLessonScene,
  extractSceneFrames,
  filterSceneToFrame,
  replaceSectionInScene,
  namespaceElements,
  sectionElementPrefix,
  SECTION_ID_SEPARATOR,
} from "./adapters/sceneComposer.js";
export { VISUAL_STYLES, SEMANTIC_PALETTE, resolveDiagramStyle, styleConvertedScene } from "./adapters/diagramTheme.js";
export { CliRendererError, renderScene, imageDimensions } from "./renderer/cliRenderer.js";
export { loadWorkerEnv, getGeminiConfig, resolveBrowserPath, getCliRenderTimeoutMs } from "./config/env.js";
