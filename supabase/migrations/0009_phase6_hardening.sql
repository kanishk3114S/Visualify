-- =============================================================================
-- Visualify Phase 6 - 0009: Launch Hardening, Selection Exports & Quotas
-- =============================================================================
-- Idempotent & additive. Builds on 0004 (exports) and 0008 (usage_events).
-- PRD refs: FR-EXP-05, §14.1, §15.2 #12, §16.3 GENERATION_LIMIT_MONTHLY.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FR-EXP-05: Support 'selection' scope on public.note_exports
-- -----------------------------------------------------------------------------
alter table public.note_exports drop constraint if exists note_exports_scope;
alter table public.note_exports add constraint note_exports_scope
  check (scope in ('full', 'frame', 'selection'));

-- -----------------------------------------------------------------------------
-- 2. Usage metering events: extend event types & support atomic monthly quota
-- -----------------------------------------------------------------------------
alter table public.usage_events drop constraint if exists usage_events_type;
alter table public.usage_events add constraint usage_events_type
  check (
    event_type in (
      'generation',
      'generation_create',
      'generation_retry',
      'explain_node',
      'quiz',
      'flashcards',
      'revision',
      'ask_note',
      'section_regenerate',
      'export'
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Race-safe atomic monthly quota check + usage insert (service_role only)
-- -----------------------------------------------------------------------------
-- Uses a per-user/month transaction-scoped advisory lock so concurrent requests
-- at the quota boundary cannot overshoot p_limit. Rejects BEFORE model execution.
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
  p_metadata jsonb default '{}'::jsonb
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
     and ue.event_type = any(p_billable_types);

  if p_limit is not null and p_limit >= 0 and (v_used + greatest(p_units, 0)) > p_limit then
    return query select false, v_used, p_limit, v_resets_at, null::uuid;
    return;
  end if;

  insert into public.usage_events (owner_id, event_type, units, metadata)
  values (p_owner_id, p_event_type, greatest(p_units, 0), coalesce(p_metadata, '{}'::jsonb))
  returning id into v_event_id;

  return query select true, (v_used + greatest(p_units, 0))::integer, p_limit, v_resets_at, v_event_id;
end;
$$;

revoke all on function public.consume_monthly_quota(uuid, text, integer, text[], integer, jsonb) from public, anon, authenticated;
grant execute on function public.consume_monthly_quota(uuid, text, integer, text[], integer, jsonb) to service_role;
