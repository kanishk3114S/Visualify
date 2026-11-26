# Visualify Operations & Production Runbook

This runbook covers deployment sequencing, staged CSP rollout, rollback, database backup/restore drills, observability checks, and user support workflows (PRD §16.4–16.5 & §18.3).

---

## 1. Environment & Secret Inventory

Never print or copy live credentials into tickets, logs, or `VITE_*` build variables.

| Service | Required Secret Env Vars | Public / Non-Secret Env Vars |
|:--|:--|:--|
| **Vercel Frontend** | *(none)* | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`, optional `VITE_SENTRY_DSN` |
| **Render API** | `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, optional `REDIS_URL`, optional `SENTRY_DSN` | `NODE_ENV=production`, `FRONTEND_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `TRUST_PROXY=true`, `GENERATION_LIMIT_MONTHLY` |
| **Render Worker** | `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, optional `REDIS_URL` | `NODE_ENV=production`, `GEMINI_MODEL`, `EXCALIDRAW_BROWSER_PATH=/usr/bin/chromium` |

> **Fail-closed boot guard:** When `NODE_ENV=production`, the API refuses to start if `SUPABASE_SERVICE_ROLE_KEY` is missing (`ensureProductionServiceRole`).

---

## 2. Deployment Order (Backward-Compatible Releases)

Follow this strict order for staging and production releases:

1. **Apply database migrations first (`supabase/migrations/0001..0009`):**
   - Run `npx supabase@latest db push` (or paste additive idempotent `.sql` files sequentially into Supabase SQL Editor).
   - Run `npm run test:rls:live` against staging to verify `19/19` (and Phase 6 checks) pass.
2. **Deploy Redis & Worker image (`backend/worker/Dockerfile`):**
   - Build image and run container smoke check: `docker run --rm visualify-worker`.
   - Confirm `tcp-handshake` converts and renders to PNG & SVG via non-root Chromium.
3. **Deploy Express API service:**
   - Verify `/healthz` returns HTTP `200` and `/readyz` returns HTTP `200` (`supabase: ok`, `redis: ok`, `renderer: ok`).
4. **Deploy Static Frontend (Vercel via `vercel.json`):**
   - Build uses `vite build` (`build.sourcemap: false`, `/spike/excalidraw` omitted in production).
   - **CSP Staged Rollout:** First ship policy headers with `Content-Security-Policy-Report-Only`, verify zero browser CSP violations across landing, auth, library, workspace (Excalidraw), and presentation mode, then promote to enforcing `Content-Security-Policy` in `vercel.json`.

---

## 3. Rollback Procedure

- **Frontend:** Instant rollback to prior Vercel deployment alias (static HTML/assets are self-contained).
- **API & Worker:** Re-pin Render service to previous Docker tag / commit SHA. Active jobs left in flight during process termination are safely marked `INTERRUPTED` by `recoverInterruptedJobs()` so learners can click **Retry** without creating duplicate notes.
- **Database:** Migrations `0001..0009` are additive (`create table if not exists`, `add column if not exists`, `create or replace function`). Never run destructive `DROP TABLE` rollbacks on production data; patch forward cleanly.

---

## 4. Database Backup & Restore Drill Procedure

Perform this drill regularly against the **dev/staging** Supabase project (never overwrite production):

1. **Verify scheduled backups / export snapshot:**
   - Supabase automated daily backups (or `npx supabase@latest db dump -f backup.sql --linked` in a restricted CI/admin runner with `PGPASSWORD` via env).
2. **Restore test into scratch schema or dev project:**
   - Replay `0001..0009` plus snapshot data into a clean database / PGlite instance and execute `npm run test:rls:sql` + `npm run test:rls:live`.
3. **Verify invariants post-restore:**
   - Confirm RLS enabled on all 13 public tables (`profiles`, `generation_jobs`, `folders`, `notes`, `note_versions`, `note_drafts`, `note_exports`, `source_files`, `note_quizzes`, `note_flashcards`, `note_revision_guides`, `usage_events`).
   - Confirm private storage buckets (`avatars`, `note-assets`, `note-exports`, `source-files`) have `public = false`.
4. **Record drill date, operator, elapsed recovery time (RTO), and test exit code.**

---

## 5. Health Probes, Alerts & Telemetry

- **`GET /healthz`**: Fast process liveness probe (`{ status: "ok", uptimeSeconds }`). Point platform restart checks here.
- **`GET /readyz`**: Readiness probe verifying Supabase Auth health, Redis `PING` (when `REDIS_URL` is configured), and Chromium binary presence (`200` ok or `503 SERVICE_DEGRADED` with safe status enums only).
- **Alert thresholds:**
  - `/readyz` returns `503` for > 2 minutes.
  - Elevated API `5xx` rate (> 1% over 5 minutes) reported to Sentry (`sendDefaultPii: false`).
  - Sustained Redis / BullMQ queue backlog or elevated `PLANNER_TIMEOUT` / `CLI_EXEC_FAILED` error codes in logs.

---

## 6. Support Job-ID Workflow (Zero-PII Diagnostics)

Users reporting a failed generation provide only their **`jobId`**, **`requestId`**, and timestamp — **never** ask them to email raw source PDFs unless explicitly escalated:

1. An operator listed in `ADMIN_USER_IDS` (or carrying `app_metadata.role === "admin"`) queries:
   `GET /api/v1/admin/jobs/<jobId>` (authenticated Bearer JWT).
2. API verifies admin authorization (`403 FORBIDDEN` for standard users) and returns strictly redacted metadata: `status`, `stage`, `attemptCount`, `modelId`, `errorCode`, and timestamps (zero prompts, scenes, filenames, or email addresses).
3. Cross-reference `requestId` or `jobId` in structured Pino logs (tokens, signed URLs, prompts, and emails are automatically scrubbed).
