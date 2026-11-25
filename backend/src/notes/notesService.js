import {
  extractSceneFrames,
  filterSceneToFrame,
  replaceSectionInScene,
  sanitizeEditableScene,
  validateEditableScene,
} from "@visualify/worker";
import { AppError } from "../utils/errors.js";
import { notFound } from "./errors.js";
import { NOTE_ASSETS_BUCKET, NOTE_EXPORTS_BUCKET } from "./noteFiles.js";
import { createZipBuffer } from "./zipArchive.js";
import { SOURCE_FILES_BUCKET, createSourceSignedUrl, toSourceFileDto } from "../services/sourceFiles.service.js";

export const SIGNED_URL_TTL_SECONDS = 600; // PRD Appendix B: 5-15 minutes
const EXT = { png: "png", svg: "svg", excalidraw: "excalidraw", zip: "zip" };
const CONTENT_TYPE = {
  png: "image/png",
  svg: "image/svg+xml",
  excalidraw: "application/json",
  zip: "application/zip",
};

// ---------------------------------------------------------------------------
// DTOs (camelCase; never owner ids or storage paths)
// ---------------------------------------------------------------------------
export function toNoteDto(row, { previewUrl = null } = {}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    subject: row.subject ?? "",
    topic: row.topic ?? "",
    tags: row.tags ?? [],
    folderId: row.folder_id ?? null,
    isFavorite: Boolean(row.is_favorite),
    isArchived: Boolean(row.is_archived),
    sourceType: row.source_type ?? "prompt",
    currentVersionId: row.current_version_id ?? null,
    hasPreview: Boolean(row.preview_path),
    previewUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at ?? null,
  };
}

export const toFolderDto = (row, noteCount = 0) => ({
  id: row.id,
  name: row.name,
  parentId: row.parent_id ?? null,
  sortOrder: row.sort_order ?? 0,
  noteCount,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toVersionMetaDto = (v, currentId) => ({
  id: v.id,
  versionNumber: v.version_number,
  kind: v.kind,
  description: v.description ?? "",
  restoredFromVersionId: v.restored_from_version_id ?? null,
  isCurrent: v.id === currentId,
  createdAt: v.created_at,
});

export function toExportDto(row, signed = null) {
  return {
    id: row.id,
    noteId: row.note_id,
    versionId: row.version_id,
    format: row.format,
    scope: row.scope ?? "full",
    frameId: row.frame_id ?? null,
    theme: row.theme,
    transparent: Boolean(row.transparent),
    source: row.source,
    status: row.status,
    width: row.width ?? null,
    height: row.height ?? null,
    bytes: row.bytes ?? null,
    downloadUrl: signed?.url ?? null,
    downloadExpiresAt: signed?.expiresAt ?? null,
    error: row.error_code ? { code: row.error_code, message: row.safe_error_message } : null,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? null,
  };
}

export const toQuizDto = (row) =>
  row
    ? {
        id: row.id,
        noteId: row.note_id,
        versionId: row.version_id,
        difficulty: row.difficulty,
        questions: row.questions ?? [],
        answers: row.answers ?? {},
        score: row.score ?? null,
        totalQuestions: row.total_questions,
        completedAt: row.completed_at ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

export const toFlashcardDto = (row) => ({
  id: row.id,
  noteId: row.note_id,
  versionId: row.version_id,
  front: row.front,
  back: row.back,
  hint: row.hint ?? "",
  sectionId: row.section_id ?? null,
  concept: row.concept ?? "",
  sortOrder: row.sort_order ?? 0,
  mastery: row.mastery ?? "new",
  reviewCount: row.review_count ?? 0,
  lastReviewedAt: row.last_reviewed_at ?? null,
});

export const toRevisionGuideDto = (row) =>
  row
    ? {
        id: row.id,
        noteId: row.note_id,
        versionId: row.version_id,
        ...(row.guide_json ?? {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

/** Validates + sanitises an editor scene, or throws a 400 the client can show. */
export function cleanScene(scene) {
  const result = validateEditableScene(scene);
  if (!result.valid) {
    throw new AppError(400, "INVALID_SCENE", "This drawing contains something that can't be saved (for example an image or an unsafe link).", {
      details: result.errors.slice(0, 5).map((message) => ({ field: "sceneJson", message })),
    });
  }
  return sanitizeEditableScene(scene);
}

export const normalizeTags = (tags) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];

export function fileSlug(title) {
  const slug = String(title ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return slug || "visualify-note";
}

/**
 * Notes domain service. Per-request context `ctx`:
 *   { userId, repo (RLS-scoped repository), files (RLS-scoped storage), db (user client) }
 * Shared deps: renderer (CLI), jobStore (generation jobs), tasks (background queue).
 */
export function createNotesService({ renderer, jobStore, tasks, companion = null, compileSection = null, usageRecorder = null, logger }) {
  const log = logger?.child ? logger.child({ component: "notes" }) : logger;
  let taskSeq = 0;

  function requireAiCompanion() {
    if (!companion?.enabled) {
      throw new AppError(503, "AI_UNAVAILABLE", "AI study companion is temporarily unavailable. Check server Gemini configuration.");
    }
  }

  function mapAiError(err) {
    if (err instanceof AppError) return err;
    const code = err?.code;
    if (code === "PROVIDER_RATE_LIMIT") {
      return new AppError(503, "AI_BUSY", "The AI service is busy right now. Please try again in a moment.", { cause: err });
    }
    if (code === "PROVIDER_TIMEOUT" || err?.name === "AbortError") {
      return new AppError(504, "AI_TIMEOUT", "The AI request took too long. Please try again.", { cause: err });
    }
    if (code === "MODEL_RESPONSE_BLOCKED") {
      return new AppError(422, "CONTENT_BLOCKED", "The request couldn't be completed for this content.", { cause: err });
    }
    return new AppError(502, "COMPANION_FAILED", "Couldn't generate a study response right now. Please try again.", { cause: err });
  }

  function recordUsage(ctx, eventType, { noteId, result = null, units = 1 } = {}) {
    if (!usageRecorder) return;
    usageRecorder({
      ownerId: ctx.userId,
      eventType,
      units,
      metadata: {
        noteId,
        ...(result?.model ? { modelId: result.model } : {}),
        ...(result?.usageMetadata?.totalTokenCount != null ? { totalTokens: result.usageMetadata.totalTokenCount } : {}),
      },
    }).catch(() => {});
  }

  async function requireNote(ctx, id) {
    const note = await ctx.repo.getNote(id);
    if (!note) throw notFound();
    return note;
  }

  async function requireFolder(ctx, id) {
    const folder = await ctx.repo.getFolder(id);
    if (!folder) throw new AppError(404, "FOLDER_NOT_FOUND", "Folder not found.");
    return folder;
  }

  async function previewUrlFor(ctx, row) {
    if (!row.preview_path) return null;
    return (await ctx.files.sign(NOTE_ASSETS_BUCKET, row.preview_path, SIGNED_URL_TTL_SECONDS))?.url ?? null;
  }

  /** Latest saved scene: the autosaved draft if present, else the current version. */
  async function workingState(ctx, note) {
    const [version, draft] = await Promise.all([
      note.current_version_id ? ctx.repo.getVersion(note.id, note.current_version_id) : null,
      ctx.repo.getDraft(note.id),
    ]);
    return { version, draft, scene: draft?.scene_json ?? version?.scene_json ?? null };
  }

  /** Background thumbnail (best effort, never blocks or fails the request). */
  function schedulePreview(ctx, noteId, versionId, scene) {
    if (!tasks || !renderer || !scene) return;
    taskSeq += 1;
    tasks.enqueue(`preview-${taskSeq}`, async () => {
      try {
        const out = await renderer.render({ scene, format: "png", theme: "light", transparent: false });
        const path = `${ctx.userId}/${noteId}/${versionId}/preview.png`;
        await ctx.files.upload(NOTE_ASSETS_BUCKET, path, out.buffer, "image/png");
        const before = await ctx.repo.getNote(noteId);
        if (!before) {
          await ctx.files.remove(NOTE_ASSETS_BUCKET, [path]); // note deleted meanwhile
          return;
        }
        await ctx.repo.updateNote(noteId, { preview_path: path });
        if (before.preview_path && before.preview_path !== path) {
          await ctx.files.remove(NOTE_ASSETS_BUCKET, [before.preview_path]).catch(() => {});
        }
      } catch (err) {
        log?.warn({ noteId, userId: ctx.userId, errorCode: err?.code ?? "PREVIEW_FAILED" }, "note preview failed");
      }
    });
  }

  async function noteDetail(ctx, note) {
    const [{ version, draft, scene }, previewUrl, sourceRow] = await Promise.all([
      workingState(ctx, note),
      previewUrlFor(ctx, note),
      ctx.repo.getSourceForNote ? ctx.repo.getSourceForNote(note.id).catch(() => null) : Promise.resolve(null),
    ]);
    let sourceFile = null;
    if (sourceRow) {
      const signed = ctx.db?.storage ? await createSourceSignedUrl(ctx.db.storage, sourceRow, SIGNED_URL_TTL_SECONDS, log) : null;
      sourceFile = toSourceFileDto(sourceRow, signed);
    }
    return {
      note: toNoteDto(note, { previewUrl }),
      sourceFile,
      currentVersion: version
        ? { ...toVersionMetaDto(version, note.current_version_id), learningPlan: version.learning_plan ?? null, mermaidSource: version.mermaid_source ?? null }
        : null,
      draft: draft ? { revision: draft.revision, updatedAt: draft.updated_at } : null,
      draftRevision: draft?.revision ?? 0,
      sceneJson: scene,
    };
  }

  return {
    // ---- folders --------------------------------------------------------------
    async listFolders(ctx) {
      const [rows, counts] = await Promise.all([ctx.repo.listFolders(), ctx.repo.folderNoteCounts()]);
      return rows.map((r) => toFolderDto(r, counts[r.id] ?? 0));
    },

    async createFolder(ctx, { name, parentId }) {
      if (parentId) await requireFolder(ctx, parentId);
      return toFolderDto(await ctx.repo.createFolder({ name, parentId }));
    },

    async updateFolder(ctx, id, body) {
      await requireFolder(ctx, id);
      if (body.parentId === id) {
        throw new AppError(400, "FOLDER_CYCLE", "A folder can't be moved into itself or one of its subfolders.");
      }
      if (body.parentId) await requireFolder(ctx, body.parentId);
      const patch = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.parentId !== undefined) patch.parent_id = body.parentId;
      if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
      return toFolderDto(await ctx.repo.updateFolder(id, patch));
    },

    async deleteFolder(ctx, id) {
      await requireFolder(ctx, id);
      await ctx.repo.deleteFolder(id);
    },

    // ---- notes ------------------------------------------------------------------
    async listNotes(ctx, query) {
      const { items, total } = await ctx.repo.listNotes(query);
      const urls = await ctx.files.signMany(
        NOTE_ASSETS_BUCKET,
        items.map((n) => n.preview_path).filter(Boolean),
        SIGNED_URL_TTL_SECONDS
      );
      return { items: items.map((n) => toNoteDto(n, { previewUrl: n.preview_path ? urls[n.preview_path] ?? null : null })), total };
    },

    async saveFromJob(ctx, body) {
      const job = await jobStore.getJob({ db: ctx.db, ownerId: ctx.userId, jobId: body.jobId });
      if (!job) throw notFound("Generation");
      if (job.status !== "completed" || !job.scene_json) {
        throw new AppError(409, "JOB_NOT_COMPLETED", "Only completed generations can be saved.");
      }
      if (body.folderId) await requireFolder(ctx, body.folderId);
      const scene = body.sceneJson ? cleanScene(body.sceneJson) : null;
      const title = (body.title || job.learning_plan?.title || "Untitled visual").trim().slice(0, 160);
      let created;
      try {
        created = await ctx.repo.createFromJob({
          jobId: job.id,
          title,
          folderId: body.folderId ?? null,
          description: body.description ?? (job.learning_plan?.summary ?? "").slice(0, 1000),
          subject: body.subject ?? (job.settings?.subject ?? "").slice(0, 120),
          tags: normalizeTags(body.tags ?? []),
          scene,
        });
      } catch (err) {
        if (err?.code === "JOB_ALREADY_SAVED") {
          const noteId = await ctx.repo.findNoteForJob(job.id);
          throw new AppError(409, "JOB_ALREADY_SAVED", "This visual is already in your library.", { details: noteId ? { noteId } : null });
        }
        throw err;
      }
      // Informational link job -> note, written server-side (best effort).
      jobStore.updateJob?.(job.id, { note_id: created.noteId }, { expectStatus: ["completed"] })?.catch?.((err) =>
        log?.warn({ jobId: job.id, errorCode: err?.code ?? "JOB_LINK_FAILED" }, "could not link job to note")
      );
      schedulePreview(ctx, created.noteId, created.versionId, scene ?? job.scene_json);
      const note = await requireNote(ctx, created.noteId);
      return noteDetail(ctx, note);
    },

    async getNote(ctx, id, { markOpened = false } = {}) {
      const note = await requireNote(ctx, id);
      if (markOpened) await ctx.repo.markOpened(id).catch(() => {});
      return noteDetail(ctx, note);
    },

    async updateNote(ctx, id, body) {
      await requireNote(ctx, id);
      if (body.folderId) await requireFolder(ctx, body.folderId);
      const map = { title: "title", description: "description", subject: "subject", topic: "topic", folderId: "folder_id", isFavorite: "is_favorite", isArchived: "is_archived" };
      const patch = {};
      for (const [k, col] of Object.entries(map)) if (body[k] !== undefined) patch[col] = body[k];
      if (body.tags !== undefined) patch.tags = normalizeTags(body.tags);
      const row = await ctx.repo.updateNote(id, patch);
      return toNoteDto(row, { previewUrl: await previewUrlFor(ctx, row) });
    },

    async duplicateNote(ctx, id, { title } = {}) {
      const src = await requireNote(ctx, id);
      const newTitle = (title || `Copy of ${src.title}`).slice(0, 160);
      const { noteId, versionId } = await ctx.repo.duplicate(id, newTitle);
      const copy = await requireNote(ctx, noteId);
      const version = await ctx.repo.getVersion(noteId, versionId);
      schedulePreview(ctx, noteId, versionId, version?.scene_json);
      return toNoteDto(copy);
    },

    /** Deletes Storage objects FIRST (DB cascades don't), then the note. */
    async deleteNote(ctx, id) {
      await requireNote(ctx, id);
      const prefix = `${ctx.userId}/${id}`;
      const [exportPaths, sweptExports, sweptAssets, linkedSources] = await Promise.all([
        ctx.repo.exportPaths(id),
        ctx.files.listUnder(NOTE_EXPORTS_BUCKET, prefix),
        ctx.files.listUnder(NOTE_ASSETS_BUCKET, prefix),
        ctx.repo.listSourcesForNote ? ctx.repo.listSourcesForNote(id).catch(() => []) : Promise.resolve([]),
      ]);
      const note = await ctx.repo.getNote(id);
      const assets = [...new Set([...sweptAssets, ...(note?.preview_path ? [note.preview_path] : [])])];
      const exports = [...new Set([...exportPaths, ...sweptExports])];
      await ctx.files.remove(NOTE_EXPORTS_BUCKET, exports);
      await ctx.files.remove(NOTE_ASSETS_BUCKET, assets);
      await ctx.repo.deleteNote(id);
      if (linkedSources?.length) {
        const paths = linkedSources.map((s) => s.object_path).filter(Boolean);
        if (paths.length) await ctx.files.remove(SOURCE_FILES_BUCKET, paths).catch(() => {});
        await Promise.all(linkedSources.map((s) => ctx.repo.deleteSourceFile?.(s.id).catch?.(() => {})));
      }
      return { removedFiles: assets.length + exports.length };
    },

    // ---- versions ---------------------------------------------------------------
    async listVersions(ctx, id) {
      const note = await requireNote(ctx, id);
      const rows = await ctx.repo.listVersions(id);
      return rows.map((v) => toVersionMetaDto(v, note.current_version_id));
    },

    async getVersion(ctx, id, versionId) {
      const note = await requireNote(ctx, id);
      const v = await ctx.repo.getVersion(id, versionId);
      if (!v) throw notFound("Version");
      return { ...toVersionMetaDto(v, note.current_version_id), sceneJson: v.scene_json, learningPlan: v.learning_plan ?? null };
    },

    async snapshot(ctx, id, { sceneJson, description = "" }) {
      await requireNote(ctx, id);
      const scene = cleanScene(sceneJson);
      const created = await ctx.repo.addVersion(id, { scene, description, kind: "snapshot" });
      // The RPC returns a slim row; read the full version for an accurate response.
      const full = await ctx.repo.getVersion(id, created.id);
      schedulePreview(ctx, id, created.id, scene);
      return { version: toVersionMetaDto(full, full.id), draftRevision: 0 };
    },

    async restore(ctx, id, versionId) {
      await requireNote(ctx, id);
      const created = await ctx.repo.restoreVersion(id, versionId);
      const full = await ctx.repo.getVersion(id, created.id);
      schedulePreview(ctx, id, full.id, full.scene_json);
      return { version: toVersionMetaDto(full, full.id), sceneJson: full.scene_json, draftRevision: 0 };
    },

    async saveDraft(ctx, id, { sceneJson, baseRevision }) {
      const scene = cleanScene(sceneJson);
      const saved = await ctx.repo.saveDraft(id, scene, baseRevision);
      return { revision: saved.revision, savedAt: saved.updated_at };
    },

    // ---- exports ---------------------------------------------------------------
    async exportNote(ctx, id, { format, theme, transparent, scope = "full", frameId, slideFormat = "png" }) {
      const note = await requireNote(ctx, id);
      if (!note.current_version_id) throw new AppError(409, "NOTE_HAS_NO_VERSION", "This note has nothing to export yet.");
      if (scope === "frame" && !frameId) {
        throw new AppError(400, "FRAME_REQUIRED", "Choose which frame or section to export.");
      }
      const { version, draft, scene } = await workingState(ctx, note);
      const targetScene =
        scope === "frame"
          ? filterSceneToFrame(scene, frameId, version?.learning_plan ?? null)
          : scene;
      if (!targetScene) {
        throw new AppError(404, "FRAME_NOT_FOUND", "The selected frame could not be found in this note.");
      }

      const row = await ctx.repo.createExport({
        noteId: id,
        versionId: note.current_version_id,
        format,
        scope,
        frameId: scope === "frame" ? frameId : null,
        theme,
        transparent: format === "excalidraw" ? false : transparent,
        source: draft ? "draft" : "version",
      });
      const path = `${ctx.userId}/${id}/${note.current_version_id}/export-${row.id}.${EXT[format]}`;
      try {
        let buffer;
        let dims = { width: null, height: null };
        if (format === "excalidraw") {
          buffer = Buffer.from(
            JSON.stringify({ ...targetScene, type: "excalidraw", version: 2, source: "https://visualify.app", files: {} }, null, 2),
            "utf8"
          );
        } else if (format === "zip") {
          const frames = extractSceneFrames(scene, version?.learning_plan ?? null);
          const entries = [];
          const manifestSlides = [];
          for (const frame of frames) {
            const slideScene = filterSceneToFrame(scene, frame.frameId ?? frame.sectionId, version?.learning_plan ?? null) ?? scene;
            const num = String(frame.index + 1).padStart(2, "0");
            const fileName = `${num}-${fileSlug(frame.title)}.${slideFormat}`;
            try {
              const out = await renderer.render({ scene: slideScene, format: slideFormat, theme, transparent });
              entries.push({ name: fileName, data: out.buffer });
              manifestSlides.push({ index: frame.index + 1, title: frame.title, file: fileName, width: out.width, height: out.height });
            } catch {
              manifestSlides.push({ index: frame.index + 1, title: frame.title, file: null, skipped: true });
            }
          }
          if (entries.length === 0) {
            throw new Error("All slide renders failed during ZIP export");
          }
          entries.push({
            name: "manifest.json",
            data: JSON.stringify({ title: note.title, exportedAt: new Date().toISOString(), slides: manifestSlides }, null, 2),
          });
          buffer = createZipBuffer(entries);
        } else {
          const out = await renderer.render({ scene: targetScene, format, theme, transparent });
          buffer = out.buffer;
          dims = { width: out.width, height: out.height };
        }
        await ctx.files.upload(NOTE_EXPORTS_BUCKET, path, buffer, CONTENT_TYPE[format]);
        const done = await ctx.repo.updateExport(row.id, {
          status: "completed",
          object_path: path,
          width: dims.width,
          height: dims.height,
          bytes: buffer.length,
          finished_at: new Date().toISOString(),
        });
        const signed = await ctx.files.sign(NOTE_EXPORTS_BUCKET, path, SIGNED_URL_TTL_SECONDS, { download: `${fileSlug(note.title)}.${EXT[format]}` });
        recordUsage(ctx, "export", { noteId: id });
        return toExportDto(done, signed);
      } catch (err) {
        log?.warn({ noteId: id, userId: ctx.userId, exportId: row.id, format, errorCode: err?.code ?? "EXPORT_FAILED" }, "export failed");
        await ctx.repo
          .updateExport(row.id, { status: "failed", error_code: "EXPORT_FAILED", safe_error_message: "The export couldn't be created. Please try again.", finished_at: new Date().toISOString() })
          .catch(() => {});
        throw new AppError(502, "EXPORT_FAILED", "The export couldn't be created. Please try again.", { details: { exportId: row.id }, cause: err });
      }
    },

    // ---- Phase 5: Study Companion & Section Regeneration -----------------------
    async getStudyState(ctx, id) {
      const note = await requireNote(ctx, id);
      if (!note.current_version_id) {
        return { versionId: null, quiz: null, flashcards: [], revisionGuide: null };
      }
      const [quizRow, flashcardRows, guideRow] = await Promise.all([
        ctx.repo.getLatestQuiz(id, note.current_version_id).catch(() => null),
        ctx.repo.listFlashcards(id, note.current_version_id).catch(() => []),
        ctx.repo.getRevisionGuide(id, note.current_version_id).catch(() => null),
      ]);
      return {
        versionId: note.current_version_id,
        quiz: toQuizDto(quizRow),
        flashcards: (flashcardRows ?? []).map(toFlashcardDto),
        revisionGuide: toRevisionGuideDto(guideRow),
      };
    },

    async explainSelection(ctx, id, { selectedElements, question = "" }) {
      const note = await requireNote(ctx, id);
      requireAiCompanion();
      const { version, scene } = await workingState(ctx, note);
      try {
        const res = await companion.explainSelection({
          title: note.title,
          learningPlan: version?.learning_plan ?? null,
          sceneJson: scene,
          selectedElements,
          question,
        });
        recordUsage(ctx, "explain_node", { noteId: id, result: res });
        return {
          explanation: res.explanation,
          analogy: res.analogy ?? "",
          keyPoint: res.keyPoint,
          relatedConcepts: res.relatedConcepts ?? [],
        };
      } catch (err) {
        log?.warn({ noteId: id, userId: ctx.userId, errorCode: err?.code ?? "COMPANION_FAILED" }, "explain selection failed");
        throw mapAiError(err);
      }
    },

    async createQuiz(ctx, id, { difficulty = "mixed", questionCount = 5 } = {}) {
      const note = await requireNote(ctx, id);
      if (!note.current_version_id) throw new AppError(409, "NOTE_HAS_NO_VERSION", "This note has no version to study yet.");
      requireAiCompanion();
      const { version, scene } = await workingState(ctx, note);
      let res;
      try {
        res = await companion.generateQuiz({
          title: note.title,
          learningPlan: version?.learning_plan ?? null,
          sceneJson: scene,
          difficulty,
          questionCount,
        });
      } catch (err) {
        log?.warn({ noteId: id, userId: ctx.userId, errorCode: err?.code ?? "COMPANION_FAILED" }, "quiz generation failed");
        throw mapAiError(err);
      }
      const row = await ctx.repo.createQuiz({
        noteId: id,
        versionId: note.current_version_id,
        difficulty,
        questions: res.questions,
        modelId: res.model ?? null,
      });
      recordUsage(ctx, "quiz", { noteId: id, result: res });
      return toQuizDto(row);
    },

    async submitQuizAnswers(ctx, noteId, quizId, { answers }) {
      await requireNote(ctx, noteId);
      const quiz = await ctx.repo.getQuiz(noteId, quizId);
      if (!quiz) throw notFound("Quiz");
      const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
      const cleanAnswers = {};
      let score = 0;
      for (const q of questions) {
        if (Object.hasOwn(answers, q.id) && Number.isInteger(answers[q.id]) && answers[q.id] >= 0 && answers[q.id] <= 3) {
          cleanAnswers[q.id] = answers[q.id];
          if (answers[q.id] === q.correctIndex) score += 1;
        }
      }
      const completedAt = Object.keys(cleanAnswers).length >= questions.length && questions.length > 0
        ? new Date().toISOString()
        : null;
      const updated = await ctx.repo.updateQuizAnswers(quizId, { answers: cleanAnswers, score, completedAt });
      return toQuizDto(updated);
    },

    async createFlashcards(ctx, id, { cardCount = 8 } = {}) {
      const note = await requireNote(ctx, id);
      if (!note.current_version_id) throw new AppError(409, "NOTE_HAS_NO_VERSION", "This note has no version to study yet.");
      requireAiCompanion();
      const { version, scene } = await workingState(ctx, note);
      let res;
      try {
        res = await companion.generateFlashcards({
          title: note.title,
          learningPlan: version?.learning_plan ?? null,
          sceneJson: scene,
          cardCount,
        });
      } catch (err) {
        log?.warn({ noteId: id, userId: ctx.userId, errorCode: err?.code ?? "COMPANION_FAILED" }, "flashcards generation failed");
        throw mapAiError(err);
      }
      const rows = await ctx.repo.replaceFlashcards({
        noteId: id,
        versionId: note.current_version_id,
        cards: res.cards,
      });
      recordUsage(ctx, "flashcards", { noteId: id, result: res });
      return rows.map(toFlashcardDto);
    },

    async updateFlashcard(ctx, noteId, cardId, { mastery }) {
      await requireNote(ctx, noteId);
      const card = await ctx.repo.getFlashcard(noteId, cardId);
      if (!card) throw notFound("Flashcard");
      const updated = await ctx.repo.updateFlashcardMastery(cardId, {
        mastery,
        reviewCount: (card.review_count ?? 0) + 1,
        lastReviewedAt: new Date().toISOString(),
      });
      return toFlashcardDto(updated);
    },

    async createRevisionGuide(ctx, id) {
      const note = await requireNote(ctx, id);
      if (!note.current_version_id) throw new AppError(409, "NOTE_HAS_NO_VERSION", "This note has no version to study yet.");
      requireAiCompanion();
      const { version, scene } = await workingState(ctx, note);
      let res;
      try {
        res = await companion.generateRevisionGuide({
          title: note.title,
          learningPlan: version?.learning_plan ?? null,
          sceneJson: scene,
        });
      } catch (err) {
        log?.warn({ noteId: id, userId: ctx.userId, errorCode: err?.code ?? "COMPANION_FAILED" }, "revision guide generation failed");
        throw mapAiError(err);
      }
      const guideJson = {
        summary: res.summary,
        keyTerms: res.keyTerms,
        commonConfusions: res.commonConfusions,
        selfCheck: res.selfCheck,
      };
      const row = await ctx.repo.upsertRevisionGuide({
        noteId: id,
        versionId: note.current_version_id,
        guideJson,
        modelId: res.model ?? null,
      });
      recordUsage(ctx, "revision", { noteId: id, result: res });
      return toRevisionGuideDto(row);
    },

    async askNote(ctx, id, { question }) {
      const note = await requireNote(ctx, id);
      requireAiCompanion();
      const { version, scene } = await workingState(ctx, note);
      try {
        const res = await companion.askNote({
          title: note.title,
          learningPlan: version?.learning_plan ?? null,
          sceneJson: scene,
          question,
        });
        recordUsage(ctx, "ask_note", { noteId: id, result: res });
        return {
          answer: res.answer,
          grounded: Boolean(res.grounded),
          citations: res.citations ?? [],
        };
      } catch (err) {
        log?.warn({ noteId: id, userId: ctx.userId, errorCode: err?.code ?? "COMPANION_FAILED" }, "ask note failed");
        throw mapAiError(err);
      }
    },

    async regenerateSection(ctx, id, sectionId, { title, explanation, visualType, visualStyle = "hand_drawn_clean", instruction = "" }) {
      const note = await requireNote(ctx, id);
      if (!note.current_version_id) throw new AppError(409, "NOTE_HAS_NO_VERSION", "This note has no version to edit yet.");
      const { version, scene } = await workingState(ctx, note);
      const plan = version?.learning_plan;
      const sectionIdx = (plan?.sections ?? []).findIndex((s) => s.id === sectionId);
      if (sectionIdx === -1) throw notFound("Section");
      requireAiCompanion();
      if (!compileSection) {
        throw new AppError(503, "AI_UNAVAILABLE", "Diagram compiler is unavailable.");
      }

      let regen;
      let compiled;
      try {
        regen = await companion.regenerateSectionPlan({
          noteTitle: note.title,
          learningPlan: plan,
          sectionId,
          updatedTitle: title,
          updatedExplanation: explanation,
          updatedVisualType: visualType,
          instruction,
        });
        compiled = await compileSection(regen.section.diagramSpec, { visualStyle });
      } catch (err) {
        log?.warn({ noteId: id, userId: ctx.userId, sectionId, errorCode: err?.code ?? "REGENERATE_FAILED" }, "section regeneration failed");
        throw mapAiError(err);
      }

      const nextScene = replaceSectionInScene({
        sceneJson: scene,
        sectionId,
        sectionIndex: sectionIdx,
        sectionTitle: regen.section.title,
        visualType: regen.section.visualType,
        sectionScene: compiled.scene,
        visualStyle,
      });

      const nextPlan = {
        ...plan,
        sections: plan.sections.map((s, idx) => (idx === sectionIdx ? regen.section : s)),
      };
      const created = await ctx.repo.addVersion(id, {
        scene: nextScene,
        description: `Regenerated section: ${regen.section.title}`.slice(0, 200),
        kind: "regenerate",
        learningPlan: nextPlan,
      });
      const full = await ctx.repo.getVersion(id, created.id);
      schedulePreview(ctx, id, created.id, nextScene);
      recordUsage(ctx, "section_regenerate", { noteId: id, result: regen });

      return {
        version: toVersionMetaDto(full, full.id),
        learningPlan: full.learning_plan ?? nextPlan,
        sceneJson: full.scene_json ?? nextScene,
        draftRevision: 0,
      };
    },

    async getExport(ctx, exportId) {
      const row = await ctx.repo.getExport(exportId);
      if (!row) throw notFound("Export");
      let signed = null;
      if (row.status === "completed" && row.object_path) {
        const note = await ctx.repo.getNote(row.note_id);
        signed = await ctx.files.sign(NOTE_EXPORTS_BUCKET, row.object_path, SIGNED_URL_TTL_SECONDS, {
          download: `${fileSlug(note?.title)}.${EXT[row.format]}`,
        });
      }
      return toExportDto(row, signed);
    },

    onIdle: () => tasks?.onIdle?.() ?? Promise.resolve(),
  };
}
