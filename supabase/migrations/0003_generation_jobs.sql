-- =============================================================================
-- Visualify Phase 2 - 0003: generation_jobs (async prompt-to-visual pipeline)
-- =============================================================================
-- Idempotent. PRD refs: 10.2 (generation_jobs), 10.5 (RLS), 11.2 (state
-- machine), 5.4 (1 active generation per user), Appendix B (8,000 chars).
--
-- Trust model:
--   * authenticated users may CREATE a queued job (limited columns), READ
--     their own jobs, request cancellation, and delete finished jobs;
--   * pipeline results (status/progress/plan/scene/errors/usage) are written
--     only by the API's server-side job runner with the service role, so a
--     client can never forge a "completed" job with an arbitrary scene.
-- =============================================================================

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  input_type text not null default 'prompt'
    constraint generation_jobs_input_type check (input_type in ('prompt')),
  input_text text not null
    constraint generation_jobs_input_text_length check (char_length(input_text) between 1 and 8000),
  settings jsonb not null default '{}'::jsonb
    constraint generation_jobs_settings_is_object check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096),
  status text not null default 'queued'
    constraint generation_jobs_status check (status in (
      'queued', 'validating', 'planning', 'composing', 'rendering', 'persisting',
      'cancelling', 'completed', 'failed', 'cancelled'
    )),
  stage text null,
  progress smallint not null default 0
    constraint generation_jobs_progress_range check (progress between 0 and 100),
  learning_plan jsonb null,
  scene_json jsonb null,
  mermaid_source text null,
  warnings jsonb not null default '[]'::jsonb
    constraint generation_jobs_warnings_is_array check (jsonb_typeof(warnings) = 'array'),
  error_code text null,
  safe_error_message text null
    constraint generation_jobs_safe_error_length check (safe_error_message is null or char_length(safe_error_message) <= 300),
  model_id text null,
  prompt_version text null,
  usage jsonb null,
  attempt_count integer not null default 1
    constraint generation_jobs_attempt_count check (attempt_count between 1 and 20),
  retry_of uuid null references public.generation_jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  updated_at timestamptz not null default now(),
  -- A completed job always carries a result; a failed job always carries a safe error.
  constraint generation_jobs_completed_has_result check (
    status <> 'completed' or (learning_plan is not null and scene_json is not null and progress = 100)
  ),
  constraint generation_jobs_failed_has_error check (
    status <> 'failed' or (error_code is not null and safe_error_message is not null)
  )
);

comment on table public.generation_jobs is
  'Asynchronous prompt-to-visual generation jobs (PRD 10.2, 11.2). Results are written server-side only.';

create index if not exists generation_jobs_owner_created_idx
  on public.generation_jobs (owner_id, created_at desc);
create index if not exists generation_jobs_owner_status_idx
  on public.generation_jobs (owner_id, status);

-- Exactly one active (non-terminal) job per user, enforced by the database so
-- concurrent POSTs cannot race past the API-level check.
create unique index if not exists generation_jobs_one_active_per_owner
  on public.generation_jobs (owner_id)
  where status in ('queued', 'validating', 'planning', 'composing', 'rendering', 'persisting', 'cancelling');

drop trigger if exists generation_jobs_set_updated_at on public.generation_jobs;
create trigger generation_jobs_set_updated_at
  before update on public.generation_jobs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Grants (separate control from RLS)
-- -----------------------------------------------------------------------------
revoke all on table public.generation_jobs from anon;
revoke all on table public.generation_jobs from authenticated;

grant select on table public.generation_jobs to authenticated;
-- Only the request itself; status/progress/results fall back to column defaults.
grant insert (owner_id, input_type, input_text, settings) on table public.generation_jobs to authenticated;
-- Only a cancellation request (policy below restricts the values).
grant update (status) on table public.generation_jobs to authenticated;
grant delete on table public.generation_jobs to authenticated;

-- service_role (server only) bypasses RLS and needs full DML for the runner.
grant select, insert, update, delete on table public.generation_jobs to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.generation_jobs enable row level security;

drop policy if exists "Users can read their own generation jobs" on public.generation_jobs;
create policy "Users can read their own generation jobs"
  on public.generation_jobs for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can create their own queued generation jobs" on public.generation_jobs;
create policy "Users can create their own queued generation jobs"
  on public.generation_jobs for insert to authenticated
  with check ((select auth.uid()) = owner_id and status = 'queued' and progress = 0);

-- Owners may only move an active job towards cancellation.
drop policy if exists "Users can request cancellation of their own jobs" on public.generation_jobs;
create policy "Users can request cancellation of their own jobs"
  on public.generation_jobs for update to authenticated
  using (
    (select auth.uid()) = owner_id
    and status in ('queued', 'validating', 'planning', 'composing', 'rendering', 'persisting', 'cancelling')
  )
  with check ((select auth.uid()) = owner_id and status in ('cancelling', 'cancelled'));

-- Owners may delete only finished jobs (never one the runner is working on).
drop policy if exists "Users can delete their own finished jobs" on public.generation_jobs;
create policy "Users can delete their own finished jobs"
  on public.generation_jobs for delete to authenticated
  using ((select auth.uid()) = owner_id and status in ('completed', 'failed', 'cancelled'));
