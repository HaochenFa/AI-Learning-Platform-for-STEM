-- Guest mode alignment fixes:
-- 1. Enforce concurrent guest AI quota globally across all active guest sandboxes.
-- 2. Allow bounded cleanup to reclaim untouched stale active guest sandboxes.

create table if not exists public.guest_ai_quota_state (
  scope text primary key,
  active_requests integer not null default 0 check (active_requests >= 0),
  updated_at timestamptz not null default now()
);

insert into public.guest_ai_quota_state (scope, active_requests)
values ('global', 0)
on conflict (scope) do nothing;

create or replace function public.acquire_guest_ai_slot_service(
  p_sandbox_id uuid,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := greatest(1, coalesce(p_limit, 1));
  v_acquired boolean := false;
  v_state public.guest_ai_quota_state;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  select *
    into v_state
    from public.guest_ai_quota_state
   where scope = 'global'
   for update;

  if not found then
    insert into public.guest_ai_quota_state (scope, active_requests, updated_at)
    values ('global', 0, now())
    on conflict (scope) do nothing;

    select *
      into v_state
      from public.guest_ai_quota_state
     where scope = 'global'
     for update;
  end if;

  if coalesce(v_state.active_requests, 0) >= v_limit then
    return false;
  end if;

  update public.guest_sandboxes
     set active_ai_requests = active_ai_requests + 1,
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id
     and status = 'active'
  returning true into v_acquired;

  if not coalesce(v_acquired, false) then
    return false;
  end if;

  update public.guest_ai_quota_state
     set active_requests = active_requests + 1,
         updated_at = now()
   where scope = 'global';

  return true;
end;
$$;

create or replace function public.release_guest_ai_slot_service(
  p_sandbox_id uuid
)
returns public.guest_sandboxes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.guest_sandboxes;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  update public.guest_ai_quota_state
     set active_requests = greatest(active_requests - 1, 0),
         updated_at = now()
   where scope = 'global';

  update public.guest_sandboxes
     set active_ai_requests = greatest(active_ai_requests - 1, 0),
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.cleanup_expired_guest_sandboxes(
  p_batch_size integer default 25
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_count integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_batch_size, 25), 100));
  v_rows_affected integer := 0;
  v_did_work boolean;
begin
  for v_row in
    select gs.id, gs.user_id
    from public.guest_sandboxes gs
    where gs.status in ('expired', 'discarded')
       or (
         gs.status = 'active'
         and (
           gs.expires_at <= now()
           or gs.last_seen_at <= now() - interval '1 hour'
         )
       )
    order by gs.expires_at asc nulls first, gs.last_seen_at asc, gs.created_at asc
    limit v_limit
    for update skip locked
  loop
    v_did_work := false;

    delete from public.classes where sandbox_id = v_row.id;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then
      v_did_work := true;
    end if;

    delete from auth.users where id = v_row.user_id and coalesce(is_anonymous, false);
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then
      v_did_work := true;
    end if;

    delete from public.guest_sandboxes where id = v_row.id;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then
      v_did_work := true;
    end if;

    if v_did_work then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;
