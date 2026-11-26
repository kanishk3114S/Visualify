import {
  askNote,
  compileDiagramSpecToScene,
  explainSelection,
  generateFlashcards,
  generateQuiz,
  generateRevisionGuide,
  regenerateSectionPlan,
} from "@visualify/worker";
import { InProcessQueue } from "../generation/inProcessQueue.js";
import { createSupabaseNotesRepository } from "./notesRepository.js";
import { createSupabaseNoteFiles } from "./noteFiles.js";
import { createCliRenderer } from "./renderer.js";
import { createNotesService } from "./notesService.js";

/**
 * Notes stack. Note CRUD, versions, study artifacts & exports run through the
 * caller's RLS client (`req.db`); optional usage metering writes via service_role.
 */
export function createNotesStack({ config, gateway, generation, logger, renderer, companion, compileSection, usageService = null }) {
  const tasks = new InProcessQueue({ concurrency: 1, logger });
  const g = config.generation;

  const defaultCompanion = {
    enabled: Boolean(g.geminiConfigured),
    explainSelection: (args) => explainSelection({ ...args, model: g.model, timeoutMs: g.plannerTimeoutMs }),
    generateQuiz: (args) => generateQuiz({ ...args, model: g.model, timeoutMs: g.plannerTimeoutMs }),
    generateFlashcards: (args) => generateFlashcards({ ...args, model: g.model, timeoutMs: g.plannerTimeoutMs }),
    generateRevisionGuide: (args) => generateRevisionGuide({ ...args, model: g.model, timeoutMs: g.plannerTimeoutMs }),
    askNote: (args) => askNote({ ...args, model: g.model, timeoutMs: g.plannerTimeoutMs }),
    regenerateSectionPlan: (args) => regenerateSectionPlan({ ...args, model: g.model, timeoutMs: g.plannerTimeoutMs }),
  };

  const defaultCompileSection = (spec, { visualStyle, signal } = {}) =>
    compileDiagramSpecToScene(spec, { signal, visualStyle, browserPath: g.browserPath, timeoutMs: g.cliTimeoutMs });

  const service = createNotesService({
    renderer: renderer ?? createCliRenderer({ browserPath: g.browserPath, timeoutMs: g.cliTimeoutMs }),
    jobStore: generation.store,
    tasks,
    companion: companion ?? defaultCompanion,
    compileSection: compileSection ?? defaultCompileSection,
    usageService,
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
