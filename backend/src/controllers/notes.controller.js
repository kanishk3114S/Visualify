import { sendSuccess } from "../utils/response.js";
import { AppError } from "../utils/errors.js";
import { isUuid } from "../schemas/generation.schema.js";
import { formatIssues } from "../middleware/validate.js";
import { listNotesQuerySchema } from "../schemas/notes.schema.js";

/** Malformed, unknown and other users' ids all produce the same 404. */
function idParam(req, name, what) {
  const value = req.params[name];
  if (!isUuid(value)) throw new AppError(404, "NOT_FOUND", `${what} not found.`);
  return value.toLowerCase();
}

function slugParam(req, name, what) {
  const value = String(req.params[name] ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new AppError(404, "NOT_FOUND", `${what} not found.`);
  return value;
}

export function createNotesController({ service, contextFor }) {
  const ctx = (req) => contextFor(req);
  return {
    // folders
    listFolders: async (req, res) => sendSuccess(res, { items: await service.listFolders(ctx(req)) }),
    createFolder: async (req, res) => sendSuccess(res, { folder: await service.createFolder(ctx(req), req.body) }, 201),
    updateFolder: async (req, res) =>
      sendSuccess(res, { folder: await service.updateFolder(ctx(req), idParam(req, "folderId", "Folder"), req.body) }),
    deleteFolder: async (req, res) => {
      await service.deleteFolder(ctx(req), idParam(req, "folderId", "Folder"));
      return sendSuccess(res, { deleted: true });
    },

    // notes
    listNotes: async (req, res) => {
      const parsed = listNotesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Some filters are invalid.", { details: formatIssues(parsed.error) });
      }
      const result = await service.listNotes(ctx(req), parsed.data);
      return sendSuccess(res, { ...result, limit: parsed.data.limit, offset: parsed.data.offset });
    },
    createNote: async (req, res) => {
      const detail = await service.saveFromJob(ctx(req), req.body);
      res.set("Location", `/api/v1/notes/${detail.note.id}`);
      return sendSuccess(res, detail, 201);
    },
    getNote: async (req, res) => sendSuccess(res, await service.getNote(ctx(req), idParam(req, "noteId", "Note"), { markOpened: true })),
    updateNote: async (req, res) => sendSuccess(res, { note: await service.updateNote(ctx(req), idParam(req, "noteId", "Note"), req.body) }),
    duplicateNote: async (req, res) =>
      sendSuccess(res, { note: await service.duplicateNote(ctx(req), idParam(req, "noteId", "Note"), req.body ?? {}) }, 201),
    deleteNote: async (req, res) => sendSuccess(res, { deleted: true, ...(await service.deleteNote(ctx(req), idParam(req, "noteId", "Note"))) }),

    // versions & autosave
    listVersions: async (req, res) => sendSuccess(res, { items: await service.listVersions(ctx(req), idParam(req, "noteId", "Note")) }),
    getVersion: async (req, res) =>
      sendSuccess(res, { version: await service.getVersion(ctx(req), idParam(req, "noteId", "Note"), idParam(req, "versionId", "Version")) }),
    snapshot: async (req, res) => sendSuccess(res, await service.snapshot(ctx(req), idParam(req, "noteId", "Note"), req.body), 201),
    restore: async (req, res) =>
      sendSuccess(res, await service.restore(ctx(req), idParam(req, "noteId", "Note"), idParam(req, "versionId", "Version")), 201),
    saveDraft: async (req, res) => sendSuccess(res, await service.saveDraft(ctx(req), idParam(req, "noteId", "Note"), req.body)),

    // exports
    createExport: async (req, res) =>
      sendSuccess(res, { export: await service.exportNote(ctx(req), idParam(req, "noteId", "Note"), req.body) }, 201),
    getExport: async (req, res) => sendSuccess(res, { export: await service.getExport(ctx(req), idParam(req, "exportId", "Export")) }),

    // Phase 5: study companion & section regeneration
    getStudyState: async (req, res) =>
      sendSuccess(res, await service.getStudyState(ctx(req), idParam(req, "noteId", "Note"))),
    explainSelection: async (req, res) =>
      sendSuccess(res, await service.explainSelection(ctx(req), idParam(req, "noteId", "Note"), req.body)),
    createQuiz: async (req, res) =>
      sendSuccess(res, { quiz: await service.createQuiz(ctx(req), idParam(req, "noteId", "Note"), req.body) }, 201),
    submitQuizAnswers: async (req, res) =>
      sendSuccess(res, { quiz: await service.submitQuizAnswers(ctx(req), idParam(req, "noteId", "Note"), idParam(req, "quizId", "Quiz"), req.body) }),
    createFlashcards: async (req, res) =>
      sendSuccess(res, { items: await service.createFlashcards(ctx(req), idParam(req, "noteId", "Note"), req.body) }, 201),
    updateFlashcard: async (req, res) =>
      sendSuccess(res, { flashcard: await service.updateFlashcard(ctx(req), idParam(req, "noteId", "Note"), idParam(req, "cardId", "Flashcard"), req.body) }),
    createRevisionGuide: async (req, res) =>
      sendSuccess(res, { revisionGuide: await service.createRevisionGuide(ctx(req), idParam(req, "noteId", "Note")) }, 201),
    askNote: async (req, res) =>
      sendSuccess(res, await service.askNote(ctx(req), idParam(req, "noteId", "Note"), req.body)),
    regenerateSection: async (req, res) =>
      sendSuccess(res, await service.regenerateSection(ctx(req), idParam(req, "noteId", "Note"), slugParam(req, "sectionId", "Section"), req.body), 201),
  };
}
