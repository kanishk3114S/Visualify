import express, { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  askNoteSchema,
  createFolderSchema,
  createNoteSchema,
  draftSchema,
  duplicateNoteSchema,
  explainSelectionSchema,
  exportSchema,
  flashcardsCreateSchema,
  flashcardUpdateSchema,
  quizCreateSchema,
  quizUpdateSchema,
  regenerateSectionSchema,
  snapshotSchema,
  updateFolderSchema,
  updateNoteSchema,
} from "../schemas/notes.schema.js";
import { createNotesController } from "../controllers/notes.controller.js";

const smallJson = express.json({ limit: "16kb", strict: true });
// Scenes from the editor can be large; still bounded.
const sceneJson = express.json({ limit: "5mb", strict: true });

/** /api/v1/folders */
export function createFoldersRouter({ gateway, limiters, notes }) {
  const router = Router();
  const c = createNotesController(notes);
  router.use(requireAuth(gateway)); // before body parsing and every handler
  router.get("/", c.listFolders);
  router.post("/", limiters.notesWrite, smallJson, validateBody(createFolderSchema), c.createFolder);
  router.patch("/:folderId", limiters.notesWrite, smallJson, validateBody(updateFolderSchema), c.updateFolder);
  router.delete("/:folderId", limiters.notesWrite, c.deleteFolder);
  return router;
}

/** /api/v1/notes */
export function createNotesRouter({ gateway, limiters, notes }) {
  const router = Router();
  const c = createNotesController(notes);
  router.use(requireAuth(gateway));
  router.get("/", c.listNotes);
  router.post("/", limiters.notesWrite, sceneJson, validateBody(createNoteSchema), c.createNote);
  router.get("/:noteId", c.getNote);
  router.patch("/:noteId", limiters.notesWrite, smallJson, validateBody(updateNoteSchema), c.updateNote);
  router.delete("/:noteId", limiters.notesWrite, c.deleteNote);
  router.post("/:noteId/duplicate", limiters.notesWrite, smallJson, validateBody(duplicateNoteSchema), c.duplicateNote);

  router.get("/:noteId/versions", c.listVersions);
  router.get("/:noteId/versions/:versionId", c.getVersion);
  router.post("/:noteId/versions", limiters.notesWrite, sceneJson, validateBody(snapshotSchema), c.snapshot);
  router.post("/:noteId/restore/:versionId", limiters.notesWrite, c.restore);
  // Autosave: frequent by design, so it has its own (higher) limit.
  router.put("/:noteId/draft", limiters.autosave, sceneJson, validateBody(draftSchema), c.saveDraft);

  router.post("/:noteId/exports", limiters.exports, smallJson, validateBody(exportSchema), c.createExport);

  // Phase 5: study companion & single-section regeneration
  router.get("/:noteId/study", c.getStudyState);
  router.post("/:noteId/explain", limiters.aiCompanion, express.json({ limit: "256kb", strict: true }), validateBody(explainSelectionSchema), c.explainSelection);
  router.post("/:noteId/quiz", limiters.aiCompanion, smallJson, validateBody(quizCreateSchema), c.createQuiz);
  router.patch("/:noteId/quiz/:quizId", limiters.notesWrite, smallJson, validateBody(quizUpdateSchema), c.submitQuizAnswers);
  router.post("/:noteId/flashcards", limiters.aiCompanion, smallJson, validateBody(flashcardsCreateSchema), c.createFlashcards);
  router.patch("/:noteId/flashcards/:cardId", limiters.notesWrite, smallJson, validateBody(flashcardUpdateSchema), c.updateFlashcard);
  router.post("/:noteId/revision", limiters.aiCompanion, c.createRevisionGuide);
  router.post("/:noteId/ask", limiters.aiCompanion, smallJson, validateBody(askNoteSchema), c.askNote);
  router.post("/:noteId/sections/:sectionId/regenerate", limiters.aiCompanion, smallJson, validateBody(regenerateSectionSchema), c.regenerateSection);

  return router;
}

/** /api/v1/exports */
export function createExportsRouter({ gateway, notes }) {
  const router = Router();
  const c = createNotesController(notes);
  router.use(requireAuth(gateway));
  router.get("/:exportId", c.getExport);
  return router;
}
