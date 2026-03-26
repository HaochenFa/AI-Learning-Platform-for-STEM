-- Guest mode enforcement follow-up: shared backend quota/concurrency state and
-- atomic discard semantics for frontend guest lifecycle flows.

alter table public.guest_sandboxes
  add column if not exists active_ai_requests integer not null default 0 check (active_ai_requests >= 0);

create or replace function public.increment_guest_ai_usage_service(
  p_sandbox_id uuid,
  p_feature text
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

  update public.guest_sandboxes
     set chat_messages_used = chat_messages_used + case when p_feature = 'chat' then 1 else 0 end,
         quiz_generations_used = quiz_generations_used + case when p_feature = 'quiz' then 1 else 0 end,
         flashcard_generations_used = flashcard_generations_used + case when p_feature = 'flashcards' then 1 else 0 end,
         blueprint_regenerations_used = blueprint_regenerations_used + case when p_feature = 'blueprint' then 1 else 0 end,
         embedding_operations_used = embedding_operations_used + case when p_feature = 'embedding' then 1 else 0 end,
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id
     and status = 'active'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Guest sandbox not found.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

grant execute on function public.increment_guest_ai_usage_service(uuid, text) to service_role;

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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  update public.guest_sandboxes
     set active_ai_requests = active_ai_requests + 1,
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id
     and status = 'active'
     and active_ai_requests < v_limit
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

grant execute on function public.acquire_guest_ai_slot_service(uuid, integer) to service_role;

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

  update public.guest_sandboxes
     set active_ai_requests = greatest(active_ai_requests - 1, 0),
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id
     and status = 'active'
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.release_guest_ai_slot_service(uuid) to service_role;

create or replace function public.discard_guest_sandbox(
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
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform 1
    from public.guest_sandboxes gs
   where gs.id = p_sandbox_id
     and gs.user_id = auth.uid()
     and gs.status = 'active'
   for update;

  if not found then
    raise exception 'Guest sandbox not found.' using errcode = 'P0002';
  end if;

  delete from public.classes
   where sandbox_id = p_sandbox_id;

  update public.guest_sandboxes
     set status = 'discarded',
         class_id = null,
         active_ai_requests = 0,
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.discard_guest_sandbox(uuid) to authenticated;
