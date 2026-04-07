begin;

  -- 1) Delete every sandbox-backed class first.
  -- This removes the owner_id references that block auth.users deletion.
  delete from public.classes
  where sandbox_id is not null;

  -- 2) Delete every anonymous auth user tied to a sandbox.
  -- guest_sandboxes.user_id -> auth.users(id) is ON DELETE CASCADE,
  -- so this clears most sandbox rows automatically.
  delete from auth.users
  where id in (
    select distinct gs.user_id
    from public.guest_sandboxes gs
  )
  and coalesce(is_anonymous, false);

  -- 3) Clean up any leftover sandbox rows defensively.
  delete from public.guest_sandboxes;

  -- 4) Reset the global guest quota state.
  update public.guest_session_quota
  set active_sessions = 0,
      active_requests = 0,
      creation_count = 0,
      creation_window_started_at = now(),
      updated_at = now()
  where scope = 'global';

  commit;
