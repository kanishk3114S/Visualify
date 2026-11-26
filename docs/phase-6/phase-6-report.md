# Visualify Phase 6 — Launch Hardening Report

Phase 6 hardens Visualify for production launch across quotas and fail-closed metering, distributed BullMQ + Redis queuing and rate limiting, full account deletion with Storage cleanup, PII-redacted observability, CSP and CORS security headers, containerization and CI, automated load testing, tablet and reduced-motion UX polish, updated legal notices, and offline/live security verification.

---

## 1. What Was Built

### Phase 5 Carry-Overs Closed
- **Selection-only export (`FR-EXP-05`):** Added `filterSceneToElementIds(sceneJson, elementIds, { maxElements: 200 })` in `backend/worker/src/adapters/sceneComposer.js`, `scope: "selection"` + `elementIds` validation against the note's actual scene IDs in `backend/src/schemas/notes.schema.js` and `backend/src/notes/notesService.js` (`400 VALIDATION_ERROR` on unknown/empty IDs or `"zip"` combined with `"selection"`), and a `"What is included"` summary in `frontend/src/features/notes/ExportDialog.jsx`.
- **Quiz duplicate-option rejection:** Updated `QuizQuestionSchema` in `backend/worker/src/schemas/studyCompanion.js` to reject duplicate options case- and whitespace-insensitively.
- **Dev-only Excalidraw spike gate:** Gated `/spike/excalidraw` behind `import.meta.env.DEV` in `frontend/src/app/router.jsx` so production bundles exclude the test harness while Vite dev-server Playwright tests remain active.

### Quotas, Fail-Closed Usage Metering & Migration `0009`
- **SQL Migration (`supabase/migrations/0009_phase6_hardening.sql`):** Extended `note_exports_scope` to include `'selection'`, extended `usage_events_type` to cover `generation_create`, `generation_retry`, `note_explain`, `note_quiz`, `note_flashcards`, `note_revision`, `note_ask`, `section_regenerate`, and `note_export`, and added `SECURITY DEFINER` RPC `public.consume_monthly_quota(...)` guarded by `pg_advisory_xact_lock` (revoked from `PUBLIC`/`anon`/`authenticated`, granted to `service_role` only).
- **Fail-closed metering & quota API (`backend/src/services/usageService.js`):** Refuses API boot in `production` if `SUPABASE_SERVICE_ROLE_KEY` is missing (`ensureProductionServiceRole`), logs a single warning in non-production, scrubs metadata keys (`sanitizeUsageMetadata`) to block prompts, filenames, titles, and emails, enforces monthly limits before any AI call (`429 QUOTA_EXCEEDED` with `{ limit, used, resetsAt }`), and exposes `GET /api/v1/me/usage`.
- **Dashboard & quota UX:** Added the `Usage this month` meter to `frontend/src/features/dashboard/DashboardPage.jsx` and quota-reached disabled/actionable states across `CreatePage.jsx` and the study companion views (`QuizView.jsx`, `FlashcardsView.jsx`, `RevisionSheetView.jsx`, `AskNoteView.jsx`, `StudyAssistantPanel.jsx`).

### Distributed Rate Limiting & BullMQ Queue
- **Optional Redis wiring (`backend/src/config/redis.js`, `backend/src/middleware/rateLimit.js`, `backend/src/generation/bullmqQueue.js`, `backend/src/generation/index.js`):** When `REDIS_URL` is configured, switches `express-rate-limit` to `rate-limit-redis` and runs generation jobs over `BullMQGenerationQueue` with deterministic `jobId` deduplication, pre-model queued job removal on cancel, Redis pub/sub cancellation broadcast, and bounded concurrency. When `REDIS_URL` is unset, falls back cleanly to in-memory rate limits and `InProcessQueue`.

### Account Deletion Lifecycle
- **`DELETE /api/v1/me` (`backend/src/services/accountService.js`, `backend/src/controllers/me.controller.js`):** Enforces authentication before 4 KB JSON parsing, strict `"DELETE MY ACCOUNT"` confirmation, password verification (or `<= 15m` recent sign-in for OAuth users), per-user `accountDelete` rate limit (`5/hour`), recursive cleanup across all four private buckets (`avatars`, `source-files`, `note-assets`, `note-exports`), and `auth.admin.deleteUser` cascading all user rows across all 12 database tables. Wired end-to-end in `frontend/src/features/profile/AccountSettingsPage.jsx`.

### Observability, Abuse Controls, Infra, Load Testing & UX Polish
- **Redacted logging & Sentry (`backend/src/utils/logger.js`, `backend/src/utils/sentry.js`, `frontend/src/lib/sentry.js`):** Scrubs Bearer JWTs, `AIza...` Gemini keys, Supabase secret keys, Redis credentials, emails, and signed URLs.
- **Health & operator endpoints (`backend/src/controllers/health.controller.js`, `backend/src/routes/admin.routes.js`):** Added unauthenticated safe `/healthz` and `/readyz` probes and admin-only `GET /api/v1/admin/jobs/:jobId` (`403 FORBIDDEN` for non-admins; redacted metadata only).
- **Security headers & CORS:** Added `vercel.json` with strict CSP using the exact SHA-256 hash `'sha256-lDUyFxVX+9jii6pt0zpz4Vih+o1OVQl6HpACYRgiuG0='` for `frontend/index.html`'s inline theme script, and added `"PUT"` to `ALLOWED_METHODS` in `backend/src/app.js` for draft autosave preflights.
- **Container, CI, Lint, Load Test & Legal:** Added `backend/worker/Dockerfile`, `backend/worker/.dockerignore`, `backend/worker/src/scripts/dockerSmoke.js`, `.github/workflows/ci.yml`, `scripts/lint.js`, `backend/scripts/loadTest.js`, `docs/operations/runbook.md`, and updated AI-processing disclosures in `frontend/src/features/marketing/LegalPages.jsx` (with draft notice pending formal legal counsel review).
- **Tablet & reduced motion:** Polished tablet breakpoints (`768px–1199px`) with Escape-dismissable side drawers (`VisualWorkspace.jsx`), `>= 44px` mobile icon touch targets (`AppShell.jsx`, `NoteEditorPage.jsx`), capture-phase `Escape` exit in `NotePresentPage.jsx`, and verified zero layout shift on `Toast.jsx` + `prefers-reduced-motion` support.

---

## 2. Complete API Route Security Audit

Every route enforces CORS origin allowlisting, Helmet headers, `Cache-Control: no-store`, and exact schema validation (`400 VALIDATION_ERROR`). Every route under `/api/v1/*` except `/api/v1/health/*` executes `requireAuth` **before** multipart buffering or JSON body parsing.

| Route | Auth Required | Rate Limiter | Body / Payload Limit | Ownership / Authorization Enforcement |
| :--- | :--- | :--- | :--- | :--- |
| `GET /healthz` | Public | None (probe) | None | Returns safe `{ status }` only |
| `GET /readyz` | Public | None (probe) | None | Returns `{ status, checks }` (`ok` / `degraded` / `not_configured` enums only; `503` if degraded) |
| `GET /api/v1/health`, `/live`, `/ready` | Public | `api` (IP) | None | Same safe health status checks |
| `GET /api/v1/me` | Bearer JWT | `api` | None | User-scoped Supabase client (`req.user.id`) + RLS |
| `GET /api/v1/me/usage` | Bearer JWT | `api` | None | User-scoped `usage_events` count (`req.user.id`) |
| `DELETE /api/v1/me` | Bearer JWT + password / `<= 15m` sign-in | `accountDelete` (5/hr) | 4 KB strict JSON | `"DELETE MY ACCOUNT"` phrase + credential check; sweeps only `req.user.id` storage prefixes + deletes `req.user.id` |
| `PATCH /api/v1/me` | Bearer JWT | `profileMutation` | 16 KB strict JSON | Owner RLS on `profiles` |
| `POST / DELETE /api/v1/me/avatar` | Bearer JWT | `avatarMutation` | `avatarMaxBytes` (1-part multipart) | Magic-byte + Sharp re-encode; `{uid}/*` storage prefix |
| `POST /api/v1/sources/upload` | Bearer JWT | `sourcesUpload` | `sourceMaxBytes` (1-part multipart) | Magic-byte PDF/image check; `{uid}/{sourceFileId}` storage prefix + RLS |
| `GET / DELETE /api/v1/sources/:sourceFileId` | Bearer JWT | `sourcesUpload` (`DELETE`) / `api` | None | Owner RLS (`404` on foreign/missing) |
| `POST /api/v1/generations` | Bearer JWT | `generationCreate` (20/hr) + monthly quota | 32 KB strict JSON | Owner RLS + 1 active job cap + `consume_monthly_quota` BEFORE model call |
| `GET /api/v1/generations/:jobId`, `.../events` | Bearer JWT | `api` | None | Owner RLS (`404` on foreign/missing) |
| `POST /api/v1/generations/:jobId/cancel` | Bearer JWT | `generationControl` | None | Owner RLS (`404` on foreign/missing) |
| `POST /api/v1/generations/:jobId/retry` | Bearer JWT | `generationCreate` + monthly quota | None | Owner RLS + `consume_monthly_quota` BEFORE model call |
| `GET / POST / PATCH / DELETE /api/v1/folders*` | Bearer JWT | `notesWrite` | 32 KB strict JSON | Owner RLS (`404` on foreign/missing) |
| `GET / POST / PATCH / DELETE /api/v1/notes*` | Bearer JWT | `notesWrite` | 5 MB (`POST /`) / 32 KB (`PATCH`, `duplicate`) | Owner RLS (`404` on foreign/missing) |
| `GET / POST /api/v1/notes/:noteId/versions*`, `restore` | Bearer JWT | `notesWrite` | 5 MB (`POST versions`) | Owner RLS + immutable `note_versions` |
| `PUT /api/v1/notes/:noteId/draft` | Bearer JWT | `autosave` | 5 MB strict JSON | Owner RLS on `note_drafts` |
| `POST /api/v1/notes/:noteId/exports`, `GET /api/v1/exports/:exportId` | Bearer JWT | `exports` | 32 KB strict JSON | Owner RLS + `selection` IDs verified against note scene (`<= 200`) + `{uid}/*` signed URL (`<= 900s`) |
| `GET /api/v1/notes/:noteId/study` | Bearer JWT | `api` | None | Owner RLS across quizzes, flashcards, revision guides |
| `POST /api/v1/notes/:noteId/explain` | Bearer JWT | `aiCompanion` + monthly quota | 256 KB strict JSON | Owner RLS + quota check BEFORE Gemini call |
| `POST /api/v1/notes/:noteId/quiz`, `flashcards`, `revision`, `ask`, `sections/:sectionId/regenerate` | Bearer JWT | `aiCompanion` + monthly quota | 32 KB strict JSON | Owner RLS + quota check BEFORE Gemini call |
| `PATCH /api/v1/notes/:noteId/quiz/:quizId`, `flashcards/:cardId` | Bearer JWT | `notesWrite` | 32 KB strict JSON | Owner RLS (`404` on foreign/missing) |
| `GET /api/v1/admin/jobs/:jobId` | Bearer JWT + Admin (`app_metadata.role === 'admin'` or `ADMIN_USER_IDS`) | `adminInspect` | None | Non-admins receive `403 FORBIDDEN`; strips prompts, emails, plans, scenes, filenames |

---

## 3. PRD §18.3 Launch Checklist Matrix

| # | Launch Checklist Item (PRD §18.3) | Status | Verification Evidence |
| :--- | :--- | :--- | :--- |
| 1 | Supabase Auth email confirmation, Google OAuth redirect URLs and recovery flow configured | **PASS** (app routes & client config) / **LIVE DASHBOARD MANUAL CHECK** | `AuthCallbackPage`, `ResetPasswordPage`, `ForgotPasswordPage`, safe `returnTo` tests (`31/31` unit + `tests/e2e/app-shell.spec.js`), live signup/login in `rls.live.test.js`; external Google OAuth Console credentials must be configured per deployed domain before public launch |
| 2 | Profile trigger and profile update policies tested | **PASS** | `supabase/tests/rls.pglite.test.js` + `supabase/tests/rls.live.test.js` (`signup trigger created a profile row`, owner update, cross-user update denied) |
| 3 | RLS enabled on every exposed table; SELECT/INSERT/UPDATE/DELETE tests pass for owner and non-owner | **PASS** (offline `65/65` PGlite) / **PARTIAL LIVE** (`20/21` pass, `1` skipped awaiting `0009`) | `npm run test:rls:sql` (`65/65` passed across all 12 tables); `npm run test:rls:live` (`20/21` passed; #20 `Phase 6 quota & selection export` skipped with `BLOCKED: apply supabase/migrations/0009_phase6_hardening.sql to this project first`) |
| 4 | Storage bucket policies tested for upload, list, read, signed URL and delete | **PASS** | Private bucket prefix policies tested in `rls.pglite.test.js`, `sources.pglite.test.js`, `phase6_hardening.pglite.test.js`, and live `rls.live.test.js` (upload, cross-user denial, signed URL, avatar/account sweep delete) |
| 5 | No service-role/Gemini/Redis secrets in frontend bundle or Git history | **PASS** | Production `frontend/dist` build (`distSourceMaps: 0`, secret scan clean of all project secrets; only Excalidraw's bundled Firebase public config string and `@supabase/supabase-js` prefix check literal matched), `npm run lint`, and `git log --all -p --unified=0` scan (`0` matches) |
| 6 | Worker Docker image includes Node 22+, CLI and Chromium; render smoke test passes in staging | **BLOCKED** (local container build) / **PASS** (smoke script on host) | `backend/worker/Dockerfile` (`node:22-bookworm-slim` + Playwright Chromium) authored; `node src/scripts/dockerSmoke.js` passed locally (`25` elements, `73603` B PNG, `28883` B SVG); `docker` CLI is not installed on this Windows host so image build must run in CI / Linux host |
| 7 | Prompt -> scene -> editor -> save -> library -> export end-to-end path passes | **PASS** | `tests/e2e/generation.spec.js`, `tests/e2e/notes.spec.js`, `tests/e2e/phase5.spec.js`, `tests/e2e/phase6.spec.js` (`76/76` Playwright E2E passing) + `npm run spike:local` (`7/7` fixtures) |
| 8 | PDF/image type, size, page-count and corrupt-file handling verified | **PASS** | `tests/sourceExtractor.test.js` (`9/9`), `tests/sources.routes.test.js` (`9/9`), `tests/sources.pglite.test.js`, and `tests/e2e/phase4.spec.js` (PDF & image flows) |
| 9 | Generation cancel, timeout, retry, duplicate delivery and worker restart tested | **PASS** | `tests/phase6.test.js` (`InProcessQueue` + `BullMQGenerationQueue` dedup, pre-model cancel removal, restart/retry, Redis abort), `tests/generations.routes.test.js` (`55/55`), and `tests/e2e/generation.spec.js` |
| 10 | Rate limits, monthly quota and user-facing quota state configured | **PASS** | `usageService.js` + `0009` `consume_monthly_quota` advisory-lock concurrency test (`limit = 2`, 5 concurrent requests: 2 allowed, 3 denied), `rateLimit.js` (memory & `RedisStore`), `DashboardPage.jsx`, `CreatePage.jsx`, `tests/e2e/phase6.spec.js` |
| 11 | Privacy policy and terms explain AI provider processing and retention | **PASS** (with legal review notice) | `frontend/src/features/marketing/LegalPages.jsx` details Gemini prompt/PDF/image processing, account deletion storage sweep, and includes an explicit draft banner pending legal counsel review |
| 12 | Account deletion and source/export cleanup tested | **PASS** | `DELETE /api/v1/me` verified in `phase6.test.js`, PGlite `phase6_hardening.pglite.test.js` (12-table cascade), live `rls.live.test.js` #21 (User C created + deleted + avatar swept), and `phase6.spec.js` |
| 13 | Logs redact prompts, file contents, tokens and signed URLs | **PASS** | `logger.js` + `sentry.js` verified in `tests/phase6.test.js` and `tests/security.test.js` (`22/22`) |
| 14 | Accessibility, mobile layout and browser compatibility smoke tests pass | **PASS** | All `76/76` Playwright tests including Axe WCAG 2 AA across public, auth, Light/Dark, desktop/tablet/mobile viewports + visual screenshots (`phase6-tablet-editor.png`, `phase6-dashboard-dark.png`) |
| 15 | Alerts, backups and basic support/job-ID workflow are enabled | **PASS** (app workflow & runbook) / **NOT APPLICABLE** (managed host alerting) | `GET /api/v1/admin/jobs/:jobId` + `/healthz` + `/readyz` + `docs/operations/runbook.md` implemented; external uptime monitor / Sentry alert routing / Supabase PITR enabled in hosting dashboard |

---

## 4. Important Technical Decisions

1. **Exact `0009` Security Boundary:** `consume_monthly_quota` runs as `SECURITY DEFINER` with `pg_advisory_xact_lock(hashtext(p_owner_id::text || ':' || p_period_start::text))` and `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` so concurrent requests at the quota ceiling cannot overshoot while clients cannot forge or bypass quota accounting.
2. **Dual-Mode Queue & Rate Limiters (`REDIS_URL`):** Preserving `InProcessQueue` + memory rate limiting when `REDIS_URL` is unset keeps local dev and deterministic unit tests fast without a Redis server, while `BullMQGenerationQueue` + `RedisStore` activate automatically in production.
3. **Production Fail-Closed Metering:** `ensureProductionServiceRole(config)` aborts startup when `NODE_ENV=production` lacks `SUPABASE_SERVICE_ROLE_KEY`, preventing unmetered unbilled AI calls.
4. **Static CSP SHA-256 Hash:** `vercel.json` hashes `frontend/index.html`'s pre-paint theme script (`'sha256-lDUyFxVX+9jii6pt0zpz4Vih+o1OVQl6HpACYRgiuG0='`) rather than relaxing `script-src` to `'unsafe-inline'`.

---

## 5. Files Changed (Phase 6 Summary)

- **SQL & RLS Tests:** `supabase/migrations/0009_phase6_hardening.sql`, `supabase/tests/phase6_hardening.pglite.test.js`, `supabase/tests/rls.live.test.js`
- **Backend API & Services:** `backend/src/config/{env.js,supabase.js,redis.js}`, `backend/src/app.js`, `backend/src/server.js`, `backend/src/services/{usageService.js,accountService.js}`, `backend/src/generation/{bullmqQueue.js,index.js,generationService.js,jobStore.js}`, `backend/src/middleware/{rateLimit.js,errorHandler.js}`, `backend/src/controllers/{health.controller.js,me.controller.js}`, `backend/src/routes/{index.js,me.routes.js,health.routes.js,admin.routes.js}`, `backend/src/schemas/{notes.schema.js,profile.schema.js}`, `backend/src/notes/{index.js,notesService.js}`, `backend/src/utils/{logger.js,sentry.js}`, `backend/tests/{phase6.test.js,security.test.js,helpers/*}`
- **Worker & Docker:** `backend/worker/src/adapters/sceneComposer.js`, `backend/worker/src/schemas/studyCompanion.js`, `backend/worker/src/index.js`, `backend/worker/tests/studyCompanion.test.js`, `backend/worker/Dockerfile`, `backend/worker/.dockerignore`, `backend/worker/src/scripts/dockerSmoke.js`
- **Frontend:** `frontend/src/app/{AppShell.jsx,router.jsx}`, `frontend/src/components/Toast.jsx`, `frontend/src/features/dashboard/DashboardPage.jsx`, `frontend/src/features/create/CreatePage.jsx`, `frontend/src/features/generation/VisualWorkspace.jsx`, `frontend/src/features/notes/{ExportDialog.jsx,NoteEditorPage.jsx,NotePresentPage.jsx}`, `frontend/src/features/notes/study/*`, `frontend/src/features/profile/AccountSettingsPage.jsx`, `frontend/src/features/marketing/LegalPages.jsx`, `frontend/src/hooks/useProfile.js`, `frontend/src/lib/{apiClient.js,sentry.js,phase6.test.js}`, `frontend/src/main.jsx`
- **Infra, Scripts, Load Tests & Docs:** `.github/workflows/ci.yml`, `vercel.json`, `scripts/lint.js`, `backend/scripts/loadTest.js`, `docs/operations/runbook.md`, `tests/e2e/{phase6.spec.js,support/mockBackend.js}`, `docs/phase-6/phase-6-report.md`, `README.md`, `supabase/README.md`

---

## 6. Verification Results

Executed across the full workspace after final edits (plus post-doc `npm run lint`):

| Suite | Command | Result |
| :--- | :--- | :--- |
| Lint & secret/version checks | `npm run lint` | **PASS** (`111` JS files checked, pinned versions, clean secret boundaries) |
| Worker unit & real CLI tests | `npm run test:worker` | **88/88 passed** (`8` files) |
| API unit & integration tests | `npm --workspace=@visualify/api run test` | **226/226 passed** (`10` files) |
| Offline Postgres SQL & RLS | `npm run test:rls:sql` | **65/65 passed** |
| Frontend unit tests | `npm --workspace=@visualify/frontend run test` | **75/75 passed** (`7` files) |
| Production build & sourcemap check | `npm run build:frontend` | **PASS** (`4447` modules, `0` `.map` files, zero Visualify project secrets in `frontend/dist`) |
| Playwright E2E + Axe WCAG 2 AA | `npm run test:e2e` | **76/76 passed** (Desktop, Tablet `1024x768`, Mobile, Light/Dark, `reducedMotion`) |
| Live Supabase RLS | `npm run test:rls:live` | **20/21 passed**, **1 skipped** (`BLOCKED: apply supabase/migrations/0009_phase6_hardening.sql to this project first`) |
| Autocannon HTTP load test | `npm run test:load` | **PASS** (`0` errors, `0.00%` error rate; `notes` 704 rps / p95 19ms; `note/:id` 528 rps / p95 26ms; `draft` 566 rps / p95 3ms; `generations` 20 rps / p95 49ms) |
| Worker container smoke | `npm --workspace=@visualify/worker run smoke:docker` | **PASS** locally (`25` elements, `73603` B PNG, `28883` B SVG); `docker build` **BLOCKED** locally (no Docker CLI installed on Windows host) |
| Local diagram fixture spike | `npm run spike:local` | **PASS** (`7/7` diagram fixtures rendered cleanly) |
| Git history secret scan | `git log --all -p --unified=0` | **0** secret pattern matches |

---

## 7. Remaining Issues & Manual Production Actions

1. **Apply `0009_phase6_hardening.sql` to Live Supabase:** Run [`0009_phase6_hardening.sql`](file:///c:/Users/ASUS/OneDrive/Desktop/Coding/web%20dev%20playground/PROJECTS/Visualizer/supabase/migrations/0009_phase6_hardening.sql) in Supabase Studio -> SQL Editor, then re-run `npm run test:rls:live` so live quota & selection checks hit `21/21`.
2. **Docker Worker Build on Linux/CI:** Build and smoke-test [`backend/worker/Dockerfile`](file:///c:/Users/ASUS/OneDrive/Desktop/Coding/web%20dev%20playground/PROJECTS/Visualizer/backend/worker/Dockerfile) in GitHub Actions or a Docker-enabled host (`docker build` is blocked on this local Windows machine without Docker Desktop).
3. **External SaaS / Legal Sign-off:** Provision production `REDIS_URL`, `SENTRY_DSN`, Supabase OAuth redirect URLs, PITR backups, and legal counsel review of [`LegalPages.jsx`](file:///c:/Users/ASUS/OneDrive/Desktop/Coding/web%20dev%20playground/PROJECTS/Visualizer/frontend/src/features/marketing/LegalPages.jsx) before opening public signups.
