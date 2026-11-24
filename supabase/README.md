# Visualify — Supabase setup (Phase 1)

Everything Supabase needs for Phase 1 lives here:

| File | Purpose |
| :--- | :--- |
| `migrations/0001_profiles_and_rls.sql` | `public.profiles`, `set_updated_at` trigger, `handle_new_user` signup trigger, grants, RLS policies, backfill for existing users |
| `migrations/0002_avatars_storage_bucket.sql` | Private `avatars` bucket (2 MiB, jpeg/png/webp) and `storage.objects` policies scoped to `{uid}/avatar-{uuid}.webp` |
| `tests/rls.pglite.test.js` | **Offline** verification of the migrations on real Postgres (PGlite) — no credentials needed |
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

Open *SQL Editor* → paste and run `0001_profiles_and_rls.sql`, then `0002_avatars_storage_bucket.sql`.

**Check it worked** (SQL editor):

```sql
select relrowsecurity from pg_class where oid = 'public.profiles'::regclass;          -- true
select cmd, roles from pg_policies where tablename = 'profiles';                       -- 4 rows, {authenticated}
select id, public, file_size_limit from storage.buckets where id = 'avatars';          -- public = false
select tgname from pg_trigger where tgname = 'on_auth_user_created';                   -- 1 row
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
npm run test:rls:sql    # offline: 26 SQL checks on real Postgres (PGlite)
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
