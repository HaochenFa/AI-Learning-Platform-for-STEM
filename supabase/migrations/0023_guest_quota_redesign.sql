-- supabase/migrations/0023_guest_quota_redesign.sql
--
-- Guest quota redesign:
--   - Drop guest_entry_rate_limits table and consume_guest_entry_rate_limit_service RPC
--   - Drop guest_ai_quota_state table (replaced by guest_session_quota)
--   - Add guest_session_quota table (active sessions + creation rate + AI concurrency)
--   - Add acquire_guest_session_service RPC (global session caps, no IP tracking)
--   - Add release_guest_session_slot_service RPC (frontend calls on provision failure)
--   - Update acquire_guest_ai_slot_service to reference guest_session_quota
--   - Update release_guest_ai_slot_service to reference guest_session_quota
--   - Update discard_guest_sandbox to decrement active_sessions
--   - Update cleanup_expired_guest_sandboxes: 8-hour inactivity + active_sessions decrement
--   - Update release_guest_sandbox_quota to reference guest_session_quota

-- ─── 1. Drop retired entry rate-limit objects ────────────────────────────────

drop function if exists public.consume_guest_entry_rate_limit_service(text, integer, integer);
drop table if exists public.guest_entry_rate_limits;

-- ─── 2. Create guest_session_quota (replaces guest_ai_quota_state) ───────────

create table public.guest_session_quota (
  scope                      text        primary key default 'global',
  active_sessions            integer     not null default 0 check (active_sessions >= 0),
  creation_count             integer     not null default 0 check (creation_count >= 0),
  creation_window_started_at timestamptz not null default now(),
  active_requests            integer     not null default 0 check (active_requests >= 0),
  updated_at                 timestamptz not null default now()
);

-- Migrate existing active_requests value from guest_ai_quota_state if present
insert into public.guest_session_quota (scope, active_requests, updated_at)
select 'global', coalesce(active_requests, 0), now()
from   public.guest_ai_quota_state
where  scope = 'global'
on conflict (scope) do nothing;

-- Ensure the row exists even if old table was empty
insert into public.guest_session_quota (scope)
values ('global')
on conflict (scope) do nothing;

drop table if exists public.guest_ai_quota_state;

-- ─── 3. acquire_guest_session_service ────────────────────────────────────────
--   Atomically checks and increments both active_sessions and creation_count.
--   Returns {"ok": true} on success, or {"ok": false, "reason": "cap_active"|"cap_creation"}.

create or replace function public.acquire_guest_session_service(
  p_active_cap     integer default 60,
  p_creation_cap   integer default 20,
  p_window_seconds integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quota public.guest_session_quota%rowtype;
  v_now   timestamptz := now();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('guest_session_quota'));

  select * into v_quota
  from   public.guest_session_quota
  where  scope = 'global'
  for    update;

  -- Reset hourly creation window if expired
  if extract(epoch from (v_now - v_quota.creation_window_started_at)) > p_window_seconds then
    v_quota.creation_count             := 0;
    v_quota.creation_window_started_at := v_now;
  end if;

  if v_quota.active_sessions >= p_active_cap then
    return jsonb_build_object('ok', false, 'reason', 'cap_active');
  end if;

  if v_quota.creation_count >= p_creation_cap then
    return jsonb_build_object('ok', false, 'reason', 'cap_creation');
  end if;

  update public.guest_session_quota
  set active_sessions            = v_quota.active_sessions + 1,
      creation_count             = v_quota.creation_count + 1,
      creation_window_started_at = v_quota.creation_window_started_at,
      updated_at                 = v_now
  where scope = 'global';

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.acquire_guest_session_service(integer, integer, integer) to service_role;

-- ─── 4. release_guest_session_slot_service ───────────────────────────────────
--   Decrements active_sessions by 1 (floor 0).
--   Called from sandbox.ts in failure path when provision fails after quota was acquired.

create or replace function public.release_guest_session_slot_service()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  update public.guest_session_quota
  set active_sessions = greatest(active_sessions - 1, 0),
      updated_at      = now()
  where scope = 'global';
end;
$$;

grant execute on function public.release_guest_session_slot_service() to service_role;

-- ─── 5. acquire_guest_ai_slot_service (monitoring only; semaphore is the gate) ──
--   No longer checks the global cap before incrementing — the Python asyncio.Semaphore
--   is the real gate. The DB counter is kept for orphan cleanup accuracy only.

create or replace function public.acquire_guest_ai_slot_service(
  p_sandbox_id uuid,
  p_limit      integer default 20  -- kept for signature compat, not used as gate
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_acquired boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  update public.guest_sandboxes
     set active_ai_requests = active_ai_requests + 1,
         last_seen_at       = now(),
         updated_at         = now()
   where id     = p_sandbox_id
     and status = 'active'
  returning true into v_acquired;

  if not coalesce(v_acquired, false) then
    return false;
  end if;

  update public.guest_session_quota
     set active_requests = active_requests + 1,
         updated_at      = now()
   where scope = 'global';

  return true;
end;
$$;

grant execute on function public.acquire_guest_ai_slot_service(uuid, integer) to service_role;

-- ─── 6. release_guest_ai_slot_service (references guest_session_quota) ───────

create or replace function public.release_guest_ai_slot_service(
  p_sandbox_id uuid
)
returns public.guest_sandboxes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row      public.guest_sandboxes;
  v_released integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  update public.guest_sandboxes
     set active_ai_requests = greatest(active_ai_requests - 1, 0),
         last_seen_at       = now(),
         updated_at         = now()
   where id                 = p_sandbox_id
     and active_ai_requests > 0
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  v_released := 1;

  update public.guest_session_quota
     set active_requests = greatest(active_requests - v_released, 0),
         updated_at      = now()
   where scope = 'global';

  return v_row;
end;
$$;

grant execute on function public.release_guest_ai_slot_service(uuid) to service_role;

-- ─── 7. discard_guest_sandbox (also decrements active_sessions) ──────────────

create or replace function public.discard_guest_sandbox(
  p_sandbox_id uuid
)
returns public.guest_sandboxes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.guest_sandboxes;
  v_row      public.guest_sandboxes;
  v_released integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_existing
  from   public.guest_sandboxes gs
  where  gs.id      = p_sandbox_id
    and  gs.user_id = auth.uid()
    and  gs.status  = 'active'
  for update;

  if not found then
    raise exception 'Guest sandbox not found.' using errcode = 'P0002';
  end if;

  v_released := greatest(coalesce(v_existing.active_ai_requests, 0), 0);

  -- Release any in-flight AI slots from global counter
  if v_released > 0 then
    update public.guest_session_quota
       set active_requests = greatest(active_requests - v_released, 0),
           updated_at      = now()
     where scope = 'global';
  end if;

  -- Decrement the active session count
  update public.guest_session_quota
     set active_sessions = greatest(active_sessions - 1, 0),
         updated_at      = now()
   where scope = 'global';

  delete from public.classes where sandbox_id = p_sandbox_id;

  update public.guest_sandboxes
     set status             = 'discarded',
         active_ai_requests = 0,
         last_seen_at       = now(),
         updated_at         = now()
   where id = p_sandbox_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.discard_guest_sandbox(uuid) to authenticated;

-- ─── 8. cleanup_expired_guest_sandboxes: 8-hour inactivity + session count ───

create or replace function public.cleanup_expired_guest_sandboxes(
  p_batch_size integer default 25
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row          record;
  v_count        integer := 0;
  v_limit        integer := greatest(1, least(coalesce(p_batch_size, 25), 100));
  v_rows_affected integer := 0;
  v_did_work     boolean;
  v_released     integer := 0;
begin
  -- Ensure quota row exists before any updates
  insert into public.guest_session_quota (scope)
  values ('global')
  on conflict (scope) do nothing;

  for v_row in
    select gs.id,
           gs.user_id,
           gs.status                                           as current_status,
           greatest(coalesce(gs.active_ai_requests, 0), 0)   as active_ai_requests
    from   public.guest_sandboxes gs
    where  gs.status in ('expired', 'discarded')
       or  (
             gs.status = 'active'
             and (
               gs.expires_at  <= now()
               or gs.last_seen_at <= now() - interval '8 hours'
             )
           )
    order by gs.expires_at asc nulls first, gs.last_seen_at asc, gs.created_at asc
    limit v_limit
    for update skip locked
  loop
    v_did_work := false;
    v_released := greatest(coalesce(v_row.active_ai_requests, 0), 0);

    -- Release in-flight AI slots
    if v_released > 0 then
      update public.guest_session_quota
         set active_requests = greatest(active_requests - v_released, 0),
             updated_at      = now()
       where scope = 'global';
    end if;

    -- Decrement active session count only for non-discarded sandboxes.
    -- Sandboxes with status='discarded' already had their slot decremented
    -- by discard_guest_sandbox — decrementing again would undercount.
    if v_row.current_status != 'discarded' then
      update public.guest_session_quota
         set active_sessions = greatest(active_sessions - 1, 0),
             updated_at      = now()
       where scope = 'global';
    end if;

    delete from public.classes where sandbox_id = v_row.id;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then v_did_work := true; end if;

    delete from auth.users where id = v_row.user_id and coalesce(is_anonymous, false);
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then v_did_work := true; end if;

    delete from public.guest_sandboxes where id = v_row.id;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then v_did_work := true; end if;

    if v_did_work then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.cleanup_expired_guest_sandboxes(integer) to service_role;

-- ─── 9. release_guest_sandbox_quota (references guest_session_quota) ─────────

create or replace function public.release_guest_sandbox_quota(
  p_sandbox_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  select greatest(coalesce(active_ai_requests, 0), 0)
    into v_count
    from public.guest_sandboxes
   where id = p_sandbox_id;

  if v_count > 0 then
    update public.guest_session_quota
       set active_requests = greatest(active_requests - v_count, 0),
           updated_at      = now()
     where scope = 'global';
  end if;
end;
$$;

grant execute on function public.release_guest_sandbox_quota(uuid) to service_role;
