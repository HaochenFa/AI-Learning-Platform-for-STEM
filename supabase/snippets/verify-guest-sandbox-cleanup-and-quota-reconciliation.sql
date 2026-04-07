-- 1) Confirm the migration-installed functions exist
  select proname
  from pg_proc
  where proname in (
    'reconcile_guest_session_quota_service',
    'run_guest_sandbox_cleanup_dispatch',
    'acquire_guest_session_service',
    'cleanup_expired_guest_sandboxes'
  )
  order by proname;

  -- 2) Confirm the cron job exists
  select jobname, schedule, command
  from cron.job
  where jobname = 'guest-sandbox-cleanup-dispatch-5m';

  -- 3) Inspect quota row vs actual active rows
  select
    q.scope,
    q.active_sessions as quota_active_sessions,
    q.active_requests as quota_active_requests,
    q.creation_count,
    q.creation_window_started_at,
    q.updated_at,
    (
      select count(*)
      from public.guest_sandboxes gs
      where gs.status = 'active'
    ) as actual_active_rows,
    (
      select coalesce(sum(greatest(coalesce(gs.active_ai_requests, 0), 0)), 0)
      from public.guest_sandboxes gs
      where gs.status = 'active'
    ) as actual_active_requests
  from public.guest_session_quota q
  where q.scope = 'global';

  -- 4) Check whether any active rows are already stale
  select
    count(*) as active_total,
    count(*) filter (where expires_at <= now()) as active_past_expiry,
    count(*) filter (where last_seen_at <= now() - interval '8 hours') as active_past_inactivity
  from public.guest_sandboxes
  where status = 'active';

  -- 5) Status distribution
  select status, count(*) as count
  from public.guest_sandboxes
  group by status
  order by status;
