/**
 * Offline doubles for the notes stack. InMemoryNotesDb holds rows for ALL users;
 * repositoryFor(ownerId) returns a view that behaves like the RLS-scoped
 * Supabase repository and mirrors migration 0004's rules (owner scoping,
 * same-owner folder references, cycles, sibling-name uniqueness, immutable
 * versions, atomic save/version/restore/duplicate/delete-folder semantics and
 * draft revision conflicts). The SQL itself is verified in notes.pglite.test.js.
 */
import { randomUUID } from "node:crypto";
import { AppError } from "../../src/utils/errors.js";
import { mapNotesDbError } from "../../src/notes/errors.js";
import { InProcessQueue } from "../../src/generation/inProcessQueue.js";
import { createNotesService } from "../../src/notes/notesService.js";

const clone = (v) => (v === undefined ? v : structuredClone(v));
const pg = (code, message) => mapNotesDbError({ code, message });

export class InMemoryNotesDb {
  constructor(jobStore) {
    this.jobStore = jobStore;
    this.folders = new Map();
    this.notes = new Map();
    this.versions = new Map();
    this.drafts = new Map();
    this.exports = new Map();
    this.quizzes = new Map();
    this.flashcards = new Map();
    this.revisionGuides = new Map();
    this.usageEvents = jobStore?.supabaseState?.usageEvents ?? [];
    this.fail = {};
    this.clock = 0;
  }

  tick() {
    this.clock += 1;
    return new Date(Date.UTC(2026, 10, 26, 0, 0, 0) + this.clock * 1000).toISOString();
  }

  repositoryFor(ownerId) {
    const db = this;
    const mine = (map) => [...map.values()].filter((r) => r.owner_id === ownerId);
    const folderOf = (id) => (id ? [...db.folders.values()].find((f) => f.id === id && f.owner_id === ownerId) : null);

    function assertFolderRef(id) {
      if (id && !folderOf(id)) throw pg("23503", "notes_folder_same_owner");
    }

    function checkCycle(folderId, parentId) {
      let cursor = parentId;
      let depth = 0;
      while (cursor) {
        if (cursor === folderId) throw pg("23514", "folder_cycle");
        depth += 1;
        if (depth > 8) throw pg("23514", "folder_too_deep");
        cursor = db.folders.get(cursor)?.parent_id ?? null;
      }
    }

    function checkSiblingName(name, parentId, exceptId) {
      const key = name.trim().toLowerCase();
      if (mine(db.folders).some((f) => f.id !== exceptId && (f.parent_id ?? null) === (parentId ?? null) && f.name.trim().toLowerCase() === key)) {
        throw pg("23505", "folders_unique_sibling_name");
      }
    }

    function touch(note) {
      note.updated_at = db.tick();
    }

    function addVersion(noteId, { scene, description = "", kind = "snapshot", plan = null, mermaid = null, jobId = null, restoredFrom = null }) {
      const note = db.notes.get(noteId);
      if (!note || note.owner_id !== ownerId) throw pg("P0002", "note_not_found");
      if (kind === "generated" && jobId && [...db.versions.values()].some((v) => v.kind === "generated" && v.created_by_job_id === jobId)) {
        throw pg("23505", "note_versions_one_note_per_job");
      }
      const prev = note.current_version_id ? db.versions.get(note.current_version_id) : null;
      const number = Math.max(0, ...[...db.versions.values()].filter((v) => v.note_id === noteId).map((v) => v.version_number)) + 1;
      const v = {
        id: randomUUID(),
        note_id: noteId,
        owner_id: ownerId,
        version_number: number,
        kind,
        scene_json: clone(scene),
        learning_plan: clone(plan ?? prev?.learning_plan ?? null),
        mermaid_source: mermaid,
        description,
        created_by_job_id: jobId,
        restored_from_version_id: restoredFrom,
        created_at: db.tick(),
      };
      db.versions.set(v.id, v);
      note.current_version_id = v.id;
      touch(note);
      db.drafts.delete(noteId);
      return { id: v.id, version_number: v.version_number, kind: v.kind, created_at: v.created_at };
    }

    function insertNote(fields) {
      const ts = db.tick();
      const note = {
        id: randomUUID(),
        owner_id: ownerId,
        folder_id: fields.folder_id ?? null,
        title: fields.title,
        description: fields.description ?? "",
        subject: fields.subject ?? "",
        topic: fields.topic ?? "",
        tags: fields.tags ?? [],
        is_favorite: false,
        is_archived: false,
        source_type: fields.source_type ?? "prompt",
        current_version_id: null,
        preview_path: null,
        created_at: ts,
        updated_at: ts,
        last_opened_at: null,
      };
      db.notes.set(note.id, note);
      return note;
    }

    return {
      ownerId,
      // folders
      async listFolders() {
        return clone(mine(db.folders).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
      },
      async folderNoteCounts() {
        const counts = {};
        for (const n of mine(db.notes)) if (n.folder_id && !n.is_archived) counts[n.folder_id] = (counts[n.folder_id] ?? 0) + 1;
        return counts;
      },
      async getFolder(id) {
        return clone(folderOf(id) ?? null);
      },
      async createFolder({ name, parentId = null, sortOrder = 0 }) {
        if (parentId && !folderOf(parentId)) throw pg("23503", "folders_parent_same_owner");
        checkSiblingName(name, parentId);
        const id = randomUUID();
        checkCycle(id, parentId);
        const ts = db.tick();
        const f = { id, owner_id: ownerId, name, parent_id: parentId, sort_order: sortOrder, created_at: ts, updated_at: ts };
        db.folders.set(id, f);
        return clone(f);
      },
      async updateFolder(id, patch) {
        const f = folderOf(id);
        if (!f) throw new AppError(404, "NOT_FOUND", "Folder not found.");
        const next = { ...f, ...patch };
        if (next.parent_id && next.parent_id === id) throw pg("23514", "folders_not_own_parent");
        if (patch.parent_id !== undefined && patch.parent_id && !folderOf(patch.parent_id)) throw pg("23503", "folders_parent_same_owner");
        if (patch.parent_id !== undefined) checkCycle(id, patch.parent_id);
        if (patch.name !== undefined || patch.parent_id !== undefined) checkSiblingName(next.name, next.parent_id, id);
        Object.assign(f, patch, { updated_at: db.tick() });
        return clone(f);
      },
      async deleteFolder(id) {
        const f = folderOf(id);
        if (!f) throw pg("P0002", "folder_not_found");
        for (const n of mine(db.notes)) if (n.folder_id === id) n.folder_id = null;
        for (const c of mine(db.folders)) if (c.parent_id === id) c.parent_id = f.parent_id;
        db.folders.delete(id);
      },

      // notes
      async listNotes({ q, folderId, tags, favorite, archived, sort, limit, offset }) {
        if (db.fail.list) throw pg("XX000", "boom");
        let rows = mine(db.notes);
        if (folderId === "root") rows = rows.filter((n) => !n.folder_id);
        else if (folderId) rows = rows.filter((n) => n.folder_id === folderId);
        if (archived !== "all") rows = rows.filter((n) => n.is_archived === (archived === "true"));
        if (favorite) rows = rows.filter((n) => n.is_favorite);
        if (tags?.length) rows = rows.filter((n) => tags.every((t) => n.tags.includes(t)));
        if (q) {
          const needle = q.toLowerCase();
          rows = rows.filter((n) => [n.title, n.description, n.subject].some((s) => s.toLowerCase().includes(needle)) || n.tags.includes(needle));
        }
        const cmp = {
          title: (a, b) => a.title.localeCompare(b.title),
          created_at: (a, b) => b.created_at.localeCompare(a.created_at),
          updated_at: (a, b) => b.updated_at.localeCompare(a.updated_at),
          last_opened_at: (a, b) => (b.last_opened_at ?? "").localeCompare(a.last_opened_at ?? ""),
        }[sort];
        rows.sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
        return { items: clone(rows.slice(offset, offset + limit)), total: rows.length };
      },
      async getNote(id) {
        const n = db.notes.get(id);
        return n && n.owner_id === ownerId ? clone(n) : null;
      },
      async createFromJob({ jobId, title, folderId, description, subject, tags, scene }) {
        const job = await db.jobStore.getJob({ ownerId, jobId });
        if (!job) throw pg("P0002", "job_not_found");
        if (job.status !== "completed" || !job.scene_json) throw pg("22023", "job_not_completed");
        assertFolderRef(folderId);
        if ([...db.versions.values()].some((v) => v.kind === "generated" && v.created_by_job_id === jobId)) {
          throw pg("23505", "note_versions_one_note_per_job"); // whole transaction rolls back
        }
        const note = insertNote({ folder_id: folderId, title, description, subject, tags, source_type: job.input_type ?? "prompt" });
        const v = addVersion(note.id, { scene: scene ?? job.scene_json, description: "Generated", kind: "generated", plan: job.learning_plan, mermaid: job.mermaid_source, jobId });
        return { noteId: note.id, versionId: v.id };
      },
      async findNoteForJob(jobId) {
        return [...db.versions.values()].find((v) => v.owner_id === ownerId && v.kind === "generated" && v.created_by_job_id === jobId)?.note_id ?? null;
      },
      async updateNote(id, patch) {
        const n = db.notes.get(id);
        if (!n || n.owner_id !== ownerId) throw new AppError(404, "NOT_FOUND", "Note not found.");
        if (patch.folder_id !== undefined) assertFolderRef(patch.folder_id);
        const contentKeys = Object.keys(patch).filter((k) => !["last_opened_at", "preview_path"].includes(k));
        Object.assign(n, clone(patch));
        if (contentKeys.length) touch(n);
        return clone(n);
      },
      async markOpened(id) {
        const n = db.notes.get(id);
        if (n && n.owner_id === ownerId) n.last_opened_at = db.tick();
      },
      async duplicate(id, title) {
        const src = db.notes.get(id);
        if (!src || src.owner_id !== ownerId) throw pg("P0002", "note_not_found");
        const version = db.versions.get(src.current_version_id);
        const scene = db.drafts.get(id)?.scene_json ?? version?.scene_json;
        const note = insertNote({ folder_id: src.folder_id, title, description: src.description, subject: src.subject, topic: src.topic, tags: [...src.tags], source_type: src.source_type });
        const v = addVersion(note.id, { scene, description: `Duplicated from "${src.title}"`, kind: "duplicate", plan: version?.learning_plan, mermaid: version?.mermaid_source });
        return { noteId: note.id, versionId: v.id };
      },
      async deleteNote(id) {
        const n = db.notes.get(id);
        if (!n || n.owner_id !== ownerId) throw new AppError(404, "NOT_FOUND", "Note not found.");
        db.notes.delete(id);
        for (const [k, v] of db.versions) if (v.note_id === id) db.versions.delete(k);
        for (const [k, e] of db.exports) if (e.note_id === id) db.exports.delete(k);
        db.drafts.delete(id);
        for (const row of db.jobStore.rows.values()) if (row.note_id === id) row.note_id = null;
      },

      // versions
      async listVersions(noteId) {
        return clone([...db.versions.values()].filter((v) => v.note_id === noteId && v.owner_id === ownerId).sort((a, b) => b.version_number - a.version_number));
      },
      async getVersion(noteId, versionId) {
        const v = db.versions.get(versionId);
        return v && v.note_id === noteId && v.owner_id === ownerId ? clone(v) : null;
      },
      async addVersion(noteId, { scene, description, kind, learningPlan = null, mermaidSource = null }) {
        return addVersion(noteId, { scene, description, kind, plan: learningPlan, mermaid: mermaidSource });
      },
      async restoreVersion(noteId, versionId) {
        const src = db.versions.get(versionId);
        if (!src || src.note_id !== noteId || src.owner_id !== ownerId) throw pg("P0002", "version_not_found");
        const draft = db.drafts.get(noteId);
        if (draft) addVersion(noteId, { scene: draft.scene_json, description: "Autosaved changes kept before restore", kind: "draft" });
        return addVersion(noteId, { scene: src.scene_json, description: `Restored from version ${src.version_number}`, kind: "restore", plan: src.learning_plan, mermaid: src.mermaid_source, restoredFrom: src.id });
      },

      // drafts
      async getDraft(noteId) {
        const d = db.drafts.get(noteId);
        return d && d.owner_id === ownerId ? clone(d) : null;
      },
      async saveDraft(noteId, scene, baseRevision) {
        const conflict = () => new AppError(409, "DRAFT_CONFLICT", "This note was changed in another tab or window. Reload to get the latest version.");
        const note = db.notes.get(noteId);
        const existing = db.drafts.get(noteId);
        if (baseRevision === 0) {
          if (!note || note.owner_id !== ownerId) throw new AppError(404, "NOT_FOUND", "Note not found.");
          if (existing) throw conflict();
          const d = { note_id: noteId, owner_id: ownerId, scene_json: clone(scene), revision: 1, updated_at: db.tick() };
          db.drafts.set(noteId, d);
          touch(note);
          return { revision: 1, updated_at: d.updated_at };
        }
        if (!existing || existing.owner_id !== ownerId || existing.revision !== baseRevision) throw conflict();
        Object.assign(existing, { scene_json: clone(scene), revision: baseRevision + 1, updated_at: db.tick() });
        touch(note);
        return { revision: existing.revision, updated_at: existing.updated_at };
      },

      // exports
      async createExport({ noteId, versionId, format, scope = "full", frameId = null, theme, transparent, source }) {
        const e = { id: randomUUID(), owner_id: ownerId, note_id: noteId, version_id: versionId, format, scope, frame_id: frameId, theme, transparent, source, object_path: null, width: null, height: null, bytes: null, status: "processing", error_code: null, safe_error_message: null, created_at: db.tick(), finished_at: null };
        db.exports.set(e.id, e);
        return clone(e);
      },
      async updateExport(id, patch) {
        const e = db.exports.get(id);
        if (!e || e.owner_id !== ownerId) throw new AppError(404, "NOT_FOUND", "Export not found.");
        if (patch.object_path && !patch.object_path.startsWith(`${ownerId}/${e.note_id}/`)) throw pg("23514", "note_exports_object_path_owner");
        Object.assign(e, clone(patch));
        return clone(e);
      },
      async getExport(id) {
        const e = db.exports.get(id);
        return e && e.owner_id === ownerId ? clone(e) : null;
      },
      async exportPaths(noteId) {
        return [...db.exports.values()].filter((e) => e.note_id === noteId && e.owner_id === ownerId && e.object_path).map((e) => e.object_path);
      },

      // Phase 5 study companion
      async getLatestQuiz(noteId, versionId) {
        const list = [...db.quizzes.values()].filter((q) => q.owner_id === ownerId && q.note_id === noteId && q.version_id === versionId).sort((a, b) => b.created_at.localeCompare(a.created_at));
        return clone(list[0] ?? null);
      },
      async createQuiz({ noteId, versionId, difficulty, questions, modelId = null }) {
        const ts = db.tick();
        const row = { id: randomUUID(), owner_id: ownerId, note_id: noteId, version_id: versionId, difficulty, questions: clone(questions), answers: {}, score: null, total_questions: questions.length, completed_at: null, model_id: modelId, created_at: ts, updated_at: ts };
        db.quizzes.set(row.id, row);
        return clone(row);
      },
      async getQuiz(noteId, quizId) {
        const q = db.quizzes.get(quizId);
        return q && q.owner_id === ownerId && q.note_id === noteId ? clone(q) : null;
      },
      async updateQuizAnswers(quizId, { answers, score, completedAt }) {
        const q = db.quizzes.get(quizId);
        if (!q || q.owner_id !== ownerId) throw notFound("Quiz");
        Object.assign(q, { answers: clone(answers), score, completed_at: completedAt, updated_at: db.tick() });
        return clone(q);
      },
      async listFlashcards(noteId, versionId) {
        return clone([...db.flashcards.values()].filter((c) => c.owner_id === ownerId && c.note_id === noteId && c.version_id === versionId).sort((a, b) => a.sort_order - b.sort_order));
      },
      async replaceFlashcards({ noteId, versionId, cards }) {
        for (const [k, c] of db.flashcards) if (c.owner_id === ownerId && c.note_id === noteId && c.version_id === versionId) db.flashcards.delete(k);
        const inserted = [];
        const ts = db.tick();
        for (let i = 0; i < cards.length; i++) {
          const c = cards[i];
          const row = { id: randomUUID(), owner_id: ownerId, note_id: noteId, version_id: versionId, front: c.front, back: c.back, hint: c.hint ?? "", section_id: c.sectionId ?? null, concept: c.concept ?? "", sort_order: i, mastery: "new", review_count: 0, last_reviewed_at: null, created_at: ts, updated_at: ts };
          db.flashcards.set(row.id, row);
          inserted.push(clone(row));
        }
        return inserted;
      },
      async getFlashcard(noteId, cardId) {
        const c = db.flashcards.get(cardId);
        return c && c.owner_id === ownerId && c.note_id === noteId ? clone(c) : null;
      },
      async updateFlashcardMastery(cardId, { mastery, reviewCount, lastReviewedAt }) {
        const c = db.flashcards.get(cardId);
        if (!c || c.owner_id !== ownerId) throw notFound("Flashcard");
        Object.assign(c, { mastery, review_count: reviewCount, last_reviewed_at: lastReviewedAt, updated_at: db.tick() });
        return clone(c);
      },
      async getRevisionGuide(noteId, versionId) {
        const g = [...db.revisionGuides.values()].find((r) => r.owner_id === ownerId && r.note_id === noteId && r.version_id === versionId);
        return clone(g ?? null);
      },
      async upsertRevisionGuide({ noteId, versionId, guideJson, modelId = null }) {
        const existing = [...db.revisionGuides.values()].find((r) => r.owner_id === ownerId && r.note_id === noteId && r.version_id === versionId);
        const ts = db.tick();
        if (existing) {
          Object.assign(existing, { guide_json: clone(guideJson), model_id: modelId, updated_at: ts });
          return clone(existing);
        }
        const row = { id: randomUUID(), owner_id: ownerId, note_id: noteId, version_id: versionId, guide_json: clone(guideJson), model_id: modelId, created_at: ts, updated_at: ts };
        db.revisionGuides.set(row.id, row);
        return clone(row);
      },
    };
  }
}

/** Private storage emulation: objects keyed by bucket/path, owner-folder enforced like the RLS policies. */
export class InMemoryNoteStorage {
  constructor() {
    this.objects = new Map();
    this.fail = {};
    this.signed = [];
  }

  forUser(userId) {
    const store = this;
    const owns = (path) => path.split("/")[0] === userId;
    return {
      async upload(bucket, path, buffer, contentType) {
        if (store.fail.upload) throw Object.assign(new AppError(502, "STORAGE_ERROR", "We couldn't access your files. Please try again."), {});
        if (!owns(path)) throw new AppError(502, "STORAGE_ERROR", "denied");
        store.objects.set(`${bucket}/${path}`, { buffer: Buffer.from(buffer), contentType });
      },
      async remove(bucket, paths) {
        if (store.fail.remove) throw new AppError(502, "STORAGE_ERROR", "We couldn't access your files. Please try again.");
        for (const p of paths) if (owns(p)) store.objects.delete(`${bucket}/${p}`);
      },
      async listUnder(bucket, prefix) {
        if (!owns(prefix)) return [];
        return [...store.objects.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}/`)).map((k) => k.slice(bucket.length + 1));
      },
      async sign(bucket, path, ttl, { download } = {}) {
        if (!owns(path) || !store.objects.has(`${bucket}/${path}`)) return null;
        store.signed.push({ bucket, path, ttl, download });
        return { url: `https://storage.test/${bucket}/${path}?ttl=${ttl}${download ? `&download=${encodeURIComponent(download)}` : ""}`, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
      },
      async signMany(bucket, paths, ttl) {
        const out = {};
        for (const p of paths) if (owns(p) && store.objects.has(`${bucket}/${p}`)) out[p] = `https://storage.test/${bucket}/${p}?ttl=${ttl}`;
        return out;
      },
    };
  }
}

/** Fake CLI renderer: deterministic tiny PNG/SVG with recorded calls. */
export function createFakeRenderer() {
  const r = {
    calls: [],
    fail: false,
    async render({ scene, format, theme, transparent }) {
      r.calls.push({ format, theme, transparent, elements: scene.elements.length });
      if (r.fail) throw Object.assign(new Error("Excalidraw CLI failed at C:\\srv\\secret"), { code: "CLI_EXEC_FAILED" });
      if (format === "png") {
        const buf = Buffer.alloc(32);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
        buf.writeUInt32BE(800, 16);
        buf.writeUInt32BE(600, 20);
        return { buffer: buf, width: 800, height: 600, bytes: buf.length };
      }
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" data-theme="${theme}"></svg>`);
      return { buffer: svg, width: 800, height: 600, bytes: svg.length };
    },
  };
  return r;
}

export function createFakeCompanion({ enabled = true } = {}) {
  return {
    enabled,
    calls: [],
    failWith: null,
    async explainSelection(args) {
      this.calls.push({ op: "explainSelection", args });
      if (this.failWith) throw this.failWith;
      return {
        explanation: "Selected element represents the TCP SYN handshake step.",
        analogy: "Like knocking on a door before speaking.",
        keyPoint: "Client picks an initial sequence number.",
        relatedConcepts: ["SYN", "Handshake"],
        model: "gemini-mock",
        usageMetadata: { totalTokenCount: 120 },
      };
    },
    async generateQuiz(args) {
      this.calls.push({ op: "generateQuiz", args });
      if (this.failWith) throw this.failWith;
      return {
        questions: [
          { id: "q1", question: "First TCP handshake packet?", options: ["SYN", "FIN", "RST", "PSH"], correctIndex: 0, explanation: "Client sends SYN first.", sectionId: args.learningPlan?.sections?.[0]?.id ?? null, concept: "SYN", sourceRefs: [] },
          { id: "q2", question: "Server replies with?", options: ["ACK", "SYN-ACK", "URG", "EOF"], correctIndex: 1, explanation: "Server sends SYN-ACK.", sectionId: null, concept: "SYN-ACK", sourceRefs: [] },
          { id: "q3", question: "Final handshake step?", options: ["ACK", "DROP", "PING", "HELLO"], correctIndex: 0, explanation: "Client sends ACK.", sectionId: null, concept: "ACK", sourceRefs: [] },
        ],
        model: "gemini-mock",
        usageMetadata: { totalTokenCount: 220 },
      };
    },
    async generateFlashcards(args) {
      this.calls.push({ op: "generateFlashcards", args });
      if (this.failWith) throw this.failWith;
      return {
        cards: [
          { front: "SYN", back: "Synchronize sequence numbers.", hint: "Step 1", sectionId: args.learningPlan?.sections?.[0]?.id ?? null, concept: "SYN" },
          { front: "SYN-ACK", back: "Server acknowledge + sequence.", hint: "Step 2", sectionId: null, concept: "SYN-ACK" },
          { front: "ACK", back: "Confirms receipt.", hint: "Step 3", sectionId: null, concept: "ACK" },
          { front: "ESTABLISHED", back: "Ready for data.", hint: "State", sectionId: null, concept: "State" },
        ],
        model: "gemini-mock",
        usageMetadata: { totalTokenCount: 180 },
      };
    },
    async generateRevisionGuide(args) {
      this.calls.push({ op: "generateRevisionGuide", args });
      if (this.failWith) throw this.failWith;
      return {
        summary: "Three-way handshake establishes reliable ordered streams.",
        keyTerms: [{ term: "SYN", definition: "Synchronize packet." }],
        commonConfusions: [{ misconception: "TCP starts in 2 packets", correction: "It takes 3 packets (SYN, SYN-ACK, ACK)." }],
        selfCheck: [
          { question: "Who sends SYN?", answer: "Client" },
          { question: "Who sends SYN-ACK?", answer: "Server" },
          { question: "What is ACK?", answer: "Acknowledgement" },
        ],
        model: "gemini-mock",
        usageMetadata: { totalTokenCount: 240 },
      };
    },
    async askNote(args) {
      this.calls.push({ op: "askNote", args });
      if (this.failWith) throw this.failWith;
      const sid = args.learningPlan?.sections?.[0]?.id ?? null;
      return {
        answer: "Based on section 1, SYN initiates the connection.",
        grounded: true,
        citations: sid ? [{ label: "1. Handshake", sectionId: sid, snippet: "SYN initiates." }] : [],
        model: "gemini-mock",
        usageMetadata: { totalTokenCount: 140 },
      };
    },
    async regenerateSectionPlan(args) {
      this.calls.push({ op: "regenerateSectionPlan", args });
      if (this.failWith) throw this.failWith;
      return {
        section: {
          id: args.sectionId,
          title: args.updatedTitle ?? "Updated Section",
          visualType: args.updatedVisualType ?? "flowchart",
          keyConcepts: ["Updated Concept"],
          relationships: [],
          explanation: args.updatedExplanation ?? "Updated explanation.",
          sourceRefs: [],
          diagramSpec: {
            kind: "flowchart",
            direction: "LR",
            nodes: [{ id: "a", label: "Start" }, { id: "b", label: "End" }],
            edges: [{ from: "a", to: "b", label: "next" }],
          },
        },
        model: "gemini-mock",
        usageMetadata: { totalTokenCount: 190 },
      };
    },
  };
}

export function createTestNotesStack({ generation, logger, companionEnabled = true, usageService = null }) {
  const db = new InMemoryNotesDb(generation.store);
  const storage = new InMemoryNoteStorage();
  const renderer = createFakeRenderer();
  const tasks = new InProcessQueue({ concurrency: 1, logger });
  const companion = createFakeCompanion({ enabled: companionEnabled });
  const compileSection = async () => ({
    strategy: "direct_scene",
    kind: "flowchart",
    mermaidSource: null,
    scene: {
      elements: [{ id: "regen_box", type: "rectangle", x: 0, y: 0, width: 120, height: 60, strokeColor: "#0f766e", backgroundColor: "#ccfbf1" }],
    },
  });
  const usageRecorder = async (ev) => db.usageEvents.push(ev);
  const service = createNotesService({ renderer, jobStore: generation.store, tasks, companion, compileSection, usageRecorder, usageService, logger });
  const contextFor = (req) => ({ userId: req.user.id, db: req.db, repo: db.repositoryFor(req.user.id), files: storage.forUser(req.user.id) });
  return { service, contextFor, db, storage, renderer, companion, tasks };
}
