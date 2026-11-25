# Visualify — Phase 1 Report: Foundation, Identity, RLS & App Shell

**Date:** 25 November 2026
**Status:** Implemented and verified offline. Live Supabase project connected and partly verified (§4b). **Phase 1 is NOT closed:** the migrations have not been applied to the live project yet, and `test:rls:live` is blocked on `SUPABASE_SERVICE_ROLE_KEY` (§5).

---

## 1. What was built

| Area | Delivered |
| :--- | :--- |
| **Database** (`supabase/migrations/`) | `public.profiles` (+ case-insensitive unique username, `updated_at` trigger), `handle_new_user()` signup trigger (security definer, `search_path = ''`, can't block signups), backfill for existing users, column-level grants, explicit per-command RLS. Private `avatars` bucket + `storage.objects` policies scoped to `{uid}/avatar-{uuid}.webp`. |
| **API** (`backend/`, `@visualify/api`) | Express 5 (ESM). Helmet (deny-all CSP, HSTS, `X-Frame-Options: DENY`, nosniff, strict referrer), CORS allowlist that rejects other origins with 403, rate limits (API-wide per IP; per-user limits on profile/avatar changes), pino logging (no headers, query strings, tokens or emails), standard `{ success, data, error, meta.requestId }` envelope, generic 500s. |
| **Endpoints** | `GET /api/v1/health` (public), `GET/PATCH /api/v1/me`, `POST/DELETE /api/v1/me/avatar` (all protected by `requireAuth`, which runs before any body or upload parsing). |
| **Avatar pipeline** | multer memory storage with size limit → **magic-byte** check (`file-type`) → dimension limit (≤4096², decompression-bomb guard) → `sharp` auto-orient, 256×256 cover crop, re-encode to WebP (all metadata stripped) → UUID path → profile update (rolled back if it fails) → old object cleanup → 300 s signed URL. |
| **Frontend** (`frontend/src/`) | Tailwind v4, React Router 7 (React-18 compatible), TanStack Query, RHF + Zod, supabase-js (PKCE). Public pages `/`, `/features`, `/privacy`, `/terms`, `/404`. Auth: `/login`, `/signup` (email verification state + resend), `/forgot-password`, `/reset-password`, `/auth/callback`, Google OAuth. Protected shell: `/app`, `/app/profile`, `/app/settings`, `/app/settings/account`, `/app/settings/preferences`. |
| **Phase 0 harness** | Moved unchanged to `/spike/excalidraw` (lazy-loaded, so Excalidraw never loads on other routes). |

## 2. Important technical decisions

1. **User-scoped Supabase client in the API, no service role.** Every API request runs with the publishable key plus the caller's verified JWT, so Postgres RLS and Storage policies apply *in addition to* the API's own checks. `SUPABASE_SERVICE_ROLE_KEY` is optional and unused in Phase 1 request paths.
2. **Identity only from the token.** `PATCH /me` uses a strict Zod object: unknown fields (including `id`/`owner_id`) are rejected with 400, and updates always filter by the verified user id.
3. **DB-level path ownership.** A CHECK constraint forces `profiles.avatar_path` to match `{own id}/avatar-{uuid}.webp`, which blocks pointing a profile at another user's object via the Data API.
4. **Auth outage ≠ signed out.** If Supabase Auth is unreachable, `requireAuth` returns 503, not 401, so clients don't wrongly sign users out.
5. **`returnTo` via sessionStorage for OAuth.** Supabase redirect URLs stay fixed paths (no wildcards). The destination is re-sanitized on read: same-origin only; rejects `//`, `\`, control characters (including tab/newline), schemes and auth pages.
6. **PKCE callbacks handled by supabase-js init.** The callback and reset pages wait for session initialisation instead of exchanging codes themselves, which avoids double exchanges under StrictMode.
7. **React Router 7, not 8.** Router 8 requires React 19; React 18.3.1 stays pinned per the Phase 0 decision.
8. **Offline SQL verification with PGlite.** No Docker or Supabase CLI was available, so the real migration files run on real Postgres (WASM) against a minimal stub of Supabase's `auth`/`storage` schemas and roles.

All new dependencies are pinned exactly, at versions at least two weeks old on npm.

## 3. Files changed

- `package.json`: workspaces now `frontend`, `backend`, `backend/worker`; new scripts `dev:api`, `test:api`, `test:frontend`, `test:rls:sql`, `test:rls:live`. `npm test` runs worker, API, SQL and frontend suites.
- `supabase/`: `migrations/0001…`, `migrations/0002…`, `tests/` (offline and live RLS), `README.md` (setup guide).
- `backend/`: `src/{config,middleware,routes,controllers,services,schemas,utils}`, `app.js`, `server.js`, `tests/` (Vitest + Supertest, in-memory Supabase double that enforces RLS-equivalent ownership).
- `frontend/`: `src/{app,components,features,hooks,lib,styles}`, `vite.config.js` (Tailwind plugin; `sourcemap: false` and React dedupe kept), `.env.example`.
- `backend/.env.example`, `frontend/.env.example`: Phase 1 placeholders only.
- `playwright.config.js`, `tests/e2e/app-shell.spec.js`, `tests/e2e/support/mockBackend.js`. `tests/e2e/excalidraw.spec.js`: only the URL changed (`/` → `/spike/excalidraw`).
- `backend/worker/`: **unchanged**.

## 4. Verification (commands actually run)

| Command | Result |
| :--- | :--- |
| `npm test` (worker) | **38/38 passed**: Phase 0 baseline intact |
| `npm run test:api` | **133/133 passed**: health, auth middleware, `/me` CRUD + validation + ownership, avatar magic bytes / size / dimensions / EXIF stripping / rollback / old-object cleanup, Helmet headers, CORS, rate limits, log redaction, no stack traces, config validation |
| `npm run test:rls:sql` | **26/26 passed**: trigger (including fallbacks and truncation), cascade, grants, RLS for all 4 commands, cross-user denial on profiles and storage, anon denial, constraints, idempotent re-apply |
| `npm run test:frontend` | **31/31 passed**: `returnTo` sanitizer |
| `npx playwright test` | **31/31 passed**: public pages with zero console errors, guard redirects with no protected-UI flash, open-redirect cases, form validation, callback/reset error states, mocked-API profile/avatar/preferences/account flows, sign-out, mobile nav and overflow, **Phase 0 Excalidraw spec** |
| `npm run build:frontend` | PASS; no `.map` files emitted |
| `npm run spike:local` | `"status": "PASS"` |
| Secret scans | No server secrets in `frontend/src` or `frontend/dist`. The only match was supabase-js library code checking whether a key starts with `sb_secret_`. Frontend reads only the 3 `VITE_*` variables. All `.env.local` paths are git-ignored; only `.env.example` files are tracked. |
| `npm audit --omit=dev -w @visualify/api` | 0 vulnerabilities |

## 4b. Live Supabase verification (25 November 2026)

No keys, project refs or tokens appear in this report.

**Env file cleanup**
- The real `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` had been placed in the tracked `backend/.env.example` (uncommitted). They were moved to `backend/.env.local`, and `backend/.env.example` was restored to its placeholders (`git diff` on it is now empty).
- `frontend/.env` was renamed to `frontend/.env.local`, so all local config follows the `.env.local` convention.
- `git status --ignored` shows `backend/.env.local`, `frontend/.env.local` and `backend/worker/.env.local` as ignored (`!!`).
- A value-based scan shows neither real value in any tracked file or anywhere in git history.
- Both keys are `sb_publishable_` keys (not secret keys) for the same project.
- **Disclosure:** during the history check, a failed `git grep` command echoed the project ref and the publishable key into one terminal output. That key is browser-public by design (it is bundled into the frontend), but rotating it in the Supabase dashboard is reasonable if that output may be shared. The service-role key was never present or printed.

**Live project state (probed with the publishable key)**

| Probe | Result | Meaning |
| :--- | :--- | :--- |
| `GET /auth/v1/health` | 200 | Auth reachable |
| `GET /rest/v1/profiles` (anon) | 404 `PGRST205` table not found | **Migration 0001 NOT applied** |
| `GET /storage/v1/object/public/avatars/…` | 400 "Bucket not found" | **Migration 0002 NOT applied** |
| `GET /auth/v1/settings` | email: on, confirm email: required, signups: open, **google: disabled** | Google OAuth not configured yet |

The Supabase CLI isn't installed or linked here and no DB credentials are available, so the migrations were **not** applied (that needs the owner's action; see §6).

**Live API (real `server.js`, real Supabase Auth)**

| Check | Result |
| :--- | :--- |
| `GET /api/v1/health` | **200** `{ success: true, data: { status: "ok", checks: { api: "ok", supabase: "ok" } } }`, no URL/key/version leaked in body or headers |
| `GET /api/v1/me` without a token | **401** `UNAUTHORIZED` |
| `GET /api/v1/me` with a forged JWT (verified by live Supabase Auth) | **401** `INVALID_TOKEN` |
| Request from `https://evil.example` | **403** `CORS_NOT_ALLOWED` |
| API log | 7 lines; no ref, key, token or `authorization` field |

**Live frontend (real Vite + `frontend/.env.local` + real API, headless Chrome)**
- `/features`, `/signup` and `/login` render with **0** console/page errors, and the real Supabase client initialises (no config-error screen).
- `/app/profile` redirects to `/login?returnTo=%2Fapp%2Fprofile`.
- Signing in with a non-existent account makes a real `POST /auth/v1/token` round trip and shows "Email or password is incorrect." The only console entry is the browser's expected 400 for that request. No account or data was created.

**Not run live (blocked):** the signup → `GET /me` → `PATCH /me` → avatar upload/delete flow, because the `profiles` table and `avatars` bucket don't exist yet. Also blocked are `npm run test:rls:live` and Google OAuth.

**Post-change regression:** `npm test` (38 + 133 + 26 + 31) all pass, `npm run build:frontend` passes, `npx playwright test` 31/31. The bundle scan finds no Gemini key, service-role key, `sb_secret_` key or service-role JWT. The only Google-style `AIza…` string is `@excalidraw/excalidraw`'s own public Firebase relay config, in the lazy editor-preview chunk (already noted in Phase 0).

## 5. Remaining issues / not verified

- **Migrations not applied to the live project.** Run `supabase/migrations/0001_profiles_and_rls.sql`, then `0002_avatars_storage_bucket.sql` (SQL Editor or `supabase db push`; see `supabase/README.md` §2).
- **`npm run test:rls:live`: NOT RUN (BLOCKED on SUPABASE_SERVICE_ROLE_KEY in backend/.env.local)**. It also needs the migrations applied first. The skip message now names the exact missing variable.
- **Live profile/avatar flow and email-verification/password-reset round trips:** not run (need the migrations, then a real inbox). The API tests use an in-memory Supabase double; the E2E tests mock `/api/v1` and seed a fake session.
- **Google OAuth:** disabled on the project. Configure it per `supabase/README.md` §5, then do a manual click-through.
- **Auth URL configuration** (Site URL + `/auth/callback`, `/reset-password` redirect URLs) and minimum password length 8 could not be inspected with the publishable key. Confirm per `supabase/README.md` §3–§4.
- **Staging is not live** (PRD Phase 1 exit criterion). No hosting accounts were configured. When the frontend is hosted, add the security headers/CSP at the host layer (e.g. `vercel.json`). The CSP must allow the Supabase origin, the API origin, and Excalidraw's font CDN if the editor preview is kept.
- `npm audit` reports advisories in `katex`/`lodash-es`/`mermaid`, pulled in by `@excalidraw/excalidraw` and `@excalidraw/cli`. These versions are identical to the Phase 0 lockfile and need an upstream Excalidraw update.
- Main JS chunk is 680 kB (201 kB gzipped): React, supabase-js, router, Query and Zod. Route-level code splitting is a reasonable later optimisation.
- Account deletion (FR-AUTH-07, P1) is shown as "Coming later". Theme preference is stored but not exposed, since there is no dark theme yet.
- Rate limits use in-memory stores (per process). A shared store is needed once the API runs on more than one instance.

## 6. Next priority

1. Apply both migrations to the dev project and run the verification queries in `supabase/README.md` §2.
2. Add `SUPABASE_SERVICE_ROLE_KEY` to `backend/.env.local` only, then run `npm run test:rls:live`. It creates and deletes two throwaway users.
3. Do a manual signup → email confirm → profile edit → avatar upload/remove → sign-out walkthrough with `npm run dev:api` and `npm run dev:frontend`.
4. Enable Google OAuth and click through once.

Completing these, plus a staging deployment, closes Phase 1.
