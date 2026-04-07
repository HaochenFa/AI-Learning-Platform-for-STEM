select count(*) as remaining_guest_sandboxes
  from public.guest_sandboxes;

  select active_sessions, active_requests, creation_count, creation_window_started_at, updated_at
  from public.guest_session_quota
  where scope = 'global';

  select count(*) as remaining_guest_classes
  from public.classes
  where sandbox_id is not null;
