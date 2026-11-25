-- =============================================================================
-- Visualify Phase 4 - 0006: source_files + PDF/Image generation & note linking
-- =============================================================================
-- Idempotent. Requires Postgres 15+ (column-list ON DELETE SET NULL).
-- PRD refs: 5.4 (FR-IN-03..06), 10.2-10.5 (source_files, generation_jobs, RLS),
--           11.2 (extracting stage), Appendix B (20 MiB upload limit).
--
-- Trust model:
--   * authenticated users may INSERT uploaded file metadata (scoped to own
--     uid/id path), READ their own source_files, and DELETE them.
--   * extraction_status, extracted_metadata, error fields and note_id are
--     written server-side (or via owner-checked SECURITY DEFINER helper during
--     create_note_from_job), so clients cannot forge extracted states.
--   * Composite FKs ensure generation_jobs and source_files cannot reference
--     another user's source_files or notes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- source_files
-- -----------------------------------------------------------------------------
create table if not exists public.source_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid null,
  bucket text not null default 'source-files'
    constraint source_files_bucket check (bucket = 'source-files'),
  object_path text not null,
  original_name text not null
    constraint source_files_original_name_length check (char_length(btrim(original_name)) between 1 and 255),
  mime_type text not null
    constraint source_files_mime_type check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null
    constraint source_files_size_bytes check (size_bytes between 1 and 20971520),
  checksum text not null
    constraint source_files_checksum_hex check (checksum ~ '^[0-9a-f]{64}$'),
  page_count integer null
    constraint source_files_page_count check (page_count is null or page_count between 1 and 500),
  width integer null
    constraint source_files_width check (width is null or width > 0),
  height integer null
    constraint source_files_height check (height is null or height > 0),
  extraction_status text not null default 'uploaded'
    constraint source_files_extraction_status check (extraction_status in ('uploaded', 'extracting', 'extracted', 'failed')),
  extracted_metadata jsonb not null default '{}'::jsonb
    constraint source_files_extracted_metadata_valid check (jsonb_typeof(extracted_metadata) = 'object' and pg_column_size(extracted_metadata) <= 32768),
  error_code text null,
  safe_error_message text null
    constraint source_files_safe_error_length check (safe_error_message is null or char_length(safe_error_message) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_files_id_owner_key unique (id, owner_id),
  constraint source_files_object_path_owner check (object_path like (owner_id::text || '/' || id::text || '/%')),
  constraint source_files_failed_has_error check (
    extraction_status <> 'failed' or (error_code is not null and safe_error_message is not null)
  ),
  constraint source_files_note_same_owner foreign key (note_id, owner_id)
    references public.notes (id, owner_id) on delete set null (note_id)
);

comment on table public.source_files is
  'Metadata for private user-uploaded PDF and image source files (PRD 10.2). Binary lives in private Storage.';

create index if not exists source_files_owner_created_idx
  on public.source_files (owner_id, created_at desc);
create index if not exists source_files_owner_note_idx
  on public.source_files (owner_id, note_id) where note_id is not null;
create index if not exists source_files_owner_checksum_idx
  on public.source_files (owner_id, checksum);

drop trigger if exists source_files_set_updated_at on public.source_files;
create trigger source_files_set_updated_at
  before update on public.source_files
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Grants & RLS for source_files
-- -----------------------------------------------------------------------------
revoke all on table public.source_files from anon;
revoke all on table public.source_files from authenticated;

grant select, delete on table public.source_files to authenticated;
grant insert (id, owner_id, bucket, object_path, original_name, mime_type, size_bytes, checksum, page_count, width, height)
  on table public.source_files to authenticated;

grant select, insert, update, delete on table public.source_files to service_role;

alter table public.source_files enable row level security;

drop policy if exists "Owners can read their source_files" on public.source_files;
create policy "Owners can read their source_files"
  on public.source_files for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Owners can create their source_files" on public.source_files;
create policy "Owners can create their source_files"
  on public.source_files for insert to authenticated
  with check ((select auth.uid()) = owner_id and extraction_status = 'uploaded' and note_id is null);

drop policy if exists "Owners can update their source_files" on public.source_files;
create policy "Owners can update their source_files"
  on public.source_files for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Owners can delete their source_files" on public.source_files;
create policy "Owners can delete their source_files"
  on public.source_files for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- -----------------------------------------------------------------------------
-- generation_jobs updates (Phase 4 inputs + extracting stage)
-- -----------------------------------------------------------------------------
alter table public.generation_jobs add column if not exists source_file_id uuid null;
alter table public.generation_jobs add column if not exists page_range jsonb null;

alter table public.generation_jobs alter column input_text drop not null;

alter table public.generation_jobs drop constraint if exists generation_jobs_input_text_length;
alter table public.generation_jobs add constraint generation_jobs_input_text_length
  check (input_text is null or char_length(input_text) <= 8000);

alter table public.generation_jobs drop constraint if exists generation_jobs_input_type;
alter table public.generation_jobs add constraint generation_jobs_input_type
  check (input_type in ('prompt', 'pdf', 'image'));

alter table public.generation_jobs drop constraint if exists generation_jobs_page_range_valid;
alter table public.generation_jobs add constraint generation_jobs_page_range_valid
  check (page_range is null or (jsonb_typeof(page_range) = 'object' and pg_column_size(page_range) <= 2048));

alter table public.generation_jobs drop constraint if exists generation_jobs_source_same_owner;
alter table public.generation_jobs add constraint generation_jobs_source_same_owner
  foreign key (source_file_id, owner_id) references public.source_files (id, owner_id)
  on delete set null (source_file_id);

alter table public.generation_jobs drop constraint if exists generation_jobs_input_invariant;
alter table public.generation_jobs add constraint generation_jobs_input_invariant
  check (
    (input_type = 'prompt' and char_length(btrim(coalesce(input_text, ''))) >= 1)
    or (input_type in ('pdf', 'image') and source_file_id is not null)
  );

alter table public.generation_jobs drop constraint if exists generation_jobs_status;
alter table public.generation_jobs add constraint generation_jobs_status
  check (status in (
    'queued', 'validating', 'extracting', 'planning', 'composing', 'rendering', 'persisting',
    'cancelling', 'completed', 'failed', 'cancelled'
  ));

drop index if exists public.generation_jobs_one_active_per_owner;
create unique index generation_jobs_one_active_per_owner
  on public.generation_jobs (owner_id)
  where status in ('queued', 'validating', 'extracting', 'planning', 'composing', 'rendering', 'persisting', 'cancelling');

create index if not exists generation_jobs_source_file_idx
  on public.generation_jobs (source_file_id) where source_file_id is not null;

-- Update cancellation policy so active 'extracting' jobs can also be cancelled by owner.
drop policy if exists "Users can request cancellation of their own jobs" on public.generation_jobs;
create policy "Users can request cancellation of their own jobs"
  on public.generation_jobs for update to authenticated
  using (
    (select auth.uid()) = owner_id
    and status in ('queued', 'validating', 'extracting', 'planning', 'composing', 'rendering', 'persisting', 'cancelling')
  )
  with check ((select auth.uid()) = owner_id and status in ('cancelling', 'cancelled'));

-- Extend authenticated INSERT grant to allow PDF/image source references.
grant insert (owner_id, input_type, input_text, settings, source_file_id, page_range)
  on table public.generation_jobs to authenticated;

-- -----------------------------------------------------------------------------
-- notes.source_type + create_note_from_job / duplicate_note updates
-- -----------------------------------------------------------------------------
alter table public.notes drop constraint if exists notes_source_type;
alter table public.notes add constraint notes_source_type
  check (source_type in ('prompt', 'pdf', 'image'));

-- Safely links an owner's source file to their own note during create_note_from_job
-- without granting direct UPDATE on source_files.note_id to authenticated clients.
create or replace function public.link_source_file_to_note(p_source_file_id uuid, p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
begin
  if v_owner is null or p_source_file_id is null or p_note_id is null then
    return;
  end if;
  if not exists (select 1 from public.notes n where n.id = p_note_id and n.owner_id = v_owner) then
    raise exception 'note_not_found' using errcode = 'P0002';
  end if;
  update public.source_files sf
     set note_id = p_note_id
   where sf.id = p_source_file_id
     and sf.owner_id = v_owner;
end;
$$;
revoke all on function public.link_source_file_to_note(uuid, uuid) from public, anon;
grant execute on function public.link_source_file_to_note(uuid, uuid) to authenticated;

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
  insert into public.notes (owner_id, folder_id, title, description, subject, tags, source_type)
  values (v_owner, p_folder_id, p_title, coalesce(p_description, ''), coalesce(p_subject, ''), coalesce(p_tags, '{}'), coalesce(v_job.input_type, 'prompt'))
  returning notes.id into v_note;
  select a.id into v_version from public.add_note_version(
    v_note, coalesce(p_scene, v_job.scene_json), 'Generated', 'generated',
    v_job.learning_plan, v_job.mermaid_source, v_job.id, null
  ) a;
  if v_job.source_file_id is not null then
    perform public.link_source_file_to_note(v_job.source_file_id, v_note);
  end if;
  return query select v_note, v_version;
end;
$$;

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
  select d.scene_json into v_draft_scene from public.note_drafts d where d.note_id = p_note_id and d.owner_id = v_owner;
  v_scene := coalesce(v_draft_scene, v_scene);
  if v_scene is null then
    raise exception 'note_has_no_scene' using errcode = '22023';
  end if;
  insert into public.notes (owner_id, folder_id, title, description, subject, topic, tags, source_type)
  values (v_owner, v_src.folder_id, p_title, v_src.description, v_src.subject, v_src.topic, v_src.tags, v_src.source_type)
  returning notes.id into v_note;
  select a.id into v_version from public.add_note_version(
    v_note, v_scene, 'Duplicated from "' || left(v_src.title, 120) || '"', 'duplicate', v_plan, v_mermaid, null, null
  ) a;
  return query select v_note, v_version;
end;
$$;
