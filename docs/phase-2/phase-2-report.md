# Visualify — Phase 2 Report: Prompt-to-Visual MVP

**Date:** 26 November 2026
**Status:** **CLOSED (26 November 2026).** Implemented, verified offline, and verified **live** against the Supabase dev project after migration `0003` was applied: 12/12 live RLS checks and 14/14 live API checks (real Gemini + real Excalidraw CLI + real Supabase), including boot recovery (§4b).

---

## 1. What was built

The full **Prompt → structured learning plan → editable Excalidraw scene + explanation** loop.

| Area | Delivered |
| :--- | :--- |
| **Database** (`supabase/migrations/0003_generation_jobs.sql`) | `generation_jobs` with status/progress/terminal-state CHECKs, 8,000-char prompt limit, 4 KB settings cap, `retry_of` link, `(owner_id, created_at desc)` and `(owner_id, status)` indexes, and a **partial unique index enforcing one active job per user**. RLS: owners may **create** a queued job (column-limited grant), **read**, **request cancellation** only (`status → cancelling/cancelled`), and **delete finished** jobs. `anon` has no access. Results are written server-side only. |
| **Worker** (`backend/worker/`) | Public entry `src/index.js` (package exports). `geminiPlanner.js` wraps the learner prompt (and subject) in `<untrusted_user_input>` delimiters, neutralises delimiter look-alikes, adds non-overridable security rules to the system instruction, threads settings (level, depth, style, preferred visual type) and an **external cancel signal that is never retried as a timeout**, and versions the prompt (`PROMPT_VERSION`). New `sceneComposer.js` merges per-section scenes into one canvas, namespacing every element ID and reference (`{sectionId}__…`). `compileDiagramSpecToScene` passes the cancel signal to the Mermaid CLI subprocess. |
| **Job runner** (`backend/src/generation/`) | `InProcessQueue` (FIFO, concurrency cap, one `AbortController` per job), `JobEventBus` (EventEmitter for SSE), `SupabaseJobStore` (service-role writes always filtered by job ID with **conditional status filters**; owner reads through the user's RLS client plus an explicit owner filter), `pipeline.js` (validate → plan → compose each section independently → merge → validate), `generationService.js` (state machine, monotonic progress, safe error mapping, cancel, retry, stale-job reclaim, boot-time recovery). |
| **API** (`/api/v1/generations*`) | `POST /` (202 `{ jobId, status: "queued" }`; 409 `ACTIVE_JOB_EXISTS`; 503 if not configured), `GET /:jobId`, `GET /:jobId/events` (SSE), `POST /:jobId/cancel` (idempotent; 200 cancelled / 202 cancelling), `POST /:jobId/retry`. Auth runs before body parsing; unknown, malformed and other users' IDs all get the same 404; rate limits are 20 creates per hour and 60 cancels per 15 min, per user. |
| **Frontend** | `/app/create` (prompt with live remaining-character counter, 4 starters, subject/level/depth/style/diagram-type settings; level defaults from preferences). `/app/generations/:jobId` (accessible progress → workspace, or safe failure with reference + retry, or cancelled state). SSE via **`fetch` + `ReadableStream` with the Bearer header**, with polling fallback. **Visual workspace:** top bar (title, visual-type badges, edit status, disabled "Save to Library (Phase 3)"), outline panel (objectives, clickable sections that zoom the canvas, key concepts, warnings), lazily loaded Excalidraw canvas (fits the whole lesson on open), and explanation panel (overview, per-section explanation, relationships). |
| **Responsive** | ≥1200px: three panels, with the app nav collapsing to an accessible icon rail so the canvas gets the width. Below 1200px: Canvas/Outline/Explanation tabs; the canvas stays mounted so edits survive tab switches. Below 768px: the same tabs plus a "best on a larger screen" notice. |

Dashboard and nav: the "Create" nav item and the dashboard CTA now link to `/app/create`. Landing and Features copy now mark prompt-to-visual and the editor as available, and saving/autosave as "Coming next" (release policy).

## 2. Important technical decisions

1. **No Redis here, so an in-process queue behind an interface.** Redis isn't installed locally. The service depends only on `enqueue / cancel / isTracked / onIdle`, so BullMQ can replace `InProcessQueue` without touching routes or the pipeline. **Single-instance assumption:** on boot, any row still "active" belongs to a dead process and is marked `INTERRUPTED` (a `cancelling` row becomes `cancelled`). An orphaned active row older than 2 minutes is also reclaimed when the user starts a new job, so nobody is permanently blocked by the one-active-job rule.
2. **Clients cannot forge results.** Users can only create/read/cancel their jobs. Status, progress, plan, scene and errors are written by the server runner with the service role. Phase 3 will create notes from jobs, so a client must never be able to plant a "completed" job with an arbitrary scene. Verified by SQL tests (§4).
3. **Race-safe state machine.** Every runner write is conditional on the expected current status, so a cancel can't be overwritten by "completed", and a job cancelled while persisting stays cancelled.
4. **Partial success instead of all-or-nothing** (PRD 5.10). Each section is composed independently. A section whose diagram fails becomes a user-visible warning while its explanation is kept. Only if no section can be drawn does the job fail (`RENDER_FAILED`).
5. **Model output is re-validated in the API** (`LearningPlanSchema`, then `validateExcalidrawScene` on the merged scene), even though the worker already validates it.
6. **Safe errors only.** Provider and CLI errors map to fixed codes and messages (`AI_BUSY`, `GENERATION_TIMEOUT`, `AI_UNAVAILABLE`, `CONTENT_BLOCKED`, `INVALID_PLAN`, `RENDER_FAILED`, `INTERRUPTED`, `GENERATION_FAILED`). Raw text, keys and paths never reach the DB message or HTTP. Logs carry `jobId`, `userId`, `stage`, `durationMs`, `modelId` and the error code, but **never prompts**.
7. **SSE details.** The handler subscribes *before* reading the snapshot (no lost events), forces progress to be monotonic, sends a 20s heartbeat, allows at most 5 streams per user, and cleans up its listener on disconnect. The client fetches the full job with GET on terminal events, so results have one source of truth.
8. **The `rendering` stage (PNG/SVG preview) is skipped.** Previews and exports belong to Phase 3. The UI's stage list shows only real stages.

## 3. Files changed (main)

- `supabase/migrations/0003_generation_jobs.sql`; `supabase/tests/rls.pglite.test.js` (+11), `rls.live.test.js` (+4, auto-detects a missing table).
- `backend/worker/src/index.js`, `adapters/sceneComposer.js` (new); `services/geminiPlanner.js`, `adapters/sceneRouter.js`, `package.json` (`exports`); `tests/phase2Pipeline.test.js` (new).
- `backend/src/generation/*` (new: `jobStates`, `eventBus`, `inProcessQueue`, `jobStore`, `pipeline`, `generationService`, `index`); `controllers/generations.controller.js`, `routes/generations.routes.js`, `schemas/generation.schema.js` (new); `config/env.js`, `config/supabase.js`, `middleware/rateLimit.js`, `routes/index.js`, `app.js`, `server.js` (wiring).
- `backend/tests/generations.routes.test.js`, `jobStore.test.js`, `helpers/fakeGeneration.js` (new); `backend/vitest.config.js` (new; see §5).
- `backend/scripts/smokeGeneration.js` (new; `npm run smoke:generation`).
- `frontend/src/features/create/CreatePage.jsx`, `features/generation/*` (new); `hooks/useGenerationJob.js`, `lib/sse.js` (new); `lib/apiClient.js`, `lib/schemas.js`, `app/router.jsx`, `app/AppShell.jsx`, dashboard and marketing copy, `styles/index.css` (`desk:` 1200px breakpoint).
- `tests/e2e/generation.spec.js`, `support/generationMocks.js` (new); `app-shell.spec.js` (2 assertions updated for the intentional nav/features change).
- `backend/.env.example` (generation variables, placeholders only); `supabase/README.md` (`0003`).

## 4. Verification (commands actually run)

| Command | Result |
| :--- | :--- |
| `npm run test:worker` | **49/49**: the original 38 unchanged, plus 11 new (injection delimiters, delimiter-escape neutralisation, trusted constraints outside the untrusted block, cancel before/during a model call without retry, signal reaching the CLI, scene composition and ID namespacing, no duplicate headings) |
| `npm run test:api` | **154/154**: the 95 Phase 1 tests plus 53 generation route tests and 6 `SupabaseJobStore` tests. Covers auth before body parsing, 400/409/503/429, prompt normalisation, settings defaults/override, completed job contents, identical 404s, 6 provider-error mappings with no leaks, schema-invalid plan, partial success, all-sections-failed, job timeout, SSE headers/order/monotonic progress/heartbeat/terminal snapshot/listener cleanup/no query token, running and queued cancel with no partial results, idempotent cancel, retry linkage/limits/one-active rule, crash recovery, and no prompt in logs. Stable over 3 consecutive runs. |
| `npm run test:rls:sql` | **37/37**: the 26 Phase 1 checks plus 11 `generation_jobs` checks (4 owner policies, owner create/read, forged status/progress/scene/plan inserts denied, cross-user insert/read/cancel/delete denied, owners can only request cancellation, finished-only delete, anon denied, DB-enforced one-active-job, CHECK constraints, cascade on user delete) |
| `npm run test:frontend` | **50/50**: 31 `returnTo` tests plus 19 new (SSE parser: chunk boundaries, CRLF/CR, CRLF split across chunks, heartbeats, multi-line data, retry, malformed JSON, multi-byte UTF-8, abort; generation request schema/body) |
| `npm run test:e2e` | **43/43**: the 31 Phase 0/1 tests (including the Phase 0 Excalidraw spec) plus 12 Phase 2: create-form validation and counter, starter + settings in the request body, active-job redirect, dashboard/nav links, full prompt → SSE → workspace on **desktop and mobile** with a non-zero real Excalidraw canvas and **zero console errors**, a canvas edit flipping status to "Edited · not saved", partial-result warnings, **polling fallback**, safe failure + retry, accessible progress + cancel, not-found. Phase 2 spec stable over 3 runs. |
| `npm run test:rls:live` (live project) | **12/12 passed** after `0003` was applied: the 8 Phase 1 checks plus 4 `generation_jobs` checks (owner create/read; user B and anon can't see it; DB-enforced one-active-job; B can't insert for A, cancel or delete A's job; owners can't forge `completed`, `scene_json` or completed inserts, only cancel). Before `0003`: 8 passed, 4 reported NOT RUN. |
| `npm run smoke:generation` (**live Gemini + live CLI**) | **completed in 42.5s**: `gemini-3.5-flash`, prompt version `planner-2026-11-26.1`, no repair needed; 2 sections (`sequence` via Mermaid → Excalidraw CLI, `comparison` via direct adapter), merged scene of 45 elements, **valid**; 3,073 tokens. Uses the production service/queue/pipeline with an in-memory store, since `0003` isn't applied. |
| Real `server.js` with your env | Boots with `generationEnabled: true`; `/health` 200; generation endpoints 401 without a token; boot recovery logs a server-side error only because `generation_jobs` doesn't exist yet; no secrets in logs. |
| `npm run build:frontend` | PASS; no source maps; the Excalidraw canvas is a lazy chunk; main bundle 707 kB (209 kB gzip, +26 kB vs Phase 1). |
| `npm run spike:local` | `"status": "PASS"` |
| Secret scan | Neither the Gemini key nor the service-role key appears in `frontend/src`, `frontend/dist`, any tracked or untracked file, or git history. The frontend reads only the 3 `VITE_*` variables. All three `.env.local` files are ignored. |

## 4b. Live verification after applying `0003` (26 November 2026)

`npm run smoke:live-api` (`backend/scripts/liveApiSmoke.js`, new and reusable). It boots the **real `server.js`** against the live Supabase dev project and real Gemini, uses throwaway confirmed users created and deleted by the script, and refuses to run with `NODE_ENV=production`. **14/14 passed:**

| Check | Result |
| :--- | :--- |
| Boot recovery: an orphaned `planning` job planted before boot | Marked `failed` / `INTERRUPTED` with `finished_at`; **no recovery error** in the log (the earlier missing-table error is gone) |
| `GET /health` | 200, `supabase: ok` |
| `POST /generations` (real JWT) | **202** `queued` |
| Second concurrent `POST` | **409** `ACTIVE_JOB_EXISTS` with the active job ID |
| Another user `GET`s the job | **404** |
| SSE `/events` | `text/event-stream`; snapshot → stage → stage → completed; progress monotonic 12 → 100 |
| `GET` result | `completed` in **18.2s**, learning plan + **valid 78-element scene** (mind map + sequence via the real Mermaid CLI) |
| Response shape | No owner ID or usage internals exposed |
| DB row (service-role read) | `owner_id` = the token's user; `gemini-3.5-flash`, prompt version recorded; 3,743 tokens |
| Cancel a running job | HTTP 202 → `cancelled`; no plan, no scene stored |
| Server log | No secrets, tokens, project ref or prompt text |
| Cleanup | Throwaway users deleted; their jobs cascade-deleted (0 left) |

Note: boot recovery deliberately marks *every* active job in the project as interrupted (single-instance design). That is correct for this dev project, but it is why the in-process runner must not be scaled to more than one API instance (§5).

Visual checks (screenshots at 1366 / 900 / 390 px) found and fixed three real issues: the canvas was only 470px wide at 1366px (fixed with the nav icon rail), the scene wasn't fitted to the view on open, and a section heading was duplicated.

## 5. Remaining issues / not verified

- ~~Apply `0003`~~ **Done**: applied by the project owner; live RLS 12/12 and live API 14/14 (§4b).
- **Manual browser click-through on the live stack** (sign in → create → watch progress → workspace) hasn't been done by a person. Every layer it uses is verified live over HTTP (§4b), and the UI flow is verified in Playwright against a contract-faithful mock, so this is a final human sanity check rather than an open gap.
- **Single-instance runner.** Jobs run inside the API process. Running more than one API instance needs BullMQ/Redis (or a DB-claimed queue) before scaling out; the interface is ready for it.
- **Edits are not saved** (by design until Phase 3). Leaving the page with edits triggers the browser's unsaved-changes prompt.
- **Planner latency is ~41s** on `gemini-3.5-flash` with thinking. Progress ticks keep the UI alive, but this is the main UX cost.
- **Correction to earlier reports:** the API Vitest run also ran `backend/worker/tests`, so Phase 1's "133/133 API" really meant 95 API tests plus 38 worker tests counted twice. `backend/vitest.config.js` now scopes it (noted in the Phase 1 report).
- Carried over: Google OAuth is still disabled on the project, staging isn't deployed, and the Excalidraw/Mermaid `npm audit` advisories are upstream.

## 6. Next priority

Phase 2 is closed. Optionally click through one real generation in the browser (`npm run dev:api` + `npm run dev:frontend`). Then start Phase 3: notes, versions and autosave, created from completed jobs, which the trust model above makes safe.
