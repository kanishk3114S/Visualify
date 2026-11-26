# Visualify — Supabase setup

Everything Supabase needs for Phases 1–6 lives here:

| File | Purpose |
| :--- | :--- |
| `migrations/0001_profiles_and_rls.sql` | `public.profiles`, `set_updated_at` trigger, `handle_new_user` signup trigger, grants, RLS policies, backfill for existing users |
| `migrations/0002_avatars_storage_bucket.sql` | Private `avatars` bucket (2 MiB, jpeg/png/webp) and `storage.objects` policies scoped to `{uid}/avatar-{uuid}.webp` |
| `migrations/0003_generation_jobs.sql` | Phase 2 `generation_jobs`: owner-scoped RLS, one active job per user (partial unique index), clients may only create/read/cancel; results are written server-side |
| `migrations/0004_folders_notes_versions_exports.sql` | Phase 3 `folders`, `notes`, `note_versions` (immutable), `note_drafts`, `note_exports`, `generation_jobs.note_id`, composite owner FKs, folder cycle/depth triggers, atomic `SECURITY INVOKER` RPCs |
| `migrations/0005_note_storage_buckets.sql` | Private `note-assets` (5 MiB PNG previews) and `note-exports` (25 MiB PNG/SVG/JSON) buckets scoped to `{uid}/{noteId}/...` |
| `migrations/0006_source_files.sql` | Phase 4 `public.source_files` table, RLS policies, `generation_jobs` source columns & `extracting` status, `notes.source_type`, `link_source_file_to_note`, and updated note RPCs |
| `migrations/0007_source_files_bucket.sql` | Private `source-files` bucket (20 MiB limit for PDF, JPEG, PNG, WebP) scoped to `{uid}/{sourceFileId}/...` |
| `migrations/0008_learning_companion.sql` | Phase 5 `note_quizzes`, `note_flashcards`, `note_revision_guides`, `usage_events`, `note_exports` (`zip`, `scope`, `frame_id`), `note-exports` `application/zip` MIME allowlist, `'regenerate'` version kind |
| `migrations/0009_phase6_hardening.sql` | Phase 6 `'selection'` export scope, extended `usage_events` event types & `consume_monthly_quota` advisory-lock RPC (`service_role` only) |
| `migrations/0010_launch_closeout.sql` | Phase 6.5 idempotent quota refunds (`usage_events.refunded_at` / `correlation_id` + `refund_usage_event`), zero-PII `product_events` table, and `compute_product_metrics` RPC |
| `tests/rls.pglite.test.js` | **Offline** verification of Phases 1–2 migrations on real Postgres (PGlite) — no credentials needed |
| `tests/notes.pglite.test.js` | **Offline** verification of Phase 3 migrations (`0004`, `0005`) on real Postgres (PGlite) |
| `tests/sources.pglite.test.js` | **Offline** verification of Phase 4 migrations (`0006`, `0007`) on real Postgres (PGlite) |
| `tests/learning_companion.pglite.test.js` | **Offline** verification of Phase 5 migration (`0008`) on real Postgres (PGlite) |
| `tests/phase6_hardening.pglite.test.js` | **Offline** verification of Phase 6 migration (`0009`), concurrent quota locks & 12-table account deletion cascade on PGlite |
| `tests/phase65_closeout.pglite.test.js` | **Offline** verification of Phase 6.5 migration (`0010`), idempotent quota refund RPC privileges, `product_events` RLS, and `compute_product_metrics` math on PGlite |
| `tests/rls.live.test.js` | **Live** cross-user verification against a real dev/staging project |
| `tests/supabase-stub.sql` | Minimal emulation of Supabase's `auth`/`storage` schemas used only by the offline test. **Never apply it to a real project.** |

Both migrations are idempotent (safe to re-run).

---

## 1. Create projects

Use a separate Supabase project for development/staging and for production (PRD 12.1).

## 2. Apply the migrations

**Option A — Supabase CLI (recommended)**

```powershell
npx supabase@latest login
npx supabase@latest link --project-ref <your-project-ref>
npx supabase@latest db push
```

`db push` applies every file in `supabase/migrations/` in filename order.

**Option B — Dashboard SQL editor**

Open *SQL Editor* → paste and run `0001_profiles_and_rls.sql`, then `0002_avatars_storage_bucket.sql`, then `0003_generation_jobs.sql` (Phase 2), then `0004_folders_notes_versions_exports.sql` and `0005_note_storage_buckets.sql` (Phase 3), then `0006_source_files.sql` and `0007_source_files_bucket.sql` (Phase 4), then `0008_learning_companion.sql` (Phase 5), then `0009_phase6_hardening.sql` (Phase 6), then `0010_launch_closeout.sql` (Phase 6.5).

**Check it worked** (SQL editor):

```sql
select relrowsecurity from pg_class where oid = 'public.profiles'::regclass;          -- true
select cmd, roles from pg_policies where tablename = 'profiles';                       -- 4 rows, {authenticated}
select id, public, file_size_limit from storage.buckets where id = 'avatars';          -- public = false
select tgname from pg_trigger where tgname = 'on_auth_user_created';                   -- 1 row
select cmd from pg_policies where tablename = 'generation_jobs';                        -- 4 rows (0003)
select indexname from pg_indexes where indexname = 'generation_jobs_one_active_per_owner'; -- 1 row (0003)
select tablename, rowsecurity from pg_tables where schemaname = 'public'
  and tablename in ('folders', 'notes', 'note_versions', 'note_drafts', 'note_exports', 'source_files', 'note_quizzes', 'note_flashcards', 'note_revision_guides', 'usage_events', 'product_events'); -- 11 rows, true (0004 + 0006 + 0008 + 0010)
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id in ('note-assets', 'note-exports', 'source-files'); -- public = false, includes application/zip on note-exports (0005 + 0007 + 0008)
```

## 3. Configure Auth URLs

*Authentication → URL Configuration*

| Setting | Local value | Production value |
| :--- | :--- | :--- |
| Site URL | `http://localhost:5173` | `https://<your-domain>` |
| Redirect URLs | `http://localhost:5173/auth/callback`<br>`http://localhost:5173/reset-password` | `https://<your-domain>/auth/callback`<br>`https://<your-domain>/reset-password` |

The app always redirects to these fixed paths (no query string); the post-login destination is kept in `sessionStorage` and re-validated, so no wildcard redirect URLs are needed.

## 4. Configure email/password

*Authentication → Providers → Email*

- Enable **Confirm email** (the app shows a "check your email" state and a resend button).
- Set **Minimum password length** to `8` to match the client-side rule (letter + number).
- The default email templates work: the app uses the PKCE flow, so links land on `/auth/callback?code=…` and `/reset-password?code=…`. Links must be opened in the **same browser** that started the flow.
- For real email volume, configure custom SMTP (the built-in sender is heavily rate-limited).

## 5. Configure Google OAuth

1. **Google Cloud Console** → *APIs & Services → OAuth consent screen*: configure the app (scopes `openid`, `email`, `profile`).
2. *Credentials → Create credentials → OAuth client ID* → **Web application**:
   - **Authorized JavaScript origins:** `http://localhost:5173` (and your production origin)
   - **Authorized redirect URI:** `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. **Supabase** → *Authentication → Providers → Google*: enable it and paste the Client ID and Client Secret.

Google's display name arrives as `full_name`/`name` metadata; `handle_new_user()` uses it when no `display_name` was supplied.

## 6. Fill in local env files

```powershell
Copy-Item frontend\.env.example frontend\.env.local
Copy-Item backend\.env.example backend\.env.local
```

- `frontend/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` only.
- `backend/.env.local`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `FRONTEND_ORIGIN`, …
- `SUPABASE_SERVICE_ROLE_KEY` is **not needed by the Phase 1 API**. Add it to `backend/.env.local` only to run the live RLS test, and never to any `VITE_` variable.

## 7. Verify

```powershell
npm run test:rls:sql    # offline: 65 SQL checks on real Postgres (PGlite)
npm run test:rls:live   # live: creates two throwaway users, checks cross-user isolation, deletes them
```

`test:rls:live` reports every test as skipped with `NOT RUN (BLOCKED on Supabase credentials …)` until `backend/.env.local` holds real dev-project values. It refuses to run with `NODE_ENV=production`.

## Security model (summary)

- RLS is enabled on `public.profiles` with explicit SELECT/INSERT/UPDATE/DELETE policies for `authenticated`, all `(select auth.uid()) = id`. No `USING (true)`.
- Grants are separate from policies: `anon` has no table access; `authenticated` can only update `display_name`, `username`, `bio`, `preferences`, `avatar_path` (never `id`, `created_at`, `updated_at`).
- A CHECK constraint forces `avatar_path` to match `{own id}/avatar-{uuid}.webp`, so a client can't point its profile at another user's object even through the Data API.
- `handle_new_user()` is `SECURITY DEFINER SET search_path = ''`, truncates names to the column limit so it can never block a signup, uses `ON CONFLICT DO NOTHING`, and is not executable by API roles.
- Storage policies only match `bucket_id = 'avatars'` inside the caller's own `{uid}/` folder; uploads must also match the server naming scheme.
- The Express API uses a **user-scoped** client (publishable key + the caller's JWT), so these policies apply to every API request as well (defence in depth).
