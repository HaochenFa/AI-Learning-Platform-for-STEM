-- Schedule guest sandbox cleanup dispatch and reconcile stale quota state.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create schema if not exists vault;

do $$
begin
  if exists (
    select 1
    from pg_extension
    where extname in ('supabase_vault', 'vault')
  ) then
    return;
  end if;

  begin
    create extension if not exists supabase_vault with schema vault;
  exception
    when undefined_file then
      create extension if not exists vault with schema vault;
  end;
end;
$$;

create or replace function public.reconcile_guest_session_quota_service(
  p_window_seconds integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_quota public.guest_session_quota%rowtype;
  v_active_sessions integer := 0;
  v_active_requests integer := 0;
  v_expired_marked integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('guest_session_quota'));

  insert into public.guest_session_quota (scope)
  values ('global')
  on conflict (scope) do nothing;

  update public.guest_sandboxes
     set status = 'expired',
         active_ai_requests = 0,
         updated_at = v_now
   where status = 'active'
     and (
       expires_at <= v_now
       or last_seen_at <= v_now - interval '8 hours'
     );
  get diagnostics v_expired_marked = row_count;

  update public.guest_sandboxes
     set active_ai_requests = 0,
         updated_at = v_now
   where status in ('expired', 'discarded')
     and greatest(coalesce(active_ai_requests, 0), 0) > 0;

  select *
    into v_quota
    from public.guest_session_quota
   where scope = 'global'
   for update;

  if extract(epoch from (v_now - v_quota.creation_window_started_at)) >
     greatest(1, coalesce(p_window_seconds, 3600)) then
    v_quota.creation_count := 0;
    v_quota.creation_window_started_at := v_now;
  end if;

  select count(*)::integer,
         coalesce(sum(greatest(coalesce(active_ai_requests, 0), 0)), 0)::integer
    into v_active_sessions, v_active_requests
    from public.guest_sandboxes
   where status = 'active';

  update public.guest_session_quota
     set active_sessions = v_active_sessions,
         active_requests = v_active_requests,
         creation_count = v_quota.creation_count,
         creation_window_started_at = v_quota.creation_window_started_at,
         updated_at = v_now
   where scope = 'global';

  return jsonb_build_object(
    'ok', true,
    'expired_marked', v_expired_marked,
    'active_sessions', v_active_sessions,
    'active_requests', v_active_requests,
    'creation_count', v_quota.creation_count,
    'creation_window_started_at', v_quota.creation_window_started_at
  );
end;
$$;

revoke all on function public.reconcile_guest_session_quota_service(integer) from public;
grant execute on function public.reconcile_guest_session_quota_service(integer) to service_role;

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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  perform public.reconcile_guest_session_quota_service(p_window_seconds);

  select *
    into v_quota
    from public.guest_session_quota
   where scope = 'global'
   for update;

  if v_quota.active_sessions >= p_active_cap then
    return jsonb_build_object('ok', false, 'reason', 'cap_active');
  end if;

  if v_quota.creation_count >= p_creation_cap then
    return jsonb_build_object('ok', false, 'reason', 'cap_creation');
  end if;

  update public.guest_session_quota
     set active_sessions = v_quota.active_sessions + 1,
         creation_count = v_quota.creation_count + 1,
         creation_window_started_at = v_quota.creation_window_started_at,
         updated_at = now()
   where scope = 'global';

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.acquire_guest_session_service(integer, integer, integer) to service_role;

create or replace function public.cleanup_expired_guest_sandboxes(
  p_batch_size integer default 25
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row           record;
  v_count         integer := 0;
  v_limit         integer := greatest(1, least(coalesce(p_batch_size, 25), 100));
  v_rows_affected integer := 0;
  v_did_work      boolean;
  v_released      integer := 0;
begin
  insert into public.guest_session_quota (scope)
  values ('global')
  on conflict (scope) do nothing;

  for v_row in
    select gs.id,
           gs.user_id,
           gs.status                                         as current_status,
           greatest(coalesce(gs.active_ai_requests, 0), 0)  as active_ai_requests
      from public.guest_sandboxes gs
     where gs.status in ('expired', 'discarded')
        or (
          gs.status = 'active'
          and (
            gs.expires_at <= now()
            or gs.last_seen_at <= now() - interval '8 hours'
          )
        )
     order by gs.expires_at asc nulls first, gs.last_seen_at asc, gs.created_at asc
     limit v_limit
     for update skip locked
  loop
    v_did_work := false;
    v_released := greatest(coalesce(v_row.active_ai_requests, 0), 0);

    if v_released > 0 then
      update public.guest_session_quota
         set active_requests = greatest(active_requests - v_released, 0),
             updated_at = now()
       where scope = 'global';
    end if;

    -- Only rows that are still marked active should release an active-session slot.
    if v_row.current_status = 'active' then
      update public.guest_session_quota
         set active_sessions = greatest(active_sessions - 1, 0),
             updated_at = now()
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

create or replace function public.run_guest_sandbox_cleanup_dispatch(
  p_batch_size integer default 100,
  p_timeout_milliseconds integer default 60000
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_url text;
  v_cleanup_token text;
  v_headers jsonb := jsonb_build_object('Content-Type', 'application/json');
  v_request_id bigint;
begin
  select decrypted_secret
    into v_project_url
    from vault.decrypted_secrets
   where name = 'project_url'
   limit 1;

  if v_project_url is null then
    raise exception 'Missing vault secret: project_url';
  end if;

  select decrypted_secret
    into v_cleanup_token
    from vault.decrypted_secrets
   where name = 'guest_sandbox_cleanup_token'
   limit 1;

  if v_cleanup_token is not null then
    v_headers := v_headers || jsonb_build_object(
      'Authorization',
      'Bearer ' || v_cleanup_token
    );
  end if;

  select net.http_post(
    url := v_project_url || '/functions/v1/guest-sandbox-cleanup',
    headers := v_headers,
    body := jsonb_build_object(
      'batchSize',
      greatest(1, least(coalesce(p_batch_size, 100), 100))
    ),
    timeout_milliseconds := greatest(1000, coalesce(p_timeout_milliseconds, 60000))
  )
    into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.run_guest_sandbox_cleanup_dispatch(integer, integer) from public;
grant execute on function public.run_guest_sandbox_cleanup_dispatch(integer, integer) to postgres;

do $$
begin
  if exists (
    select 1
      from cron.job
     where jobname = 'guest-sandbox-cleanup-dispatch-5m'
  ) then
    perform cron.unschedule('guest-sandbox-cleanup-dispatch-5m');
  end if;

  perform cron.schedule(
    'guest-sandbox-cleanup-dispatch-5m',
    '5 minutes',
    $job$select public.run_guest_sandbox_cleanup_dispatch();$job$
  );
end;
$$;
