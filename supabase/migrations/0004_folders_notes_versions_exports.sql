-- =============================================================================
-- Visualify Phase 3 - 0004: folders, notes, note_versions, note_drafts,
--                           note_exports (+ generation_jobs.note_id)
-- =============================================================================
-- Idempotent where practical (tables use IF NOT EXISTS, policies/functions are
-- replaced). Requires Postgres 15+ (column-list ON DELETE SET NULL).
-- PRD refs: 5.6 (autosave/snapshots), 5.7 (library), 5.8 (exports),
--           10.2-10.5 (tables, relationships, RLS).
--
-- Data model:
--   * note_versions are IMMUTABLE snapshots (no UPDATE/DELETE grant). Version 1
--     comes from the generation job; explicit snapshots and restores append.
--   * note_drafts holds the AUTOSAVED working copy (one row per note) with an
--     optimistic-concurrency revision. Creating a version clears the draft.
--   * Restore never destroys anything: an unsnapshotted draft is first kept as
--     its own version, then the restored scene becomes a NEW current version.
--   * Cross-user references are impossible even through the Data API:
--     composite foreign keys tie folder/version/note rows to the same owner.
--   * Multi-row writes go through SECURITY INVOKER functions (atomic, and RLS
--     still applies because they run as the calling user).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- folders
-- -----------------------------------------------------------------------------
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null
    constraint folders_name_length check (char_length(btrim(name)) between 1 and 80),
  parent_id uuid null,
  sort_order integer not null default 0
    constraint folders_sort_order_range check (sort_order between -1000000 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint folders_not_own_parent check (parent_id is null or parent_id <> id),
  constraint folders_id_owner_key unique (id, owner_id),
  -- A parent must belong to the same owner; deleting it moves children to root.
  constraint folders_parent_same_owner foreign key (parent_id, owner_id)
    references public.folders (id, owner_id) on delete set null (parent_id)
);

create index if not exists folders_owner_parent_idx on public.folders (owner_id, parent_id, sort_order);
-- Sibling folder names are unique per owner (case-insensitive).
create unique index if not exists folders_unique_sibling_name
  on public.folders (owner_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

drop trigger if exists folders_set_updated_at on public.folders;
create trigger folders_set_updated_at before update on public.folders
  for each row execute function public.set_updated_at();

-- Reject cycles (moving a folder into itself or a descendant) and over-deep trees.
create or replace function public.folders_prevent_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  depth integer := 0;
  cursor_id uuid := new.parent_id;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'folder_cycle' using errcode = '23514', hint = 'A folder cannot be moved into itself or one of its subfolders.';
    end if;
    depth := depth + 1;
    if depth > 8 then
      raise exception 'folder_too_deep' using errcode = '23514', hint = 'Folders can be nested at most 8 levels deep.';
    end if;
    select f.parent_id into cursor_id from public.folders f where f.id = cursor_id;
  end loop;
  return new;
end;
$$;

drop trigger if exists folders_prevent_cycle on public.folders;
create trigger folders_prevent_cycle before insert or update of parent_id on public.folders
  for each row execute function public.folders_prevent_cycle();

-- -----------------------------------------------------------------------------
-- notes
-- -----------------------------------------------------------------------------
create or replace function public.note_tags_valid(tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(t) between 1 and 40 and t = lower(btrim(t))), true)
  from unnest(tags) as t
$$;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  folder_id uuid null,
  title text not null
    constraint notes_title_length check (char_length(btrim(title)) between 1 and 160),
  description text not null default ''
    constraint notes_description_length check (char_length(description) <= 1000),
  subject text not null default ''
    constraint notes_subject_length check (char_length(subject) <= 120),
  topic text not null default ''
    constraint notes_topic_length check (char_length(topic) <= 120),
  tags text[] not null default '{}'
    constraint notes_tags_valid check (cardinality(tags) <= 20 and public.note_tags_valid(tags)),
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  visibility text not null default 'private'
    constraint notes_visibility check (visibility in ('private')),
  current_version_id uuid null,
  source_type text not null default 'prompt'
    constraint notes_source_type check (source_type in ('prompt')),
  preview_path text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz null,
  search_tsv tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(topic, ''))
  ) stored,
  constraint notes_id_owner_key unique (id, owner_id),
  -- A note can only live in one of its owner's folders; deleting the folder moves it to root.
  constraint notes_folder_same_owner foreign key (folder_id, owner_id)
    references public.folders (id, owner_id) on delete set null (folder_id),
  constraint notes_preview_path_owner check (
    preview_path is null or preview_path like (owner_id::text || '/' || id::text || '/%')
  )
);

create index if not exists notes_owner_updated_idx on public.notes (owner_id, updated_at desc);
create index if not exists notes_owner_opened_idx on public.notes (owner_id, last_opened_at desc nulls last);
create index if not exists notes_owner_folder_idx on public.notes (owner_id, folder_id);
create index if not exists notes_owner_title_idx on public.notes (owner_id, lower(title));
create index if not exists notes_tags_gin on public.notes using gin (tags);
create index if not exists notes_search_gin on public.notes using gin (search_tsv);

-- updated_at tracks CONTENT changes only: opening a note (last_opened_at) or a
-- background preview refresh (preview_path) must not reorder "Recently updated".
-- Clients have no grant on updated_at, so any other change to it comes from the
-- privileged draft trigger below and is kept as-is.
create or replace function public.notes_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'last_opened_at' - 'updated_at' - 'search_tsv' - 'preview_path')
     is distinct from (to_jsonb(old) - 'last_opened_at' - 'updated_at' - 'search_tsv' - 'preview_path') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at before update on public.notes
  for each row execute function public.notes_touch_updated_at();

-- -----------------------------------------------------------------------------
-- note_versions (immutable)
-- -----------------------------------------------------------------------------
create table if not exists public.note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  version_number integer not null
    constraint note_versions_number_positive check (version_number >= 1),
  kind text not null default 'snapshot'
    constraint note_versions_kind check (kind in ('generated', 'snapshot', 'draft', 'restore', 'duplicate')),
  scene_json jsonb not null
    constraint note_versions_scene_is_object check (jsonb_typeof(scene_json) = 'object'),
  learning_plan jsonb null,
  mermaid_source text null,
  schema_version text not null default '1',
  description text not null default ''
    constraint note_versions_description_length check (char_length(description) <= 200),
  created_by_job_id uuid null references public.generation_jobs (id) on delete set null,
  restored_from_version_id uuid null,
  created_at timestamptz not null default now(),
  constraint note_versions_note_number_key unique (note_id, version_number),
  constraint note_versions_id_note_key unique (id, note_id),
  constraint note_versions_note_same_owner foreign key (note_id, owner_id)
    references public.notes (id, owner_id) on delete cascade
);

create index if not exists note_versions_note_created_idx on public.note_versions (note_id, version_number desc);
-- A generation job can be saved as a note only once (makes double-saves atomic no-ops).
create unique index if not exists note_versions_one_note_per_job
  on public.note_versions (created_by_job_id) where kind = 'generated' and created_by_job_id is not null;

-- notes.current_version_id must point at a version OF THIS NOTE.
alter table public.notes drop constraint if exists notes_current_version_same_note;
alter table public.notes add constraint notes_current_version_same_note
  foreign key (current_version_id, id) references public.note_versions (id, note_id)
  on delete set null (current_version_id);

-- -----------------------------------------------------------------------------
-- note_drafts (autosaved working copy, one per note)
-- -----------------------------------------------------------------------------
create table if not exists public.note_drafts (
  note_id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  scene_json jsonb not null
    constraint note_drafts_scene_is_object check (jsonb_typeof(scene_json) = 'object'),
  revision integer not null default 1
    constraint note_drafts_revision_positive check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_drafts_note_same_owner foreign key (note_id, owner_id)
    references public.notes (id, owner_id) on delete cascade
);

drop trigger if exists note_drafts_set_updated_at on public.note_drafts;
create trigger note_drafts_set_updated_at before update on public.note_drafts
  for each row execute function public.set_updated_at();

-- An autosave counts as editing the note: bump notes.updated_at. Definer so it
-- needs no column grant on notes.updated_at; it only touches the draft's own
-- note, and drafts are owner-checked by RLS + composite FK.
create or replace function public.note_drafts_touch_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notes set updated_at = now() where id = new.note_id and owner_id = new.owner_id;
  return new;
end;
$$;
revoke all on function public.note_drafts_touch_note() from public, anon, authenticated;

drop trigger if exists note_drafts_touch_note on public.note_drafts;
create trigger note_drafts_touch_note after insert or update on public.note_drafts
  for each row execute function public.note_drafts_touch_note();

-- -----------------------------------------------------------------------------
-- note_exports
-- -----------------------------------------------------------------------------
create table if not exists public.note_exports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  version_id uuid not null,
  format text not null
    constraint note_exports_format check (format in ('png', 'svg', 'excalidraw')),
  theme text not null default 'light'
    constraint note_exports_theme check (theme in ('light', 'dark')),
  transparent boolean not null default false,
  source text not null default 'version'
    constraint note_exports_source check (source in ('version', 'draft')),
  bucket text not null default 'note-exports'
    constraint note_exports_bucket check (bucket = 'note-exports'),
  object_path text null,
  width integer null constraint note_exports_width check (width is null or width between 1 and 16384),
  height integer null constraint note_exports_height check (height is null or height between 1 and 16384),
  bytes integer null constraint note_exports_bytes check (bytes is null or bytes between 1 and 26214400),
  status text not null default 'queued'
    constraint note_exports_status check (status in ('queued', 'processing', 'completed', 'failed')),
  error_code text null,
  safe_error_message text null
    constraint note_exports_safe_error_length check (safe_error_message is null or char_length(safe_error_message) <= 300),
  created_at timestamptz not null default now(),
  finished_at timestamptz null,
  constraint note_exports_note_same_owner foreign key (note_id, owner_id)
    references public.notes (id, owner_id) on delete cascade,
  constraint note_exports_version_same_note foreign key (version_id, note_id)
    references public.note_versions (id, note_id) on delete cascade,
  constraint note_exports_object_path_owner check (
    object_path is null or object_path like (owner_id::text || '/' || note_id::text || '/%')
  ),
  constraint note_exports_completed_has_object check (status <> 'completed' or object_path is not null),
  constraint note_exports_failed_has_error check (status <> 'failed' or (error_code is not null and safe_error_message is not null))
);

create index if not exists note_exports_owner_created_idx on public.note_exports (owner_id, created_at desc);
create index if not exists note_exports_note_idx on public.note_exports (note_id);

-- -----------------------------------------------------------------------------
-- generation_jobs.note_id (set server-side after a job is saved)
-- -----------------------------------------------------------------------------
alter table public.generation_jobs add column if not exists note_id uuid null;
alter table public.generation_jobs drop constraint if exists generation_jobs_note_id_fkey;
alter table public.generation_jobs add constraint generation_jobs_note_id_fkey
  foreign key (note_id) references public.notes (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Grants (separate control from RLS): anon none; authenticated least privilege
-- -----------------------------------------------------------------------------
revoke all on table public.folders, public.notes, public.note_versions, public.note_drafts, public.note_exports from anon;
revoke all on table public.folders, public.notes, public.note_versions, public.note_drafts, public.note_exports from authenticated;

grant select, delete on table public.folders to authenticated;
grant insert (owner_id, name, parent_id, sort_order) on table public.folders to authenticated;
grant update (name, parent_id, sort_order) on table public.folders to authenticated;

grant select, delete on table public.notes to authenticated;
grant insert (owner_id, folder_id, title, description, subject, topic, tags, source_type) on table public.notes to authenticated;
grant update (folder_id, title, description, subject, topic, tags, is_favorite, is_archived, current_version_id, preview_path, last_opened_at)
  on table public.notes to authenticated;

-- Versions are immutable: insert + select only.
grant select on table public.note_versions to authenticated;
grant insert (note_id, owner_id, version_number, kind, scene_json, learning_plan, mermaid_source, schema_version, description, created_by_job_id, restored_from_version_id)
  on table public.note_versions to authenticated;

grant select, delete on table public.note_drafts to authenticated;
grant insert (note_id, owner_id, scene_json, revision) on table public.note_drafts to authenticated;
grant update (scene_json, revision) on table public.note_drafts to authenticated;

grant select, delete on table public.note_exports to authenticated;
grant insert (owner_id, note_id, version_id, format, theme, transparent, source, status) on table public.note_exports to authenticated;
grant update (status, object_path, width, height, bytes, error_code, safe_error_message, finished_at) on table public.note_exports to authenticated;

grant select, insert, update, delete on table public.folders, public.notes, public.note_versions, public.note_drafts, public.note_exports to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security: explicit owner policies for every command
-- -----------------------------------------------------------------------------
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.note_versions enable row level security;
alter table public.note_drafts enable row level security;
alter table public.note_exports enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['folders', 'notes', 'note_drafts', 'note_exports'] loop
    execute format('drop policy if exists "Owners can read their %1$s" on public.%1$I', t);
    execute format('create policy "Owners can read their %1$s" on public.%1$I for select to authenticated using ((select auth.uid()) = owner_id)', t);
    execute format('drop policy if exists "Owners can create their %1$s" on public.%1$I', t);
    execute format('create policy "Owners can create their %1$s" on public.%1$I for insert to authenticated with check ((select auth.uid()) = owner_id)', t);
    execute format('drop policy if exists "Owners can update their %1$s" on public.%1$I', t);
    execute format('create policy "Owners can update their %1$s" on public.%1$I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t);
    execute format('drop policy if exists "Owners can delete their %1$s" on public.%1$I', t);
    execute format('create policy "Owners can delete their %1$s" on public.%1$I for delete to authenticated using ((select auth.uid()) = owner_id)', t);
  end loop;
end $$;

-- note_versions: owner-scoped; inserts must also reference only the owner's job.
-- (No UPDATE/DELETE grants exist, so the update/delete policies can never match
--  a client write; versions disappear only with their note.)
drop policy if exists "Owners can read their note_versions" on public.note_versions;
create policy "Owners can read their note_versions" on public.note_versions
  for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "Owners can create their note_versions" on public.note_versions;
create policy "Owners can create their note_versions" on public.note_versions
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and (
      created_by_job_id is null
      or exists (select 1 from public.generation_jobs j where j.id = created_by_job_id and j.owner_id = (select auth.uid()))
    )
  );

drop policy if exists "Owners can update their note_versions" on public.note_versions;
create policy "Owners can update their note_versions" on public.note_versions
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "Owners can delete their note_versions" on public.note_versions;
create policy "Owners can delete their note_versions" on public.note_versions
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- -----------------------------------------------------------------------------
-- Atomic operations (SECURITY INVOKER: run as the caller, RLS applies)
-- -----------------------------------------------------------------------------

-- Next version + move the current pointer + clear the draft, in one transaction.
create or replace function public.add_note_version(
  p_note_id uuid,
  p_scene jsonb,
  p_description text default '',
  p_kind text default 'snapshot',
  p_learning_plan jsonb default null,
  p_mermaid_source text default null,
  p_job_id uuid default null,
  p_restored_from uuid default null
)
returns table (id uuid, version_number integer, kind text, created_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_note public.notes%rowtype;
  v_number integer;
  v_id uuid;
  v_plan jsonb := p_learning_plan;
begin
  select * into v_note from public.notes n where n.id = p_note_id and n.owner_id = v_owner for update;
  if not found then
    raise exception 'note_not_found' using errcode = 'P0002';
  end if;
  -- Carry the learning plan forward so every version is self-contained.
  if v_plan is null and v_note.current_version_id is not null then
    select v.learning_plan into v_plan from public.note_versions v where v.id = v_note.current_version_id;
  end if;
  select coalesce(max(v.version_number), 0) + 1 into v_number from public.note_versions v where v.note_id = p_note_id;
  insert into public.note_versions (note_id, owner_id, version_number, kind, scene_json, learning_plan, mermaid_source, description, created_by_job_id, restored_from_version_id)
  values (p_note_id, v_owner, v_number, p_kind, p_scene, v_plan, p_mermaid_source, coalesce(p_description, ''), p_job_id, p_restored_from)
  returning note_versions.id into v_id;
  update public.notes set current_version_id = v_id where notes.id = p_note_id;
  delete from public.note_drafts d where d.note_id = p_note_id;
  return query select v.id, v.version_number, v.kind, v.created_at from public.note_versions v where v.id = v_id;
end;
$$;

-- Save a completed generation job as a new note (version 1). p_scene lets the
-- user keep edits made before saving; null uses the job's scene.
create or replace function public.create_note_from_job(
  p_job_id uuid,
  p_title text,
  p_folder_id uuid default null,
  p_description text default '',
  p_subject text default '',
  p_tags text[] default '{}',
  p_scene jsonb default null
)
returns table (note_id uuid, version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_job public.generation_jobs%rowtype;
  v_note uuid;
  v_version uuid;
begin
  select * into v_job from public.generation_jobs j where j.id = p_job_id and j.owner_id = v_owner;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  if v_job.status <> 'completed' or v_job.scene_json is null then
    raise exception 'job_not_completed' using errcode = '22023';
  end if;
  insert into public.notes (owner_id, folder_id, title, description, subject, tags)
  values (v_owner, p_folder_id, p_title, coalesce(p_description, ''), coalesce(p_subject, ''), coalesce(p_tags, '{}'))
  returning notes.id into v_note;
  select a.id into v_version from public.add_note_version(
    v_note, coalesce(p_scene, v_job.scene_json), 'Generated', 'generated',
    v_job.learning_plan, v_job.mermaid_source, v_job.id, null
  ) a;
  return query select v_note, v_version;
end;
$$;

-- Restore = keep any unsnapshotted draft as a version, then append the old scene.
create or replace function public.restore_note_version(p_note_id uuid, p_version_id uuid)
returns table (id uuid, version_number integer, kind text, created_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_source public.note_versions%rowtype;
  v_draft public.note_drafts%rowtype;
begin
  select * into v_source from public.note_versions v
    where v.id = p_version_id and v.note_id = p_note_id and v.owner_id = v_owner;
  if not found then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  select * into v_draft from public.note_drafts d where d.note_id = p_note_id and d.owner_id = v_owner;
  if found then
    perform public.add_note_version(p_note_id, v_draft.scene_json, 'Autosaved changes kept before restore', 'draft');
  end if;
  return query select * from public.add_note_version(
    p_note_id, v_source.scene_json, 'Restored from version ' || v_source.version_number, 'restore',
    v_source.learning_plan, v_source.mermaid_source, null, v_source.id
  );
end;
$$;

-- Independent copy: new note + version 1 holding the latest saved scene.
create or replace function public.duplicate_note(p_note_id uuid, p_title text)
returns table (note_id uuid, version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_src public.notes%rowtype;
  v_scene jsonb;
  v_draft_scene jsonb;
  v_plan jsonb;
  v_mermaid text;
  v_note uuid;
  v_version uuid;
begin
  select * into v_src from public.notes n where n.id = p_note_id and n.owner_id = v_owner;
  if not found then
    raise exception 'note_not_found' using errcode = 'P0002';
  end if;
  select v.scene_json, v.learning_plan, v.mermaid_source into v_scene, v_plan, v_mermaid
    from public.note_versions v where v.id = v_src.current_version_id;
  -- The latest saved state wins: an autosaved draft is newer than the current version.
  select d.scene_json into v_draft_scene from public.note_drafts d where d.note_id = p_note_id and d.owner_id = v_owner;
  v_scene := coalesce(v_draft_scene, v_scene);
  if v_scene is null then
    raise exception 'note_has_no_scene' using errcode = '22023';
  end if;
  insert into public.notes (owner_id, folder_id, title, description, subject, topic, tags)
  values (v_owner, v_src.folder_id, p_title, v_src.description, v_src.subject, v_src.topic, v_src.tags)
  returning notes.id into v_note;
  select a.id into v_version from public.add_note_version(
    v_note, v_scene, 'Duplicated from "' || left(v_src.title, 120) || '"', 'duplicate', v_plan, v_mermaid, null, null
  ) a;
  return query select v_note, v_version;
end;
$$;

-- Delete a folder: its notes move to root, its subfolders move up one level.
create or replace function public.delete_folder(p_folder_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_parent uuid;
begin
  select f.parent_id into v_parent from public.folders f where f.id = p_folder_id and f.owner_id = v_owner;
  if not found then
    raise exception 'folder_not_found' using errcode = 'P0002';
  end if;
  update public.notes set folder_id = null where folder_id = p_folder_id and owner_id = v_owner;
  update public.folders set parent_id = v_parent where parent_id = p_folder_id and owner_id = v_owner;
  delete from public.folders where id = p_folder_id and owner_id = v_owner;
end;
$$;

revoke all on function public.add_note_version(uuid, jsonb, text, text, jsonb, text, uuid, uuid) from public, anon;
revoke all on function public.create_note_from_job(uuid, text, uuid, text, text, text[], jsonb) from public, anon;
revoke all on function public.restore_note_version(uuid, uuid) from public, anon;
revoke all on function public.duplicate_note(uuid, text) from public, anon;
revoke all on function public.delete_folder(uuid) from public, anon;
grant execute on function public.add_note_version(uuid, jsonb, text, text, jsonb, text, uuid, uuid) to authenticated;
grant execute on function public.create_note_from_job(uuid, text, uuid, text, text, text[], jsonb) to authenticated;
grant execute on function public.restore_note_version(uuid, uuid) to authenticated;
grant execute on function public.duplicate_note(uuid, text) to authenticated;
grant execute on function public.delete_folder(uuid) to authenticated;
