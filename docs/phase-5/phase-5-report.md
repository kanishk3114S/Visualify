# Phase 5 Implementation & Verification Report

**Date:** 2026-11-26  
**Scope:** Multi-Frame Excalidraw Scenes, Presentation Mode & Selective/ZIP Export (Part 1), `0008_learning_companion.sql` & RLS (Part 2), Worker AI Study Companion & Section Regeneration (Part 3), Express Companion API & Usage Metering (Part 4), and Frontend Study Suite & Assistant UI (Part 5).

---

## 1. Summary of Changes

### Part 1 — Multi-Frame Scenes, Presentation Mode & Selective/ZIP Exports
- **Excalidraw `frame` Composition & Scene Helpers ([`sceneComposer.js`](../../backend/worker/src/adapters/sceneComposer.js), [`excalidrawScene.js`](../../backend/worker/src/schemas/excalidrawScene.js), [`pipeline.js`](../../backend/src/generation/pipeline.js)):**
  - `composeLessonScene` wraps each section in a genuine Excalidraw `frame` element (`id: "${sectionId}__frame"`, `type: "frame"`, `name: "${index + 1}. ${sectionTitle}"`) and assigns `frameId` to every element in that section.
  - Added `extractSceneFrames`, `filterSceneToFrame`, and `replaceSectionInScene` for ordered slide extraction (with prefix fallback for legacy pre-Phase-5 scenes), single-frame filtering, and non-overlapping single-section splicing.
  - Updated `validateExcalidrawScene`, `validateEditableScene`, and `sanitizeEditableScene` to validate `frame` names and strip dangling `frameId` references when a frame element is deleted.
  - Confirmed real `@excalidraw/cli` `renderScene` renders framed multi-section scenes to valid PNG and SVG.
- **Full-Bleed Presentation Mode ([`NotePresentPage.jsx`](../../frontend/src/features/notes/NotePresentPage.jsx), [`router.jsx`](../../frontend/src/app/router.jsx), [`NoteReadPage.jsx`](../../frontend/src/features/notes/NoteReadPage.jsx), [`NoteEditorPage.jsx`](../../frontend/src/features/notes/NoteEditorPage.jsx)):**
  - Registered `/app/notes/:noteId/present` with keyboard controls (`ArrowRight`/`Space`/`PageDown`, `ArrowLeft`/`PageUp`, `Escape` exit, `N` speaker notes drawer, `F` fullscreen), clickable slide strip, smooth camera focusing, and speaker-note key concepts / `sourceRefs`.
- **Single-Frame & Multi-Slide ZIP Export ([`zipArchive.js`](../../backend/src/notes/zipArchive.js), [`ExportDialog.jsx`](../../frontend/src/features/notes/ExportDialog.jsx), [`notesService.js`](../../backend/src/notes/notesService.js)):**
  - Added pure-JS PKZIP archive writer using Node `zlib` (`deflateRawSync` + `crc32` with table fallback) with zero native dependencies.
  - `ExportDialog` supports **Full scene**, **Current frame** (`scope: "frame"`), and **All slides (.zip)** (`format: "zip"` with `png` or `svg` slide format + `manifest.json`).

### Part 2 — Database Migration `0008_learning_companion.sql` & RLS
- **Schema & Security ([`0008_learning_companion.sql`](../../supabase/migrations/0008_learning_companion.sql), [`learning_companion.pglite.test.js`](../../supabase/tests/learning_companion.pglite.test.js), [`rls.live.test.js`](../../supabase/tests/rls.live.test.js)):**
  - Created `public.note_quizzes`, `public.note_flashcards`, `public.note_revision_guides`, and `public.usage_events` with owner-scoped RLS (4 explicit policies on study tables; SELECT-only for `authenticated` on `usage_events`, service-role writes only) and composite owner foreign keys to `public.notes`.
  - Updated `note_exports` (`format` CHECK adds `'zip'`, `scope`, `frame_id`), `note-exports` bucket (`allowed_mime_types` adds `'application/zip'`), and `note_versions` (`kind` CHECK adds `'regenerate'`).

### Part 3 & 4 — Worker Study Companion, Single-Section Regeneration & API
- **Worker AI Companion ([`studyCompanion.js`](../../backend/worker/src/schemas/studyCompanion.js), [`studyCompanionService.js`](../../backend/worker/src/services/studyCompanionService.js), [`geminiPlanner.js`](../../backend/worker/src/services/geminiPlanner.js)):**
  - Extracted reusable `generateStructuredJson` runner with `systemInstruction`, `AbortController` timeouts, transient retry, and 1-shot schema repair.
  - Implemented `explainSelection`, `generateQuiz`, `generateFlashcards`, `generateRevisionGuide`, `askNote`, and `regenerateSectionPlan`, with untrusted input delimiters (`<untrusted_user_input>`, `<untrusted_source_document>`) and `sourceRefs` citations.
- **Express Routes & Metering ([`notes.routes.js`](../../backend/src/routes/notes.routes.js), [`notes.controller.js`](../../backend/src/controllers/notes.controller.js), [`notesRepository.js`](../../backend/src/notes/notesRepository.js), [`rateLimit.js`](../../backend/src/middleware/rateLimit.js)):**
  - Added `GET /study`, `POST /explain`, `POST /quiz`, `PATCH /quiz/:quizId`, `POST /flashcards`, `PATCH /flashcards/:cardId`, `POST /revision`, `POST /ask`, and `POST /sections/:sectionId/regenerate` behind `requireAuth`, strict Zod validation, `aiCompanion` rate limiting (`60/hr`), and `503 AI_UNAVAILABLE` when Gemini is unconfigured.
  - Added server-side `usage_events` recording (when service-role is configured) and best-effort orphan `source_files` storage cleanup when deleting a note.

### Part 5 — Frontend Study Companion Suite & Assistant Panel
- **Workspace Live Selection & Regeneration ([`WorkspaceCanvas.jsx`](../../frontend/src/features/generation/WorkspaceCanvas.jsx), [`VisualWorkspace.jsx`](../../frontend/src/features/generation/VisualWorkspace.jsx), [`StudyAssistantPanel.jsx`](../../frontend/src/features/notes/study/StudyAssistantPanel.jsx), [`frames.js`](../../frontend/src/lib/frames.js)):**
  - Canvas reports selected elements (`onSelectionChange`), surfacing a quick `Explain selection` bar, `Study Assistant` right-panel tab, and inline non-destructive `Regenerate` drawer per section (automatically refreshing snapshots/versions).
- **Read View Companion Tabs ([`NoteReadPage.jsx`](../../frontend/src/features/notes/NoteReadPage.jsx), [`QuizView.jsx`](../../frontend/src/features/notes/study/QuizView.jsx), [`FlashcardsView.jsx`](../../frontend/src/features/notes/study/FlashcardsView.jsx), [`RevisionSheetView.jsx`](../../frontend/src/features/notes/study/RevisionSheetView.jsx), [`AskNoteView.jsx`](../../frontend/src/features/notes/study/AskNoteView.jsx)):**
  - Integrated `Overview & Diagram`, `Quick Quiz` (difficulty selector + persistent attempts), `Flashcards` (interactive flip + mastery filter & persistence), `Revision Sheet` (structured Markdown & key definitions), and `Ask This Note` (Q&A with clickable section & source page chips).

---

## 2. Verification Results (Latest Runs)

| Check | Command | Result |
|:--|:--|:--|
| Worker Unit & CLI Suite | `npm run test:worker` (within `npm test`) | **PASS** — `85/85` tests passed across `8` files (including `studyCompanion.test.js` and real `@excalidraw/cli` frame rendering) |
| Express API Suite | `npm run test:api` (within `npm test`) | **PASS** — `216/216` tests passed across `9` files (including companion routes, ZIP archives, section regeneration & rate-limit guards) |
| Offline Postgres SQL/RLS | `npm run test:rls:sql` | **PASS** — `62/62` checks passed across `4` PGlite files (`rls`, `notes`, `sources`, `learning_companion`) |
| Frontend Unit Suite | `npm run test:frontend` (within `npm test`) | **PASS** — `73/73` tests passed across `6` files (including `phase5.test.js`) |
| Browser E2E + Axe | `npm run test:e2e` | **PASS** — `70/70` Playwright tests passed across `1366x860` and `390x844` in Light & Dark modes, zero Axe WCAG 2 AA violations, zero horizontal overflow, zero console/page errors |
| Live Supabase RLS | `npm run test:rls:live` | **18/19 PASS**, **1 SKIPPED (`NOT RUN`)** — Phases 1–4 (`0001`–`0007`) pass live (`18/18`); Phase 5 (`note_quizzes` / companion tables) skipped cleanly until `0008_learning_companion.sql` is applied |
| Production Build & Secret Scan | `npm run build:frontend` + secret scan | **PASS** — built cleanly in `5.18s` with `0` `.map` files; zero Visualify/Gemini/service-role secrets in `frontend/dist/` or source files |

---

## 3. Manual Migration Step Required on Dev Supabase Project

Apply this Phase 5 migration in the Supabase **SQL Editor** (or via `npx supabase@latest db push`):
1. [`supabase/migrations/0008_learning_companion.sql`](../../supabase/migrations/0008_learning_companion.sql)

After applying `0008_learning_companion.sql`, re-run `npm run test:rls:live` to verify all `19/19` live checks pass.
