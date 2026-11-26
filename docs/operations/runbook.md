# Visualify Operations & Production Runbook

This runbook covers single-image split-role deployment (`Dockerfile`, `render.yaml`, Vercel), Supabase Auth configuration, staged CSP rollout, rollback, PITR database backup/restore drills, observability checks, and zero-PII support workflows (PRD §14.1–§14.3, §16.4–16.5, §18.3).

---

## 1. Environment & Secret Inventory

Never print or copy live credentials into tickets, terminal output, or `VITE_*` build variables.

| Service | Required Secret Env Vars | Public / Non-Secret Env Vars |
|:--|:--|:--|
| **Vercel Frontend** | *(none)* | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (must match `deploy/origins.json` API origin), optional `VITE_SENTRY_DSN` |
| **Render API (`PROCESS_ROLE=api`)** | `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `REDIS_URL`, optional `SENTRY_DSN` | `NODE_ENV=production`, `PROCESS_ROLE=api`, `FRONTEND_ORIGIN` (`deploy/origins.json` frontend origin(s), e.g. `https://visualify.vercel.app`), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `TRUST_PROXY=true`, `GENERATION_LIMIT_MONTHLY=50`, `RENDER_CONCURRENCY=2`, `SHUTDOWN_GRACE_MS=25000`, `ADMIN_USER_IDS` |
| **Render Worker (`PROCESS_ROLE=worker`)** | `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `REDIS_URL`, optional `SENTRY_DSN` | `NODE_ENV=production`, `PROCESS_ROLE=worker`, `WORKER_HEALTH_PORT=5001`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `GEMINI_MODEL=gemini-3.5-flash-lite`, `GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-3.5-flash`, `GENERATION_MAX_CONCURRENCY=2`, `RENDER_CONCURRENCY=2`, `SHUTDOWN_GRACE_MS=25000`, `EXCALIDRAW_BROWSER_PATH=/usr/bin/chromium` |

> **Fail-closed boot guards:**
> - When `NODE_ENV=production`, API and worker refuse to start if `SUPABASE_SERVICE_ROLE_KEY` is missing (`ensureProductionServiceRole`).
> - When `NODE_ENV=production` and `PROCESS_ROLE` is `api` or `worker`, boot fails closed if `REDIS_URL` is unset (`ensureProcessRoleConfig`).

---

## 2. Deployment Order & Click-Path (Staging & Production)

Always deploy **backward-compatible additive migrations first**, then split worker before API, then frontend:

1. **Apply database migrations (`supabase/migrations/0001..0010`):**
   - Link project: `npx supabase@latest link --project-ref <ref>` and run `npx supabase@latest db push` (or paste `0001` through `0010` sequentially in **Supabase Dashboard → SQL Editor**).
   - Verify live RLS & `0010` RPC privileges: `npm run test:rls:live`.
2. **Verify Supabase Auth & PITR dashboard settings:**
   - **Authentication → URL Configuration**:
     - **Site URL**: `http://localhost:5173` (local), `https://<staging-domain>` (staging), `https://<prod-domain>` (production).
     - **Redirect URLs**: exact allowlist only (`/auth/callback` and `/reset-password` for local, staging, and production origins — no wildcards).
   - **Authentication → Providers → Email**: enable **Confirm email**, set **Minimum password length = 8**, configure custom SMTP before public launch.
   - **Authentication → Providers → Google**: enable Google provider with Client ID + Secret from Google Cloud Console (`Authorized redirect URI`: `https://<ref>.supabase.co/auth/v1/callback`; `Authorized JS origins`: exact app origins).
   - **Database → Backups**: enable automated daily backups / Point-in-Time Recovery (PITR) on production project.
3. **Provision & deploy Render Redis + Worker + API (`render.yaml` / root `Dockerfile`):**
   - Single container image built from root `./Dockerfile` (`node:22-bookworm-slim` + non-root Chromium + `@visualify/api` + `@visualify/worker`).
   - CI validates container build (`docker build`, secret-free `docker history`, `dockerSmoke.js`, dummy-env `/healthz`).
   - Deploy Redis (`visualify-redis`) -> Worker (`PROCESS_ROLE=worker`, wait for `/readyz` HTTP `200` on `WORKER_HEALTH_PORT=4001`) -> API (`PROCESS_ROLE=api`, wait for `/healthz` + `/readyz` HTTP `200` confirming `supabase: ok`, `redis: ok`, `renderer: ok`).
4. **Deploy Static Frontend (Vercel via `vercel.json`):**
   - Build runs `npm run build:frontend` (`build.sourcemap: false`, `/spike/excalidraw` compiled out).
   - **CSP Staged Rollout:** First ship with `Content-Security-Policy-Report-Only`, verify zero console CSP errors across landing, auth, create, library, Excalidraw workspace, `/app/notes/:id/present`, and `/app/admin/metrics`, then promote to enforcing `Content-Security-Policy` in `vercel.json`.
5. **Run Staging Smoke Gate:**
   - Set env vars in terminal without echoing secrets and run `npm run smoke:staging` (checks `/healthz`, `/readyz`, fail-closed auth `401`, and CORS rejection against deployed staging API).

---

## 3. Rollback & Cancellation Semantics

- **Frontend:** Instant rollback to previous Vercel deployment alias.
- **API & Worker:** Re-pin both Render services to the previous Docker image digest / Git commit SHA. Both processes handle `SIGTERM`/`SIGINT` cleanly via `gracefulShutdown`, draining active work up to `SHUTDOWN_GRACE_MS` and invoking `recoverInterruptedJobs()` on timeout so interrupted jobs transition safely to `INTERRUPTED` and allow user **Retry** without duplicating notes.
- **Database:** Migrations `0001..0010` are additive (`if not exists`, `create or replace`). Never run destructive `DROP TABLE` rollbacks on production; patch forward cleanly.
- **Provider client-side timeout billing note:** Per-attempt planner/companion timeouts abort Visualify's HTTP socket immediately so failover or user error reporting stays fast. Google Gemini may still complete and bill an in-flight server generation after socket abort; Visualify limits `maxTransientRetries` (`1`) and `GEMINI_FALLBACK_MODELS` (`<= 3`), while `refund_usage_event` protects users' monthly quotas on `503`/`504`/provider failures (user-initiated cancellations and `422` validation errors do not refund).

---

## 4. PITR Database Backup & Restore Drill Procedure

Perform regularly against a **dev/staging** or scratch Supabase project (never overwrite production):

1. **Snapshot / PITR trigger:** Confirm Supabase PITR timeline / daily backup availability (or export staging snapshot via `npx supabase@latest db dump -f backup.sql --linked` with env-injected credentials).
2. **Restore into clean scratch DB / staging target:** Replay migrations `0001..0010` + restored data.
3. **Run automated SQL/live checks:** Run `npm run test:rls:sql` (`68/68`) and `npm run test:rls:live` (`22/22` against dev/staging).
4. **Verify post-restore invariants in SQL Editor:**
   ```sql
   -- All 14 exposed public tables have RLS enabled
   select tablename, rowsecurity from pg_tables where schemaname = 'public'
     and tablename in (
       'profiles', 'generation_jobs', 'folders', 'notes', 'note_versions',
       'note_drafts', 'note_exports', 'source_files', 'note_quizzes',
       'note_flashcards', 'note_revision_guides', 'usage_events', 'product_events'
     );
   -- Private storage buckets remain private
   select id, public from storage.buckets where id in ('avatars', 'note-assets', 'note-exports', 'source-files');
   -- Privileged RPCs remain restricted to service_role
   select routine_name, grantee, privilege_type
     from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name in ('consume_monthly_quota', 'refund_usage_event', 'compute_product_metrics');
   ```
5. Record drill date, operator, measured Recovery Time Objective (RTO), and SQL verification output.

---

## 5. Health Probes, Alerts & Telemetry

- **`GET /healthz`** (API & Worker port `4001`): Process liveness probe (`{ status: "ok", role, uptimeSeconds }`). Point Render health checks here.
- **`GET /readyz`**: Readiness probe verifying Supabase Auth health, Redis `PING`, and Chromium binary presence (`200` ok or `503 SERVICE_DEGRADED` with safe enum values).
- **Alert thresholds:**
  - `/readyz` returns `503` for > 2 minutes.
  - API `5xx` rate > 1% over 5 minutes reported to Sentry (`sendDefaultPii: false`).
  - Sustained BullMQ backlog or elevated `PROVIDER_TRANSIENT_ERROR` / `PROVIDER_TIMEOUT` / `CLI_EXEC_FAILED` counts.

---

## 6. Operator Support & Product Metrics Workflow (Zero PII)

Users reporting issues provide only **`jobId`**, **`requestId`**, and approximate UTC timestamp:

1. Operators with `app_metadata.role === "admin"` or UUID in `ADMIN_USER_IDS` inspect individual failed runs via `GET /api/v1/admin/jobs/<jobId>` (strictly redacted: no prompts, scenes, filenames, or emails).
2. Aggregated PRD §14.1 launch metrics are available via `GET /api/v1/admin/metrics?from=&to=` (capped at 90 days) and in the workspace at `/app/admin/metrics` (sidebar link shown only when `profile.isAdmin` is `true`; backend always enforces `403 FORBIDDEN`).
3. Cross-reference `requestId` or `jobId` in structured Pino logs (tokens, signed URLs, prompts, and emails are scrubbed automatically).
