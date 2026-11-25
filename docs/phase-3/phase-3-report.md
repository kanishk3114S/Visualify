# Visualify — Phase 3 Report: Notes Library, Autosave, Versions, Exports & Dark Mode

**Date:** 26 November 2026  
**Status:** **Implemented and verified across all offline, build, Playwright E2E, and WCAG 2 AA suites.** Live RLS/Storage checks pass **12/12** for Phases 1–2; the 4 new Phase 3 live checks (`notes`, `folders`, `note_versions`, `note_drafts`, `note_exports`, `note-assets`, `note-exports`) cleanly report `NOT RUN (BLOCKED: apply supabase/migrations/0004_folders_notes_versions_exports.sql and 0005_note_storage_buckets.sql first)` until those two migrations are applied on the Supabase project.

---

## 1. What was built

| Area | Delivered |
| :--- | :--- |
| **Database** (`supabase/migrations/0004_folders_notes_versions_exports.sql`, `0005_note_storage_buckets.sql`) | Five owner-scoped RLS tables (`folders`, `notes`, `note_versions`, `note_drafts`, `note_exports`) plus `generation_jobs.note_id`. Composite foreign keys tie folders, notes, versions, and exports to the same owner. Triggers enforce folder cycle/depth limits (max depth 8) and keep `notes.updated_at` focused on content/autosave edits rather than `last_opened_at` or `preview_path` refreshes. `note_versions` rows are immutable (`SELECT` + `INSERT` grants only). Atomic `SECURITY INVOKER` functions handle `add_note_version`, `create_note_from_job`, `restore_note_version`, `duplicate_note`, and `delete_folder`. `0005` provisions private `note-assets` (5 MiB PNG previews) and `note-exports` (25 MiB PNG/SVG/JSON) buckets scoped by `{uid}/{noteId}/...`. |
| **Worker** (`backend/worker/src/`) | Editor-scene validation/sanitization permitting freehand pencil strokes and extended Excalidraw properties, plus `renderScene` theme (`light`/`dark`) and transparent background rendering via `@excalidraw/cli` (`tests/phase3Scene.test.js`). |
| **API** (`backend/src/notes/`, `controllers/notes.controller.js`, `routes/notes.routes.js`, `schemas/notes.schema.js`) | `/api/v1/folders*`, `/api/v1/notes*`, and `/api/v1/exports/:exportId` behind `requireAuth` before body parsing, Zod validation, and per-user rate limiters (separate autosave limiter for `PUT /:noteId/draft`). Implements library search/filter/sort/paging, save-from-generation (preserving pre-save canvas edits and deduplicating double-saves), optimistic draft revision (`409 DRAFT_CONFLICT`), snapshots, version history/preview, non-destructive restore, duplicate, and PNG/SVG/`.excalidraw` export generation + signed download URLs. |
| **Frontend** (`frontend/src/features/notes/`, `app/ThemeContext.jsx`, `components/ThemeToggle.jsx`) | `SaveToLibraryDialog` (in workspace) → redirects to `/app/notes/:noteId/edit` (`NoteEditorPage`, debounced autosave with `data-status`, conflict banner, `SnapshotDialog`, `VersionHistory` preview & restore, `ExportDialog` with independent diagram Light/Dark and transparent options). Library (`/app/notes` & `/app/folders/:folderId` via `LibraryPage` + `NoteDialogs`) with grid/list views, folder creation/move, favorites, search, tag filters, duplicate, archive, and delete confirmation. Read/study view (`/app/notes/:noteId`, `NoteReadPage`) and dashboard recent/favorites integration (`DashboardPage`). App-wide Light/Dark/System mode (`ThemeContext`, `ThemeToggle`, `.dark` semantic CSS tokens in `styles/index.css`, profile sync). |
| **Accessibility fix** (`frontend/src/features/profile/AvatarUploader.jsx`) | Added `aria-label="Choose profile photo"` to `#avatar-file` after `@axe-core/playwright` flagged an unlabelled hidden file input during the WCAG 2 AA audit. |

---

## 2. Important verification details & visual findings

1. **Axe WCAG 2 AA audit & accessibility remediation:**
   - Audited public/auth routes (`/`, `/features`, `/login`, `/signup`) and authenticated routes (`/app`, `/app/create`, `/app/notes`, `/app/notes/:id`, `/app/notes/:id/edit` excluding third-party `.excalidraw` canvas internals, `/app/profile`, `/app/settings/preferences`) in **both** Light and Dark modes using `@axe-core/playwright`.
   - Caught and resolved a critical WCAG 2 A `label` violation on `#avatar-file` in `AvatarUploader.jsx`; after the fix, all audited routes returned **0 violations** in both themes.
2. **Desktop & mobile screenshot inspection (`renders/`):**
   - Captured `renders/theme-desktop-light.png`, `renders/theme-desktop-dark.png`, `renders/theme-mobile-light.png`, `renders/theme-mobile-dark.png` (at `1366x860` and `390x844`), plus `renders/theme-editor-dark.png`.
   - Visual inspection caught buttons/nav links/selects captured mid-transition during the `150ms` `transition-colors` switch when async profile loading flipped Light → Dark. Waiting for `document.getAnimations()` to finish (`animations: "disabled"` on capture) verified crisp dark surfaces, legible contrast, and `<= 0` horizontal overflow across desktop and mobile.
3. **Mocked E2E baseline compatibility (`tests/e2e/support/mockBackend.js`):**
   - `DashboardPage` and `SaveToLibraryDialog` now query `/api/v1/notes` and `/api/v1/folders` on mount, which initially caused `404` console errors in Phase 1/2 specs that omitted `notes` from `mockApi()`. Defaulting `notes` to `createNotesMock({ generations })` when omitted fixed all Phase 1–2 tests cleanly.

---

## 3. Verification (commands actually run after final edits)

| Command | Result |
| :--- | :--- |
| `npm run test:worker` | **67/67 passed** (6 test files, 31.68s), including 18 tests in `phase3Scene.test.js` and real `@excalidraw/cli` dark/transparent PNG & SVG rendering |
| `npm run test:api` | **202/202 passed** (8 test files, 10.42s), including `notesRepository.test.js` (14 tests) and `notes.routes.test.js` (34 tests) |
| `npm run test:rls:sql` | **54/54 passed** (`rls.pglite.test.js` + `notes.pglite.test.js` across migrations `0001`–`0005` on PGlite) |
| `npm run test:frontend` | **65/65 passed** (4 test files, including `phase3.test.js` 15 tests) |
| `npm run test:e2e` | **56/56 passed** (1.7m): 43 Phase 0–2 tests + 3 `notes.spec.js` full workflow tests + 10 `theme.spec.js` toggle/persistence/Axe WCAG 2 AA/screenshot checks, with zero console/page errors |
| `npm run test:rls:live` | **12/12 passed, 4 skipped**: all Phase 1–2 checks (`profiles`, `avatars`, `generation_jobs`) passed live; the 4 new Phase 3 tests (`folders`, `notes`, `note_versions`, `note_drafts`, `note_exports`, `note-assets`, `note-exports`) cleanly skipped with `NOT RUN (BLOCKED: apply supabase/migrations/0004_folders_notes_versions_exports.sql to this project first)` |
| `npm run build:frontend` | **PASS** (Vite 8.3.8, 3.16s, main chunk `776.45 kB` / `226.99 kB` gzip, no source maps) |
| `npm run spike:local` | **`"status": "PASS"`** across all 7 diagram fixtures |
| **Secret scan** (`frontend/dist/`, `frontend/src/`, 198 tracked+untracked files) | **NONE** for `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, and `sb_secret_` literals. One `/AIza.../` regex match in `frontend/dist/assets/prod-B2KhwvmW.js` was verified to be `@excalidraw/excalidraw`'s upstream Firebase client `apiKey` (`authDomain: "exca..."`), not any project secret. |
| `git status --short --ignored` | Working tree contains uncommitted Phase 3 implementation, tests, docs, and gitignored `.env.local` / `dist` / `renders` / `test-results` (nothing staged or committed). |

---

## 4. Remaining issues / not yet verified live

- **Apply migrations `0004` and `0005` on the live Supabase dev project:** Run `supabase/migrations/0004_folders_notes_versions_exports.sql` then `supabase/migrations/0005_note_storage_buckets.sql` in the Supabase SQL Editor (or `supabase db push`), then re-run `npm run test:rls:live` so all 16/16 live RLS & Storage checks execute against real Supabase.
- **Live end-to-end export/notes API smoke test:** Real export PNG/SVG rendering (`@excalidraw/cli`) is verified in `test:worker` (67/67) and against mocked repositories/routes in `test:api` (202/202), and browser UX against contract-faithful mocks in `test:e2e` (56/56); live Supabase storage upload/signed download for `note-assets` / `note-exports` via the Express API awaits `0004` & `0005` on the dev project.

---

## 5. Next priority

1. Apply `0004_folders_notes_versions_exports.sql` and `0005_note_storage_buckets.sql` in the Supabase SQL Editor.
2. Run `npm run test:rls:live` to confirm 16/16 live checks pass.
3. Click through one real generation → Save to library → edit/autosave → Snapshot/Restore → PNG/SVG/`.excalidraw` export + Dark mode in the browser (`npm run dev:api` + `npm run dev:frontend`), then proceed to Phase 4 (PDF & image inputs).
