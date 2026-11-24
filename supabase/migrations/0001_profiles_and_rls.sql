-- =============================================================================
-- Visualify Phase 1 - 0001: profiles table, auth trigger, grants and RLS
-- =============================================================================
-- Idempotent: safe to re-run. Applies to Supabase Postgres (auth + storage
-- schemas are managed by Supabase; this migration never alters auth tables).
-- PRD refs: Section 10.2 (profiles), 10.4 (rules), 10.5 (RLS), 10.7 (trigger).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default ''
    constraint profiles_display_name_length check (char_length(display_name) <= 80),
  username text null
    constraint profiles_username_format check (username is null or username ~ '^[a-zA-Z0-9_]{3,30}$'),
  avatar_path text null,
  bio text not null default ''
    constraint profiles_bio_length check (char_length(bio) <= 300),
  preferences jsonb not null
    default '{"theme":"light","defaultExportFormat":"png","learningLevel":"undergraduate"}'::jsonb
    constraint profiles_preferences_is_object check (jsonb_typeof(preferences) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One profile per auth.users row. id is the ownership key (PRD 10.2).';

-- Defence in depth: an avatar path can only ever point inside the owner''s own
-- folder and must follow the server-generated {uid}/avatar-{uuid}.webp shape.
-- This blocks a client from pointing its profile at another user''s object even
-- if it updates the row directly through the Data API.
alter table public.profiles drop constraint if exists profiles_avatar_path_owner;
alter table public.profiles add constraint profiles_avatar_path_owner check (
  avatar_path is null
  or avatar_path ~ (
    '^' || id::text
    || '/avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  )
);

-- Case-insensitive uniqueness for usernames (PRD 10.4).
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

-- -----------------------------------------------------------------------------
-- 2. updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Profile creation trigger on auth.users (PRD 10.7, FR-AUTH-06)
-- -----------------------------------------------------------------------------
-- Kept minimal and failure-proof: the display name is trimmed and truncated to
-- the column limit so the CHECK constraint can never reject (and thereby block)
-- a signup, and ON CONFLICT makes re-delivery harmless.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        split_part(coalesce(new.email, ''), '@', 1),
        ''
      ),
      80
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Security-definer functions must never be callable through the Data API (RPC).
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: users created before this migration also get a profile row.
insert into public.profiles (id, display_name)
select
  u.id,
  left(
    coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(u.email, ''), '@', 1),
      ''
    ),
    80
  )
from auth.users u
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Grants (separate control from RLS - PRD 10.5)
-- -----------------------------------------------------------------------------
-- Supabase grants ALL on new public tables to anon/authenticated by default.
-- Anonymous visitors never need profiles; authenticated users get only the
-- column privileges they need. id / created_at / updated_at are not updatable.
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;

grant select on table public.profiles to authenticated;
grant insert (id, display_name, username, bio, preferences) on table public.profiles to authenticated;
grant update (display_name, username, bio, preferences, avatar_path) on table public.profiles to authenticated;
grant delete on table public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security - explicit per-command owner policies
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can delete their own profile" on public.profiles;
create policy "Users can delete their own profile"
  on public.profiles for delete to authenticated
  using ((select auth.uid()) = id);
