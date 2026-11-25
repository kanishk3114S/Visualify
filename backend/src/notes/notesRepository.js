import { AppError } from "../utils/errors.js";
import { mapNotesDbError, notFound } from "./errors.js";

export const NOTE_COLUMNS =
  "id, owner_id, folder_id, title, description, subject, topic, tags, is_favorite, is_archived, source_type, current_version_id, preview_path, created_at, updated_at, last_opened_at";
const VERSION_META = "id, note_id, version_number, kind, description, created_by_job_id, restored_from_version_id, created_at";
const VERSION_FULL = `${VERSION_META}, scene_json, learning_plan, mermaid_source`;
const FOLDER_COLUMNS = "id, name, parent_id, sort_order, created_at, updated_at";
const EXPORT_COLUMNS = "id, note_id, version_id, format, scope, frame_id, theme, transparent, source, object_path, width, height, bytes, status, error_code, safe_error_message, created_at, finished_at";
const QUIZ_COLUMNS = "id, note_id, version_id, difficulty, questions, answers, score, total_questions, completed_at, model_id, created_at, updated_at";
const FLASHCARD_COLUMNS = "id, note_id, version_id, front, back, hint, section_id, concept, sort_order, mastery, review_count, last_reviewed_at, created_at, updated_at";
const REVISION_COLUMNS = "id, note_id, version_id, guide_json, model_id, created_at, updated_at";

const SORTS = {
  updated_at: { column: "updated_at", ascending: false },
  created_at: { column: "created_at", ascending: false },
  last_opened_at: { column: "last_opened_at", ascending: false, nullsFirst: false },
  title: { column: "title", ascending: true },
};

/**
 * Notes-domain data access through the CALLER'S RLS-scoped Supabase client.
 * Every query also filters by owner explicitly (defence in depth). Multi-row
 * writes use the SECURITY INVOKER functions from migration 0004.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} db  user-scoped client
 * @param {string} ownerId  verified user id (from the JWT)
 */
export function createSupabaseNotesRepository(db, ownerId) {
  const one = async (query, entity) => {
    const { data, error } = await query;
    if (error) throw mapNotesDbError(error, { entity });
    return data;
  };

  return {
    ownerId,

    // ---- folders --------------------------------------------------------------
    listFolders: () => one(db.from("folders").select(FOLDER_COLUMNS).eq("owner_id", ownerId).order("sort_order").order("name"), "Folder"),

    async folderNoteCounts() {
      const rows = await one(db.from("notes").select("folder_id").eq("owner_id", ownerId).eq("is_archived", false), "Note");
      const counts = {};
      for (const r of rows) if (r.folder_id) counts[r.folder_id] = (counts[r.folder_id] ?? 0) + 1;
      return counts;
    },

    getFolder: (id) => one(db.from("folders").select(FOLDER_COLUMNS).eq("id", id).eq("owner_id", ownerId).maybeSingle(), "Folder"),

    createFolder: ({ name, parentId = null, sortOrder = 0 }) =>
      one(db.from("folders").insert({ owner_id: ownerId, name, parent_id: parentId, sort_order: sortOrder }).select(FOLDER_COLUMNS).single(), "Folder"),

    async updateFolder(id, patch) {
      const row = await one(db.from("folders").update(patch).eq("id", id).eq("owner_id", ownerId).select(FOLDER_COLUMNS).maybeSingle(), "Folder");
      if (!row) throw notFound("Folder");
      return row;
    },

    async deleteFolder(id) {
      await one(db.rpc("delete_folder", { p_folder_id: id }), "Folder");
    },

    // ---- notes ------------------------------------------------------------------
    async listNotes({ q, folderId, tags, favorite, archived, sort, limit, offset }) {
      let query = db.from("notes").select(NOTE_COLUMNS, { count: "exact" }).eq("owner_id", ownerId);
      if (folderId === "root") query = query.is("folder_id", null);
      else if (folderId) query = query.eq("folder_id", folderId);
      if (archived !== "all") query = query.eq("is_archived", archived === "true");
      if (favorite) query = query.eq("is_favorite", true);
      if (tags?.length) query = query.contains("tags", tags);
      if (q) {
        // q is pre-sanitised to letters, digits, spaces and hyphens, so it
        // cannot break out of the PostgREST filter grammar.
        query = query.or(`title.ilike.*${q}*,description.ilike.*${q}*,subject.ilike.*${q}*,tags.cs.{${q.toLowerCase()}}`);
      }
      const s = SORTS[sort] ?? SORTS.updated_at;
      query = query.order(s.column, { ascending: s.ascending, nullsFirst: s.nullsFirst ?? false }).order("id");
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw mapNotesDbError(error);
      return { items: data ?? [], total: count ?? 0 };
    },

    getNote: (id) => one(db.from("notes").select(NOTE_COLUMNS).eq("id", id).eq("owner_id", ownerId).maybeSingle()),

    getSourceForNote: (noteId) =>
      one(
        db
          .from("source_files")
          .select("id, original_name, mime_type, size_bytes, page_count, width, height, object_path, extraction_status, extracted_metadata, created_at")
          .eq("note_id", noteId)
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "Source"
      ),

    async createFromJob({ jobId, title, folderId, description, subject, tags, scene }) {
      const rows = await one(
        db.rpc("create_note_from_job", {
          p_job_id: jobId,
          p_title: title,
          p_folder_id: folderId ?? null,
          p_description: description ?? "",
          p_subject: subject ?? "",
          p_tags: tags ?? [],
          p_scene: scene ?? null,
        }),
        "Generation"
      );
      return { noteId: rows[0].note_id, versionId: rows[0].version_id };
    },

    async findNoteForJob(jobId) {
      const row = await one(
        db.from("note_versions").select("note_id").eq("owner_id", ownerId).eq("created_by_job_id", jobId).eq("kind", "generated").maybeSingle()
      );
      return row?.note_id ?? null;
    },

    async updateNote(id, patch) {
      const row = await one(db.from("notes").update(patch).eq("id", id).eq("owner_id", ownerId).select(NOTE_COLUMNS).maybeSingle());
      if (!row) throw notFound();
      return row;
    },

    async markOpened(id) {
      await one(db.from("notes").update({ last_opened_at: new Date().toISOString() }).eq("id", id).eq("owner_id", ownerId));
    },

    async duplicate(id, title) {
      const rows = await one(db.rpc("duplicate_note", { p_note_id: id, p_title: title }));
      return { noteId: rows[0].note_id, versionId: rows[0].version_id };
    },

    async deleteNote(id) {
      const rows = await one(db.from("notes").delete().eq("id", id).eq("owner_id", ownerId).select("id"));
      if (!rows?.length) throw notFound();
    },

    // ---- versions ---------------------------------------------------------------
    listVersions: (noteId) =>
      one(db.from("note_versions").select(VERSION_META).eq("note_id", noteId).eq("owner_id", ownerId).order("version_number", { ascending: false }).limit(200), "Version"),

    getVersion: (noteId, versionId) =>
      one(db.from("note_versions").select(VERSION_FULL).eq("id", versionId).eq("note_id", noteId).eq("owner_id", ownerId).maybeSingle(), "Version"),

    async addVersion(noteId, { scene, description = "", kind = "snapshot", learningPlan = null, mermaidSource = null }) {
      const params = {
        p_note_id: noteId,
        p_scene: scene,
        p_description: description,
        p_kind: kind,
        ...(learningPlan !== undefined && learningPlan !== null ? { p_learning_plan: learningPlan } : {}),
        ...(mermaidSource !== undefined && mermaidSource !== null ? { p_mermaid_source: mermaidSource } : {}),
      };
      const rows = await one(db.rpc("add_note_version", params));
      return rows[0];
    },

    async restoreVersion(noteId, versionId) {
      const rows = await one(db.rpc("restore_note_version", { p_note_id: noteId, p_version_id: versionId }), "Version");
      return rows[0];
    },

    // ---- drafts (autosave) ------------------------------------------------------
    getDraft: (noteId) => one(db.from("note_drafts").select("note_id, scene_json, revision, updated_at").eq("note_id", noteId).eq("owner_id", ownerId).maybeSingle()),

    /** Optimistic concurrency: succeeds only if the stored revision equals baseRevision (0 = no draft yet). */
    async saveDraft(noteId, scene, baseRevision) {
      const conflict = () => new AppError(409, "DRAFT_CONFLICT", "This note was changed in another tab or window. Reload to get the latest version.");
      if (baseRevision === 0) {
        const { data, error } = await db
          .from("note_drafts")
          .insert({ note_id: noteId, owner_id: ownerId, scene_json: scene, revision: 1 })
          .select("revision, updated_at")
          .single();
        if (error?.code === "23505") throw conflict();
        if (error?.code === "23503") throw notFound();
        if (error) throw mapNotesDbError(error);
        return data;
      }
      const rows = await one(
        db.from("note_drafts").update({ scene_json: scene, revision: baseRevision + 1 }).eq("note_id", noteId).eq("owner_id", ownerId).eq("revision", baseRevision).select("revision, updated_at")
      );
      if (!rows?.length) throw conflict();
      return rows[0];
    },

    // ---- exports ---------------------------------------------------------------
    createExport: ({ noteId, versionId, format, scope, frameId, theme, transparent, source }) =>
      one(
        db
          .from("note_exports")
          .insert({
            owner_id: ownerId,
            note_id: noteId,
            version_id: versionId,
            format,
            ...(scope ? { scope } : {}),
            ...(frameId !== undefined ? { frame_id: frameId } : {}),
            theme,
            transparent,
            source,
            status: "processing",
          })
          .select(EXPORT_COLUMNS)
          .single(),
        "Export"
      ),

    updateExport: (id, patch) => one(db.from("note_exports").update(patch).eq("id", id).eq("owner_id", ownerId).select(EXPORT_COLUMNS).single(), "Export"),

    getExport: (id) => one(db.from("note_exports").select(EXPORT_COLUMNS).eq("id", id).eq("owner_id", ownerId).maybeSingle(), "Export"),

    async exportPaths(noteId) {
      const rows = await one(db.from("note_exports").select("object_path").eq("note_id", noteId).eq("owner_id", ownerId).not("object_path", "is", null), "Export");
      return rows.map((r) => r.object_path);
    },

    listSourcesForNote: (noteId) =>
      one(db.from("source_files").select("id, object_path").eq("note_id", noteId).eq("owner_id", ownerId), "Source"),

    deleteSourceFile: (id) => one(db.from("source_files").delete().eq("id", id).eq("owner_id", ownerId), "Source"),

    // ---- Phase 5 study companion -----------------------------------------------
    getLatestQuiz: (noteId, versionId) =>
      one(
        db
          .from("note_quizzes")
          .select(QUIZ_COLUMNS)
          .eq("note_id", noteId)
          .eq("version_id", versionId)
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "Quiz"
      ),

    createQuiz: ({ noteId, versionId, difficulty, questions, modelId = null }) =>
      one(
        db
          .from("note_quizzes")
          .insert({
            owner_id: ownerId,
            note_id: noteId,
            version_id: versionId,
            difficulty,
            questions,
            total_questions: questions.length,
            model_id: modelId,
          })
          .select(QUIZ_COLUMNS)
          .single(),
        "Quiz"
      ),

    getQuiz: (noteId, quizId) =>
      one(db.from("note_quizzes").select(QUIZ_COLUMNS).eq("id", quizId).eq("note_id", noteId).eq("owner_id", ownerId).maybeSingle(), "Quiz"),

    async updateQuizAnswers(quizId, { answers, score, completedAt }) {
      const row = await one(
        db
          .from("note_quizzes")
          .update({ answers, score, completed_at: completedAt })
          .eq("id", quizId)
          .eq("owner_id", ownerId)
          .select(QUIZ_COLUMNS)
          .maybeSingle(),
        "Quiz"
      );
      if (!row) throw notFound("Quiz");
      return row;
    },

    listFlashcards: (noteId, versionId) =>
      one(
        db
          .from("note_flashcards")
          .select(FLASHCARD_COLUMNS)
          .eq("note_id", noteId)
          .eq("version_id", versionId)
          .eq("owner_id", ownerId)
          .order("sort_order", { ascending: true }),
        "Flashcard"
      ),

    async replaceFlashcards({ noteId, versionId, cards }) {
      await one(
        db.from("note_flashcards").delete().eq("note_id", noteId).eq("version_id", versionId).eq("owner_id", ownerId),
        "Flashcard"
      );
      if (!cards.length) return [];
      const rows = cards.map((c, idx) => ({
        owner_id: ownerId,
        note_id: noteId,
        version_id: versionId,
        front: c.front,
        back: c.back,
        hint: c.hint ?? "",
        section_id: c.sectionId ?? null,
        concept: c.concept ?? "",
        sort_order: idx,
      }));
      return one(db.from("note_flashcards").insert(rows).select(FLASHCARD_COLUMNS), "Flashcard");
    },

    getFlashcard: (noteId, cardId) =>
      one(db.from("note_flashcards").select(FLASHCARD_COLUMNS).eq("id", cardId).eq("note_id", noteId).eq("owner_id", ownerId).maybeSingle(), "Flashcard"),

    async updateFlashcardMastery(cardId, { mastery, reviewCount, lastReviewedAt }) {
      const row = await one(
        db
          .from("note_flashcards")
          .update({ mastery, review_count: reviewCount, last_reviewed_at: lastReviewedAt })
          .eq("id", cardId)
          .eq("owner_id", ownerId)
          .select(FLASHCARD_COLUMNS)
          .maybeSingle(),
        "Flashcard"
      );
      if (!row) throw notFound("Flashcard");
      return row;
    },

    getRevisionGuide: (noteId, versionId) =>
      one(
        db
          .from("note_revision_guides")
          .select(REVISION_COLUMNS)
          .eq("note_id", noteId)
          .eq("version_id", versionId)
          .eq("owner_id", ownerId)
          .maybeSingle(),
        "RevisionGuide"
      ),

    async upsertRevisionGuide({ noteId, versionId, guideJson, modelId = null }) {
      const existing = await this.getRevisionGuide(noteId, versionId);
      if (existing) {
        return one(
          db
            .from("note_revision_guides")
            .update({ guide_json: guideJson, model_id: modelId })
            .eq("id", existing.id)
            .eq("owner_id", ownerId)
            .select(REVISION_COLUMNS)
            .single(),
          "RevisionGuide"
        );
      }
      return one(
        db
          .from("note_revision_guides")
          .insert({ owner_id: ownerId, note_id: noteId, version_id: versionId, guide_json: guideJson, model_id: modelId })
          .select(REVISION_COLUMNS)
          .single(),
        "RevisionGuide"
      );
    },
  };
}
