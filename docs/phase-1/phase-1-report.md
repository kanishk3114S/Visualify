# Visualify — Phase 1 Report: Foundation, Identity, RLS & App Shell

**Date:** 25 November 2026
**Status:** Implemented and verified offline. **Live Supabase verification NOT RUN** (blocked on project credentials; see §5).

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

## 5. Remaining issues / not verified

- **NOT RUN (BLOCKED on Supabase credentials):** `npm run test:rls:live`, and any real signup, email verification, password recovery or Google OAuth round trip. The API tests use an in-memory Supabase double; the E2E tests mock `/api/v1` and seed a fake session. Complete `supabase/README.md` §2–§7, then run `npm run test:rls:live` and a manual click-through.
- **Staging is not live** (PRD Phase 1 exit criterion). No hosting accounts were configured. When the frontend is hosted, add the security headers/CSP at the host layer (e.g. `vercel.json`). The CSP must allow the Supabase origin, the API origin, and Excalidraw's font CDN if the editor preview is kept.
- `npm audit` reports advisories in `katex`/`lodash-es`/`mermaid`, pulled in by `@excalidraw/excalidraw` and `@excalidraw/cli`. These versions are identical to the Phase 0 lockfile and need an upstream Excalidraw update.
- Main JS chunk is 680 kB (201 kB gzipped): React, supabase-js, router, Query and Zod. Route-level code splitting is a reasonable later optimisation.
- Account deletion (FR-AUTH-07, P1) is shown as "Coming later". Theme preference is stored but not exposed, since there is no dark theme yet.
- Rate limits use in-memory stores (per process). A shared store is needed once the API runs on more than one instance.

## 6. Next priority

Connect a real Supabase dev project. Apply the migrations, configure Auth URLs and Google, and fill both `.env.local` files. Then run `npm run test:rls:live` plus a manual signup → verify → profile → avatar → sign-out walkthrough. That closes the only open Phase 1 exit criterion besides staging.
