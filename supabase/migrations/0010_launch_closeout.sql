-- =============================================================================
-- Visualify Phase 6.5 - 0010: Quota Refunds, Product Events & PRD §14.1 Metrics
-- =============================================================================
-- Idempotent & additive. Builds on 0008 (usage_events) & 0009 (consume_monthly_quota).
-- PRD refs: §14.1, §14.3, §15.2 #12, §18.3.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. usage_events refund tracking (correlation_id + refunded_at)
-- -----------------------------------------------------------------------------
alter table public.usage_events add column if not exists refunded_at timestamptz null;
alter table public.usage_events add column if not exists correlation_id uuid null;

create unique index if not exists usage_events_owner_correlation_idx
  on public.usage_events (owner_id, correlation_id)
  where correlation_id is not null;

-- Drop 6-arg overload cleanly so only the 7-arg signature (with p_correlation_id default null) exists.
drop function if exists public.consume_monthly_quota(uuid, text, integer, text[], integer, jsonb);

create or replace function public.consume_monthly_quota(
  p_owner_id uuid,
  p_event_type text,
  p_limit integer,
  p_billable_types text[] default array[
    'generation',
    'generation_create',
    'generation_retry',
    'explain_node',
    'quiz',
    'flashcards',
    'revision',
    'ask_note',
    'section_regenerate'
  ]::text[],
  p_units integer default 1,
  p_metadata jsonb default '{}'::jsonb,
  p_correlation_id uuid default null
)
returns table (
  allowed boolean,
  used integer,
  "limit" integer,
  resets_at timestamptz,
  event_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_start timestamptz;
  v_resets_at timestamptz;
  v_used integer;
  v_event_id uuid;
begin
  if p_owner_id is null then
    raise exception 'p_owner_id is required';
  end if;

  v_period_start := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'utc') at time zone 'utc');
  v_resets_at := ((pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'utc') + interval '1 month') at time zone 'utc');

  -- Per-user, per-month transaction lock serializes boundary quota checks cleanly.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_owner_id::text || ':' || pg_catalog.to_char(v_period_start at time zone 'utc', 'YYYY-MM'))
  );

  select coalesce(sum(ue.units), 0)::integer
    into v_used
    from public.usage_events ue
   where ue.owner_id = p_owner_id
     and ue.created_at >= v_period_start
     and ue.created_at < v_resets_at
     and ue.refunded_at is null
     and ue.event_type = any(p_billable_types);

  if p_limit is not null and p_limit >= 0 and (v_used + greatest(p_units, 0)) > p_limit then
    return query select false, v_used, p_limit, v_resets_at, null::uuid;
    return;
  end if;

  insert into public.usage_events (owner_id, event_type, units, metadata, correlation_id)
  values (p_owner_id, p_event_type, greatest(p_units, 0), coalesce(p_metadata, '{}'::jsonb), p_correlation_id)
  on conflict (owner_id, correlation_id) where correlation_id is not null
  do nothing
  returning id into v_event_id;

  if v_event_id is null and p_correlation_id is not null then
    select ue.id into v_event_id
      from public.usage_events ue
     where ue.owner_id = p_owner_id and ue.correlation_id = p_correlation_id;
    return query select true, v_used, p_limit, v_resets_at, v_event_id;
    return;
  end if;

  return query select true, (v_used + greatest(p_units, 0))::integer, p_limit, v_resets_at, v_event_id;
end;
$$;

revoke all on function public.consume_monthly_quota(uuid, text, integer, text[], integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.consume_monthly_quota(uuid, text, integer, text[], integer, jsonb, uuid) to service_role;

-- Idempotent server-only quota refund for provider/system failures.
create or replace function public.refund_usage_event(
  p_owner_id uuid,
  p_correlation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_owner_id is null or p_correlation_id is null then
    return false;
  end if;

  update public.usage_events ue
     set refunded_at = pg_catalog.now()
   where ue.owner_id = p_owner_id
     and ue.correlation_id = p_correlation_id
     and ue.refunded_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.refund_usage_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.refund_usage_event(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. public.product_events (PRD §14.3 — zero PII, service_role only)
-- -----------------------------------------------------------------------------
create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid null references auth.users (id) on delete cascade,
  event_name text not null
    constraint product_events_name_check check (
      event_name in (
        'auth_signup_completed',
        'onboarding_completed',
        'generation_started',
        'generation_stage_changed',
        'generation_completed',
        'generation_failed',
        'note_saved',
        'note_opened',
        'note_edited',
        'note_version_restored',
        'note_exported',
        'folder_created',
        'source_deleted',
        'account_deleted'
      )
    ),
  properties jsonb not null default '{}'::jsonb
    constraint product_events_props_check check (
      jsonb_typeof(properties) = 'object' and pg_column_size(properties) <= 2048
    ),
  created_at timestamptz not null default now()
);

create index if not exists product_events_name_created_idx
  on public.product_events (event_name, created_at desc);
create index if not exists product_events_owner_created_idx
  on public.product_events (owner_id, created_at desc);

revoke all on table public.product_events from anon, authenticated;
grant select, insert, update, delete on table public.product_events to service_role;

alter table public.product_events enable row level security;

drop policy if exists "Only service_role accesses product_events" on public.product_events;
create policy "Only service_role accesses product_events"
  on public.product_events for all to service_role
  using (true) with check (true);

-- -----------------------------------------------------------------------------
-- 3. PRD §14.1 metrics aggregation RPC (service_role only, single-pass SQL)
-- -----------------------------------------------------------------------------
create or replace function public.compute_product_metrics(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signups integer := 0;
  v_activated integer := 0;
  v_gen_started integer := 0;
  v_gen_cancelled integer := 0;
  v_gen_completed integer := 0;
  v_gen_failed integer := 0;
  v_gen_repaired integer := 0;
  v_regen_actions integer := 0;
  v_latency_p50 numeric := null;
  v_latency_p95 numeric := null;
  v_notes_saved integer := 0;
  v_notes_exported integer := 0;
  v_notes_edited integer := 0;
  v_return_eligible_users integer := 0;
  v_return_users integer := 0;
  v_prompt_tokens numeric := 0;
  v_output_tokens numeric := 0;
begin
  -- Signups (users from auth_signup_completed in range, falling back to profiles created in range)
  with signup_users as (
    select distinct pe.owner_id, min(pe.created_at) as signed_at
      from public.product_events pe
     where pe.event_name = 'auth_signup_completed'
       and pe.owner_id is not null
       and pe.created_at >= p_from
       and pe.created_at <= p_to
     group by pe.owner_id
  )
  select
    count(*)::integer,
    count(*) filter (
      where exists (
        select 1 from public.product_events gc
         where gc.owner_id = s.owner_id
           and gc.event_name = 'generation_completed'
           and gc.created_at >= s.signed_at
           and gc.created_at <= s.signed_at + interval '24 hours'
      )
      and exists (
        select 1 from public.product_events ns
         where ns.owner_id = s.owner_id
           and ns.event_name = 'note_saved'
           and ns.created_at >= s.signed_at
           and ns.created_at <= s.signed_at + interval '24 hours'
      )
    )::integer
  into v_signups, v_activated
  from signup_users s;

  -- Generation funnel & latency
  select
    count(*) filter (where pe.event_name = 'generation_started')::integer,
    count(*) filter (where pe.event_name = 'generation_completed')::integer,
    count(*) filter (where pe.event_name = 'generation_failed')::integer,
    count(*) filter (where pe.event_name = 'generation_failed' and pe.properties->>'errorCode' = 'CANCELLED')::integer,
    count(*) filter (where pe.event_name = 'generation_completed' and coalesce((pe.properties->>'repaired')::boolean, false))::integer
  into v_gen_started, v_gen_completed, v_gen_failed, v_gen_cancelled, v_gen_repaired
  from public.product_events pe
  where pe.created_at >= p_from and pe.created_at <= p_to
    and pe.event_name in ('generation_started', 'generation_completed', 'generation_failed');

  select
    percentile_cont(0.5) within group (order by ((pe.properties->>'durationMs')::numeric)),
    percentile_cont(0.95) within group (order by ((pe.properties->>'durationMs')::numeric))
  into v_latency_p50, v_latency_p95
  from public.product_events pe
  where pe.event_name = 'generation_completed'
    and pe.created_at >= p_from
    and pe.created_at <= p_to
    and (pe.properties->>'durationMs') ~ '^[0-9]+(\.[0-9]+)?$';

  -- Save rate, Export rate, Edit engagement (distinct noteIds saved in window)
  with saved_notes as (
    select distinct pe.owner_id, (pe.properties->>'noteId') as note_id, min(pe.created_at) as saved_at
      from public.product_events pe
     where pe.event_name = 'note_saved'
       and pe.created_at >= p_from
       and pe.created_at <= p_to
       and nullif(pe.properties->>'noteId', '') is not null
     group by pe.owner_id, (pe.properties->>'noteId')
  )
  select
    count(*)::integer,
    count(*) filter (
      where exists (
        select 1 from public.product_events exp
         where exp.event_name = 'note_exported'
           and exp.properties->>'noteId' = sn.note_id
           and exp.created_at >= p_from
           and exp.created_at <= p_to
      )
    )::integer,
    count(*) filter (
      where exists (
        select 1 from public.product_events ed
         where ed.event_name = 'note_edited'
           and ed.properties->>'noteId' = sn.note_id
           and ed.created_at >= p_from
           and ed.created_at <= p_to
      )
    )::integer
  into v_notes_saved, v_notes_exported, v_notes_edited
  from saved_notes sn;

  -- 7-day library return (users who saved a note and reopened any saved note within 7 days after saving)
  with savers as (
    select pe.owner_id, min(pe.created_at) as first_saved_at
      from public.product_events pe
     where pe.event_name = 'note_saved'
       and pe.owner_id is not null
       and pe.created_at >= p_from
       and pe.created_at <= p_to
     group by pe.owner_id
  )
  select
    count(*)::integer,
    count(*) filter (
      where exists (
        select 1 from public.product_events op
         where op.owner_id = sv.owner_id
           and op.event_name = 'note_opened'
           and op.created_at > sv.first_saved_at
           and op.created_at <= sv.first_saved_at + interval '7 days'
      )
    )::integer
  into v_return_eligible_users, v_return_users
  from savers sv;

  -- Section regenerations & retry events in usage_events/product_events
  select count(*)::integer
    into v_regen_actions
    from public.usage_events ue
   where ue.created_at >= p_from
     and ue.created_at <= p_to
     and ue.refunded_at is null
     and ue.event_type in ('generation_retry', 'section_regenerate');

  -- Token consumption from generation_completed properties (plus completed generation_jobs if present)
  select
    coalesce(sum(case when (pe.properties->>'promptTokens') ~ '^[0-9]+$' then (pe.properties->>'promptTokens')::numeric else 0 end), 0),
    coalesce(sum(case when (pe.properties->>'outputTokens') ~ '^[0-9]+$' then (pe.properties->>'outputTokens')::numeric else 0 end), 0)
  into v_prompt_tokens, v_output_tokens
  from public.product_events pe
  where pe.event_name = 'generation_completed'
    and pe.created_at >= p_from
    and pe.created_at <= p_to;

  return jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'counts', jsonb_build_object(
      'signups', v_signups,
      'activatedUsers', v_activated,
      'generationStarted', v_gen_started,
      'generationCompleted', v_gen_completed,
      'generationFailed', v_gen_failed,
      'generationCancelled', v_gen_cancelled,
      'generationRepaired', v_gen_repaired,
      'regenerationActions', v_regen_actions,
      'notesSaved', v_notes_saved,
      'notesExported', v_notes_exported,
      'notesEdited', v_notes_edited,
      'returnEligibleUsers', v_return_eligible_users,
      'returnUsers', v_return_users,
      'promptTokens', v_prompt_tokens,
      'outputTokens', v_output_tokens
    ),
    'metrics', jsonb_build_object(
      'activationRate', case when v_signups > 0 then round(v_activated::numeric / v_signups, 4) else null end,
      'generationCompletionRate', case when greatest(v_gen_started - v_gen_cancelled, 0) > 0 then round(v_gen_completed::numeric / (v_gen_started - v_gen_cancelled), 4) else null end,
      'timeToFirstUsefulVisualMs', jsonb_build_object('p50', round(v_latency_p50, 1), 'p95', round(v_latency_p95, 1)),
      'saveRate', case when v_gen_completed > 0 then round(v_notes_saved::numeric / v_gen_completed, 4) else null end,
      'sevenDayLibraryReturnRate', case when v_return_eligible_users > 0 then round(v_return_users::numeric / v_return_eligible_users, 4) else null end,
      'exportRate', case when v_notes_saved > 0 then round(v_notes_exported::numeric / v_notes_saved, 4) else null end,
      'editEngagementRate', case when v_notes_saved > 0 then round(v_notes_edited::numeric / v_notes_saved, 4) else null end,
      'regenerationRate', case when v_gen_started > 0 then round((v_gen_repaired + v_regen_actions)::numeric / v_gen_started, 4) else null end,
      -- Estimated token USD cost (Flash-Lite blended reference rate: $0.10/1M input + $0.40/1M output)
      'costPerCompletedVisualUsd', case when v_gen_completed > 0 then round(((v_prompt_tokens * 0.00000010) + (v_output_tokens * 0.00000040)) / v_gen_completed, 6) else null end
    )
  );
end;
$$;

revoke all on function public.compute_product_metrics(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.compute_product_metrics(timestamptz, timestamptz) to service_role;
