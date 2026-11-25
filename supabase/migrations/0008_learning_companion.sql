-- =============================================================================
-- Visualify Phase 5 - 0008: Learning Companion, Multi-Frame ZIP Exports & Usage
-- =============================================================================
-- Idempotent. Builds on 0004 (notes, note_versions, note_exports), 0005 (storage),
-- and 0006 (source_files). PRD refs: FR-EDIT-05..07, FR-EXP-04..05, 5.9, 10.2, 10.5.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend existing constraints for section regeneration + selective/ZIP export
-- -----------------------------------------------------------------------------
alter table public.note_versions drop constraint if exists note_versions_kind;
alter table public.note_versions add constraint note_versions_kind
  check (kind in ('generated', 'snapshot', 'draft', 'restore', 'duplicate', 'regenerate'));

alter table public.note_exports add column if not exists scope text not null default 'full';
alter table public.note_exports add column if not exists frame_id text null;

alter table public.note_exports drop constraint if exists note_exports_format;
alter table public.note_exports add constraint note_exports_format
  check (format in ('png', 'svg', 'excalidraw', 'zip'));

alter table public.note_exports drop constraint if exists note_exports_scope;
alter table public.note_exports add constraint note_exports_scope
  check (scope in ('full', 'frame'));

alter table public.note_exports drop constraint if exists note_exports_frame_id_len;
alter table public.note_exports add constraint note_exports_frame_id_len
  check (frame_id is null or char_length(frame_id) <= 160);

-- Allow application/zip in private note-exports bucket alongside PNG/SVG/JSON.
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/svg+xml', 'application/json', 'application/zip']
 where id = 'note-exports';

-- Extend authenticated insert grant on note_exports to allow optional scope/frame_id.
grant insert (scope, frame_id) on table public.note_exports to authenticated;

-- -----------------------------------------------------------------------------
-- 2. public.note_quizzes (version-scoped MCQ quizzes per note)
-- -----------------------------------------------------------------------------
create table if not exists public.note_quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  version_id uuid not null,
  difficulty text not null default 'mixed'
    constraint note_quizzes_difficulty check (difficulty in ('foundational', 'mixed', 'challenging')),
  questions jsonb not null
    constraint note_quizzes_questions_array check (jsonb_typeof(questions) = 'array' and pg_column_size(questions) <= 65536),
  answers jsonb not null default '{}'::jsonb
    constraint note_quizzes_answers_object check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 8192),
  score integer null
    constraint note_quizzes_score_range check (score is null or score >= 0),
  total_questions integer not null
    constraint note_quizzes_total_range check (total_questions between 1 and 20),
  completed_at timestamptz null,
  model_id text null
    constraint note_quizzes_model_len check (model_id is null or char_length(model_id) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_quizzes_score_le_total check (score is null or score <= total_questions),
  constraint note_quizzes_note_same_owner foreign key (note_id, owner_id)
    references public.notes (id, owner_id) on delete cascade,
  constraint note_quizzes_version_same_note foreign key (version_id, note_id)
    references public.note_versions (id, note_id) on delete cascade
);

create index if not exists note_quizzes_note_version_idx
  on public.note_quizzes (owner_id, note_id, version_id, created_at desc);

drop trigger if exists note_quizzes_set_updated_at on public.note_quizzes;
create trigger note_quizzes_set_updated_at before update on public.note_quizzes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. public.note_flashcards (spaced-recall deck items per note version)
-- -----------------------------------------------------------------------------
create table if not exists public.note_flashcards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  version_id uuid not null,
  front text not null
    constraint note_flashcards_front_len check (char_length(btrim(front)) between 1 and 500),
  back text not null
    constraint note_flashcards_back_len check (char_length(btrim(back)) between 1 and 1500),
  hint text not null default ''
    constraint note_flashcards_hint_len check (char_length(hint) <= 300),
  section_id text null
    constraint note_flashcards_section_len check (section_id is null or char_length(section_id) <= 80),
  concept text not null default ''
    constraint note_flashcards_concept_len check (char_length(concept) <= 120),
  sort_order integer not null default 0
    constraint note_flashcards_sort_range check (sort_order between 0 and 500),
  mastery text not null default 'new'
    constraint note_flashcards_mastery check (mastery in ('new', 'review', 'known')),
  review_count integer not null default 0
    constraint note_flashcards_review_count check (review_count >= 0),
  last_reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_flashcards_note_same_owner foreign key (note_id, owner_id)
    references public.notes (id, owner_id) on delete cascade,
  constraint note_flashcards_version_same_note foreign key (version_id, note_id)
    references public.note_versions (id, note_id) on delete cascade
);

create index if not exists note_flashcards_note_version_idx
  on public.note_flashcards (owner_id, note_id, version_id, sort_order asc);

drop trigger if exists note_flashcards_set_updated_at on public.note_flashcards;
create trigger note_flashcards_set_updated_at before update on public.note_flashcards
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. public.note_revision_guides (one-page exam sheet per note version)
-- -----------------------------------------------------------------------------
create table if not exists public.note_revision_guides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  version_id uuid not null,
  guide_json jsonb not null
    constraint note_revision_guides_json_obj check (jsonb_typeof(guide_json) = 'object' and pg_column_size(guide_json) <= 65536),
  model_id text null
    constraint note_revision_guides_model_len check (model_id is null or char_length(model_id) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_revision_guides_one_per_version unique (note_id, version_id),
  constraint note_revision_guides_note_same_owner foreign key (note_id, owner_id)
    references public.notes (id, owner_id) on delete cascade,
  constraint note_revision_guides_version_same_note foreign key (version_id, note_id)
    references public.note_versions (id, note_id) on delete cascade
);

create index if not exists note_revision_guides_owner_note_idx
  on public.note_revision_guides (owner_id, note_id, version_id);

drop trigger if exists note_revision_guides_set_updated_at on public.note_revision_guides;
create trigger note_revision_guides_set_updated_at before update on public.note_revision_guides
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. public.usage_events (quota & metering audit; never raw prompts/files)
-- -----------------------------------------------------------------------------
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null
    constraint usage_events_type check (
      event_type in (
        'generation',
        'explain_node',
        'quiz',
        'flashcards',
        'revision',
        'ask_note',
        'section_regenerate',
        'export'
      )
    ),
  units integer not null default 1
    constraint usage_events_units_nonnegative check (units >= 0),
  metadata jsonb not null default '{}'::jsonb
    constraint usage_events_metadata_obj check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  created_at timestamptz not null default now()
);

create index if not exists usage_events_owner_created_idx
  on public.usage_events (owner_id, created_at desc);
create index if not exists usage_events_owner_type_created_idx
  on public.usage_events (owner_id, event_type, created_at desc);

-- -----------------------------------------------------------------------------
-- 6. Grants (strict least privilege; anon gets nothing)
-- -----------------------------------------------------------------------------
revoke all on table public.note_quizzes, public.note_flashcards, public.note_revision_guides, public.usage_events from anon, authenticated;

-- Quizzes: owners can read/create/delete, and update ONLY answers/score/completed_at (never questions/note_id/version_id).
grant select, delete on table public.note_quizzes to authenticated;
grant insert (owner_id, note_id, version_id, difficulty, questions, total_questions, model_id)
  on table public.note_quizzes to authenticated;
grant update (answers, score, completed_at) on table public.note_quizzes to authenticated;

-- Flashcards: owners can read/create/delete, and update ONLY mastery/review_count/last_reviewed_at.
grant select, delete on table public.note_flashcards to authenticated;
grant insert (owner_id, note_id, version_id, front, back, hint, section_id, concept, sort_order)
  on table public.note_flashcards to authenticated;
grant update (mastery, review_count, last_reviewed_at) on table public.note_flashcards to authenticated;

-- Revision guides: owners can read/insert/update(guide_json, model_id)/delete.
grant select, delete on table public.note_revision_guides to authenticated;
grant insert (owner_id, note_id, version_id, guide_json, model_id)
  on table public.note_revision_guides to authenticated;
grant update (guide_json, model_id) on table public.note_revision_guides to authenticated;

-- Usage events: read-only for authenticated owners; written server-side by service_role only.
grant select on table public.usage_events to authenticated;

grant select, insert, update, delete on table
  public.note_quizzes,
  public.note_flashcards,
  public.note_revision_guides,
  public.usage_events
  to service_role;

-- -----------------------------------------------------------------------------
-- 7. Row Level Security: explicit per-command owner policies
-- -----------------------------------------------------------------------------
alter table public.note_quizzes enable row level security;
alter table public.note_flashcards enable row level security;
alter table public.note_revision_guides enable row level security;
alter table public.usage_events enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['note_quizzes', 'note_flashcards', 'note_revision_guides'] loop
    execute format('drop policy if exists "Owners can read %1$s" on public.%1$I', t);
    execute format('create policy "Owners can read %1$s" on public.%1$I for select to authenticated using ((select auth.uid()) = owner_id)', t);
    execute format('drop policy if exists "Owners can insert %1$s" on public.%1$I', t);
    execute format('create policy "Owners can insert %1$s" on public.%1$I for insert to authenticated with check ((select auth.uid()) = owner_id)', t);
    execute format('drop policy if exists "Owners can update %1$s" on public.%1$I', t);
    execute format('create policy "Owners can update %1$s" on public.%1$I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t);
    execute format('drop policy if exists "Owners can delete %1$s" on public.%1$I', t);
    execute format('create policy "Owners can delete %1$s" on public.%1$I for delete to authenticated using ((select auth.uid()) = owner_id)', t);
  end loop;
end
$$;

drop policy if exists "Owners can read their own usage_events" on public.usage_events;
create policy "Owners can read their own usage_events"
  on public.usage_events for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Only service_role writes usage_events" on public.usage_events;
create policy "Only service_role writes usage_events"
  on public.usage_events for all to service_role
  using (true) with check (true);
