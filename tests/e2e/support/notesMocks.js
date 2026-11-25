/**
 * Contract-faithful, stateful mock of /api/v1/notes*, /api/v1/folders*,
 * /api/v1/exports* for Playwright (same envelope, status codes and rules as
 * the Express API: owner-free DTOs, draft revisions with 409 conflicts,
 * non-destructive restore, filters/sort/paging). Export download URLs point at
 * STORAGE_ORIGIN, which serves files with Content-Disposition: attachment.
 */
import { randomUUID } from "node:crypto";

export const STORAGE_ORIGIN = "https://storage.e2e.test";

const now = () => new Date().toISOString();
const clone = (v) => structuredClone(v);
const slug = (t) => t.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").slice(0, 60) || "visualify-note";

export function createNotesMock({ generations = null, sources = null } = {}) {
  const m = { notes: new Map(), folders: new Map(), versions: new Map(), drafts: new Map(), exports: new Map(), quizzes: new Map(), flashcards: new Map(), revisionGuides: new Map(), calls: [] };

  function addVersion(noteId, { scene, kind, description = "", plan, restoredFrom = null }) {
    const note = m.notes.get(noteId);
    const prev = note.currentVersionId ? m.versions.get(note.currentVersionId) : null;
    const number = Math.max(0, ...[...m.versions.values()].filter((v) => v.noteId === noteId).map((v) => v.versionNumber)) + 1;
    const v = { id: randomUUID(), noteId, versionNumber: number, kind, description, restoredFromVersionId: restoredFrom, createdAt: now(), sceneJson: clone(scene), learningPlan: clone(plan ?? prev?.learningPlan ?? null) };
    m.versions.set(v.id, v);
    note.currentVersionId = v.id;
    note.updatedAt = now();
    m.drafts.delete(noteId);
    return v;
  }

  function createNote({ title, scene, plan, folderId = null, subject = "", tags = [], kind = "generated", sourceType = "prompt", sourceFile = null }) {
    const id = randomUUID();
    m.notes.set(id, { id, title, description: plan?.summary ?? "", subject, topic: "", tags, folderId, isFavorite: false, isArchived: false, sourceType, sourceFile, currentVersionId: null, hasPreview: false, previewUrl: null, createdAt: now(), updatedAt: now(), lastOpenedAt: null });
    addVersion(id, { scene, kind, description: kind === "generated" ? "Generated" : "", plan });
    return m.notes.get(id);
  }

  const meta = (v, currentId) => ({ id: v.id, versionNumber: v.versionNumber, kind: v.kind, description: v.description, restoredFromVersionId: v.restoredFromVersionId, isCurrent: v.id === currentId, createdAt: v.createdAt });

  function detail(note) {
    const v = m.versions.get(note.currentVersionId);
    const d = m.drafts.get(note.id);
    return {
      note: clone(note),
      sourceFile: note.sourceFile ? clone(note.sourceFile) : null,
      currentVersion: v ? { ...meta(v, note.currentVersionId), learningPlan: v.learningPlan, mermaidSource: null } : null,
      draft: d ? { revision: d.revision, updatedAt: d.updatedAt } : null,
      draftRevision: d?.revision ?? 0,
      sceneJson: clone(d?.sceneJson ?? v?.sceneJson ?? null),
    };
  }

  function folderDto(f) {
    const count = [...m.notes.values()].filter((n) => n.folderId === f.id && !n.isArchived).length;
    return { ...clone(f), noteCount: count };
  }

  m.seedNote = (fields) => createNote(fields);

  m.handle = ({ route, req, url, json, ok, fail }) => {
    const parts = url.pathname.split("/").filter(Boolean).slice(2); // after api/v1
    const method = req.method();
    const body = ["POST", "PUT", "PATCH"].includes(method) ? req.postDataJSON() ?? {} : {};
    m.calls.push({ method, path: url.pathname, body: clone(body) });
    const notFound = (what = "Note") => json(404, fail("NOT_FOUND", `${what} not found.`));

    // ---- folders ----
    if (parts[0] === "folders") {
      const id = parts[1];
      if (!id && method === "GET") return json(200, ok({ items: [...m.folders.values()].map(folderDto) }));
      if (!id && method === "POST") {
        const name = String(body.name ?? "").trim();
        if (!name) return json(400, fail("VALIDATION_ERROR", "Some fields are invalid.", [{ field: "name", message: "Enter a folder name." }]));
        const dup = [...m.folders.values()].some((f) => (f.parentId ?? null) === (body.parentId ?? null) && f.name.toLowerCase() === name.toLowerCase());
        if (dup) return json(409, fail("FOLDER_NAME_TAKEN", "A folder with that name already exists here."));
        const f = { id: randomUUID(), name, parentId: body.parentId ?? null, sortOrder: 0, createdAt: now(), updatedAt: now() };
        m.folders.set(f.id, f);
        return json(201, ok({ folder: folderDto(f) }));
      }
      const f = m.folders.get(id);
      if (!f) return notFound("Folder");
      if (method === "PATCH") {
        if (body.parentId === id) return json(400, fail("FOLDER_CYCLE", "A folder can't be moved into itself or one of its subfolders."));
        Object.assign(f, body.name !== undefined ? { name: body.name } : {}, body.parentId !== undefined ? { parentId: body.parentId } : {}, { updatedAt: now() });
        return json(200, ok({ folder: folderDto(f) }));
      }
      if (method === "DELETE") {
        for (const n of m.notes.values()) if (n.folderId === id) n.folderId = null;
        for (const c of m.folders.values()) if (c.parentId === id) c.parentId = f.parentId;
        m.folders.delete(id);
        return json(200, ok({ deleted: true }));
      }
    }

    // ---- exports ----
    if (parts[0] === "exports") {
      const e = m.exports.get(parts[1]);
      return e ? json(200, ok({ export: clone(e) })) : notFound("Export");
    }

    // ---- notes ----
    if (parts[0] !== "notes") return notFound();
    const id = parts[1];
    if (!id && method === "GET") {
      const q = url.searchParams;
      let rows = [...m.notes.values()];
      const folderId = q.get("folderId");
      if (folderId === "root") rows = rows.filter((n) => !n.folderId);
      else if (folderId) rows = rows.filter((n) => n.folderId === folderId);
      const archived = q.get("archived") ?? "false";
      if (archived !== "all") rows = rows.filter((n) => n.isArchived === (archived === "true"));
      if (q.get("favorite") === "true") rows = rows.filter((n) => n.isFavorite);
      const tags = (q.get("tags") ?? "").split(",").filter(Boolean);
      if (tags.length) rows = rows.filter((n) => tags.every((t) => n.tags.includes(t)));
      const term = (q.get("q") ?? "").toLowerCase();
      if (term) rows = rows.filter((n) => [n.title, n.description, n.subject].some((s) => s.toLowerCase().includes(term)) || n.tags.includes(term));
      const sort = q.get("sort") ?? "updated_at";
      const key = { updated_at: "updatedAt", created_at: "createdAt", last_opened_at: "lastOpenedAt" }[sort];
      rows.sort((a, b) => (sort === "title" ? a.title.localeCompare(b.title) : String(b[key] ?? "").localeCompare(String(a[key] ?? ""))));
      const limit = Number(q.get("limit") ?? 24);
      const offset = Number(q.get("offset") ?? 0);
      return json(200, ok({ items: clone(rows.slice(offset, offset + limit)), total: rows.length, limit, offset }));
    }
    if (!id && method === "POST") {
      const job = generations?.jobs.get(body.jobId);
      if (!job) return notFound("Generation");
      if (job.status !== "completed") return json(409, fail("JOB_NOT_COMPLETED", "Only completed generations can be saved."));
      const existing = [...m.notes.values()].find((n) => n.jobId === body.jobId);
      if (existing) return json(409, fail("JOB_ALREADY_SAVED", "This visual is already in your library.", { noteId: existing.id }));
      const sf = job.sourceFileId ? (sources?.get(job.sourceFileId) ?? job.sourceFile ?? null) : null;
      const note = createNote({
        title: body.title ?? job.learningPlan.title,
        scene: body.sceneJson ?? job.sceneJson,
        plan: job.learningPlan,
        folderId: body.folderId ?? null,
        sourceType: job.inputType ?? "prompt",
        sourceFile: sf,
      });
      note.jobId = body.jobId;
      return json(201, ok(detail(note)));
    }

    const note = m.notes.get(id);
    if (!note) return notFound();
    const action = parts[2];

    if (!action && method === "GET") {
      note.lastOpenedAt = now();
      return json(200, ok(detail(note)));
    }
    if (!action && method === "PATCH") {
      const map = { title: "title", folderId: "folderId", tags: "tags", isFavorite: "isFavorite", isArchived: "isArchived", subject: "subject" };
      for (const [k, f] of Object.entries(map)) if (body[k] !== undefined) note[f] = body[k];
      note.updatedAt = now();
      return json(200, ok({ note: clone(note) }));
    }
    if (!action && method === "DELETE") {
      m.notes.delete(id);
      for (const [k, v] of m.versions) if (v.noteId === id) m.versions.delete(k);
      m.drafts.delete(id);
      return json(200, ok({ deleted: true, removedFiles: 0 }));
    }
    if (action === "duplicate" && method === "POST") {
      const d = detail(note);
      const copy = createNote({ title: body.title ?? `Copy of ${note.title}`, scene: d.sceneJson, plan: d.currentVersion?.learningPlan, folderId: note.folderId, kind: "duplicate" });
      return json(201, ok({ note: clone(copy) }));
    }
    if (action === "versions" && method === "GET" && !parts[3]) {
      const items = [...m.versions.values()].filter((v) => v.noteId === id).sort((a, b) => b.versionNumber - a.versionNumber).map((v) => meta(v, note.currentVersionId));
      return json(200, ok({ items }));
    }
    if (action === "versions" && method === "GET" && parts[3]) {
      const v = m.versions.get(parts[3]);
      if (!v || v.noteId !== id) return notFound("Version");
      return json(200, ok({ version: { ...meta(v, note.currentVersionId), sceneJson: v.sceneJson, learningPlan: v.learningPlan } }));
    }
    if (action === "versions" && method === "POST") {
      const v = addVersion(id, { scene: body.sceneJson, kind: "snapshot", description: body.description ?? "" });
      return json(201, ok({ version: meta(v, v.id), draftRevision: 0 }));
    }
    if (action === "restore" && method === "POST") {
      const src = m.versions.get(parts[3]);
      if (!src || src.noteId !== id) return notFound("Version");
      const draft = m.drafts.get(id);
      if (draft) addVersion(id, { scene: draft.sceneJson, kind: "draft", description: "Autosaved changes kept before restore" });
      const v = addVersion(id, { scene: src.sceneJson, kind: "restore", description: `Restored from version ${src.versionNumber}`, plan: src.learningPlan, restoredFrom: src.id });
      return json(201, ok({ version: meta(v, v.id), sceneJson: clone(v.sceneJson), draftRevision: 0 }));
    }
    if (action === "draft" && method === "PUT") {
      const d = m.drafts.get(id);
      const base = body.baseRevision;
      if ((base === 0 && d) || (base > 0 && (!d || d.revision !== base))) {
        return json(409, fail("DRAFT_CONFLICT", "This note was changed in another tab or window. Reload to get the latest version."));
      }
      const next = { sceneJson: clone(body.sceneJson), revision: base + 1, updatedAt: now() };
      m.drafts.set(id, next);
      note.updatedAt = now();
      return json(200, ok({ revision: next.revision, savedAt: next.updatedAt }));
    }
    if (action === "exports" && method === "POST") {
      if (!["png", "svg", "excalidraw", "zip"].includes(body.format)) return json(400, fail("VALIDATION_ERROR", "Choose png, svg, excalidraw or zip."));
      const d = detail(note);
      const exportId = randomUUID();
      const file = `${slug(note.title)}.${body.format}`;
      const e = {
        id: exportId,
        noteId: id,
        versionId: note.currentVersionId,
        format: body.format,
        scope: body.scope ?? "full",
        frameId: body.frameId ?? null,
        theme: body.theme ?? "light",
        transparent: body.format === "excalidraw" ? false : Boolean(body.transparent),
        source: m.drafts.has(id) ? "draft" : "version",
        status: "completed",
        width: body.format === "excalidraw" || body.format === "zip" ? null : 800,
        height: body.format === "excalidraw" || body.format === "zip" ? null : 600,
        bytes: 1234,
        downloadUrl: `${STORAGE_ORIGIN}/download/${exportId}/${encodeURIComponent(file)}`,
        downloadExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        error: null,
        createdAt: now(),
        finishedAt: now(),
        elements: d.sceneJson?.elements?.length ?? 0,
      };
      m.exports.set(exportId, e);
      return json(201, ok({ export: clone(e) }));
    }
    if (action === "study" && method === "GET") {
      const key = `${id}:${note.currentVersionId}`;
      return json(200, ok({
        versionId: note.currentVersionId,
        quiz: clone(m.quizzes.get(key) ?? null),
        flashcards: clone(m.flashcards.get(key) ?? []),
        revisionGuide: clone(m.revisionGuides.get(key) ?? null),
      }));
    }
    if (action === "explain" && method === "POST") {
      const firstText = body.selectedElements?.[0]?.text || "selected node";
      return json(200, ok({
        explanation: `${firstText} participates in the visual workflow shown in this note.`,
        analogy: "Think of it as a checkpoint on an assembly line.",
        keyPoint: `Role of ${firstText}`,
        relatedConcepts: ["Relational", "Document"],
      }));
    }
    if (action === "quiz" && method === "POST" && !parts[3]) {
      const key = `${id}:${note.currentVersionId}`;
      const quiz = {
        id: randomUUID(),
        noteId: id,
        versionId: note.currentVersionId,
        difficulty: body.difficulty ?? "mixed",
        questions: [
          { id: "q1", question: "Which database stores fixed relational tables?", options: ["SQL", "Key-value", "Blob", "DNS"], correctIndex: 0, explanation: "SQL databases use relational tables.", sectionId: "families", concept: "Relational", sourceRefs: [] },
          { id: "q2", question: "Which database uses flexible schemas?", options: ["CSV", "NoSQL", "ARP", "SMTP"], correctIndex: 1, explanation: "NoSQL favours flexible schemas.", sectionId: "sql_vs_nosql", concept: "Schema", sourceRefs: [] },
          { id: "q3", question: "What example of SQL was listed?", options: ["MongoDB", "Postgres", "Redis", "Memcached"], correctIndex: 1, explanation: "Postgres is relational.", sectionId: "families", concept: "Postgres", sourceRefs: [] },
        ],
        answers: {},
        score: null,
        totalQuestions: 3,
        completedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      m.quizzes.set(key, quiz);
      m.quizzes.set(quiz.id, quiz);
      return json(201, ok({ quiz: clone(quiz) }));
    }
    if (action === "quiz" && method === "PATCH" && parts[3]) {
      const quiz = m.quizzes.get(parts[3]);
      if (!quiz || quiz.noteId !== id) return notFound("Quiz");
      let score = 0;
      for (const q of quiz.questions) if (body.answers?.[q.id] === q.correctIndex) score += 1;
      quiz.answers = clone(body.answers ?? {});
      quiz.score = score;
      quiz.completedAt = now();
      quiz.updatedAt = now();
      m.quizzes.set(`${id}:${quiz.versionId}`, quiz);
      return json(200, ok({ quiz: clone(quiz) }));
    }
    if (action === "flashcards" && method === "POST" && !parts[3]) {
      const key = `${id}:${note.currentVersionId}`;
      const cards = [
        { id: randomUUID(), noteId: id, versionId: note.currentVersionId, front: "Relational DB", back: "Fixed tables with foreign keys.", hint: "SQL", sectionId: "families", concept: "Relational", sortOrder: 0, mastery: "new", reviewCount: 0, lastReviewedAt: null },
        { id: randomUUID(), noteId: id, versionId: note.currentVersionId, front: "Document DB", back: "Stores semi-structured JSON documents.", hint: "MongoDB", sectionId: "families", concept: "Document", sortOrder: 1, mastery: "new", reviewCount: 0, lastReviewedAt: null },
        { id: randomUUID(), noteId: id, versionId: note.currentVersionId, front: "Horizontal Scaling", back: "Distributes shards across nodes.", hint: "NoSQL", sectionId: "sql_vs_nosql", concept: "Scaling", sortOrder: 2, mastery: "new", reviewCount: 0, lastReviewedAt: null },
        { id: randomUUID(), noteId: id, versionId: note.currentVersionId, front: "Postgres", back: "Open-source relational database.", hint: "SQL", sectionId: "families", concept: "Postgres", sortOrder: 3, mastery: "new", reviewCount: 0, lastReviewedAt: null },
      ];
      m.flashcards.set(key, cards);
      for (const c of cards) m.flashcards.set(c.id, c);
      return json(201, ok({ items: clone(cards) }));
    }
    if (action === "flashcards" && method === "PATCH" && parts[3]) {
      const card = m.flashcards.get(parts[3]);
      if (!card || card.noteId !== id) return notFound("Flashcard");
      card.mastery = body.mastery ?? "known";
      card.reviewCount += 1;
      card.lastReviewedAt = now();
      return json(200, ok({ flashcard: clone(card) }));
    }
    if (action === "revision" && method === "POST") {
      const key = `${id}:${note.currentVersionId}`;
      const guide = {
        id: randomUUID(),
        noteId: id,
        versionId: note.currentVersionId,
        summary: "Condensed comparison of SQL relational guarantees and NoSQL flexible scaling.",
        keyTerms: [{ term: "ACID", definition: "Atomicity, Consistency, Isolation, Durability." }, { term: "Sharding", definition: "Horizontal partitioning across nodes." }],
        commonConfusions: [{ misconception: "NoSQL means zero structure", correction: "Documents still have predictable application contracts." }],
        selfCheck: [
          { question: "When pick SQL?", answer: "When strict relational integrity is needed." },
          { question: "When pick NoSQL?", answer: "When schema flexibility and horizontal scale dominate." },
          { question: "What is Postgres?", answer: "A relational SQL engine." },
        ],
        createdAt: now(),
        updatedAt: now(),
      };
      m.revisionGuides.set(key, guide);
      return json(201, ok({ revisionGuide: clone(guide) }));
    }
    if (action === "ask" && method === "POST") {
      const d = detail(note);
      const sec = d.currentVersion?.learningPlan?.sections?.[0];
      return json(200, ok({
        answer: "Databases divide into relational engines like Postgres and NoSQL document stores like MongoDB.",
        grounded: true,
        citations: sec ? [{ label: `1. ${sec.title}`, sectionId: sec.id, snippet: sec.explanation }] : [],
      }));
    }
    if (action === "sections" && method === "POST" && parts[4] === "regenerate") {
      const sectionId = parts[3];
      const d = detail(note);
      const plan = clone(d.currentVersion?.learningPlan);
      const idx = plan?.sections?.findIndex((s) => s.id === sectionId) ?? -1;
      if (idx === -1) return notFound("Section");
      plan.sections[idx] = {
        ...plan.sections[idx],
        title: body.title ?? plan.sections[idx].title,
        explanation: body.explanation ?? plan.sections[idx].explanation,
        visualType: body.visualType ?? plan.sections[idx].visualType,
      };
      const scene = clone(d.sceneJson);
      const titleEl = scene.elements.find((e) => e.id === `${sectionId}__title`);
      if (titleEl && body.title) titleEl.text = body.title;
      const v = addVersion(id, { scene, kind: "regenerate", description: `Regenerated section: ${plan.sections[idx].title}`, plan });
      return json(201, ok({ version: meta(v, v.id), learningPlan: plan, sceneJson: scene, draftRevision: 0 }));
    }
    return notFound();
  };

  return m;
}

/** Serves export downloads as attachments (what Supabase signed URLs do with ?download=). */
export async function routeStorageDownloads(page) {
  await page.route(`${STORAGE_ORIGIN}/**`, (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    const type = name.endsWith(".png") ? "image/png" : name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".zip") ? "application/zip" : "application/json";
    return route.fulfill({ status: 200, headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"` }, body: "file" });
  });
}
