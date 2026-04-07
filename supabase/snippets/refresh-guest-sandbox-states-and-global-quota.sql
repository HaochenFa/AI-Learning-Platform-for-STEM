begin;

  -- First, reclassify stale active rows as expired for review-readiness.
  update public.guest_sandboxes
  set status = 'expired',
      active_ai_requests = 0,
      updated_at = now()
  where status = 'active'
    and (
      expires_at <= now()
      or last_seen_at <= now() - interval '8 hours'
    );

  -- Then delete all inactive anonymous users.
  -- Because guest_sandboxes.user_id references auth.users(id) on delete cascade,
  -- removing the auth user clears the sandbox row and sandbox-scoped class data.
  delete from auth.users
  where id in (
    select gs.user_id
    from public.guest_sandboxes gs
    where gs.status in ('expired', 'discarded')
  )
  and coalesce(is_anonymous, false);

  -- Finally, reset the quota row to the live truth from remaining active rows.
  update public.guest_session_quota q
  set active_sessions = coalesce((
        select count(*)
        from public.guest_sandboxes gs
        where gs.status = 'active'
      ), 0),
      active_requests = coalesce((
        select sum(greatest(coalesce(gs.active_ai_requests, 0), 0))
        from public.guest_sandboxes gs
        where gs.status = 'active'
      ), 0),
      updated_at = now()
  where q.scope = 'global';

  commit;
