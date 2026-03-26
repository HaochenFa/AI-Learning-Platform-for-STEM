-- Guest mode: sandbox infrastructure, auth trigger update, lifecycle helpers, and RLS hooks.

create table if not exists public.guest_sandboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'expired', 'discarded')),
  guest_role public.account_type not null default 'teacher',
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  chat_messages_used integer not null default 0 check (chat_messages_used >= 0),
  quiz_generations_used integer not null default 0 check (quiz_generations_used >= 0),
  flashcard_generations_used integer not null default 0 check (flashcard_generations_used >= 0),
  blueprint_regenerations_used integer not null default 0 check (blueprint_regenerations_used >= 0)
);

create unique index if not exists guest_sandboxes_user_active_idx
  on public.guest_sandboxes (user_id)
  where status = 'active';

create index if not exists guest_sandboxes_status_expires_idx
  on public.guest_sandboxes (status, expires_at, last_seen_at);

drop trigger if exists guest_sandboxes_set_updated_at on public.guest_sandboxes;
create trigger guest_sandboxes_set_updated_at
before update on public.guest_sandboxes
for each row
execute function public.set_updated_at();

alter table public.guest_sandboxes enable row level security;

drop policy if exists guest_sandboxes_select_own on public.guest_sandboxes;
create policy guest_sandboxes_select_own
on public.guest_sandboxes
for select
using (auth.uid() = user_id);

drop policy if exists guest_sandboxes_insert_own on public.guest_sandboxes;
create policy guest_sandboxes_insert_own
on public.guest_sandboxes
for insert
with check (auth.uid() = user_id);

drop policy if exists guest_sandboxes_update_own on public.guest_sandboxes;
create policy guest_sandboxes_update_own
on public.guest_sandboxes
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

alter table public.classes add column if not exists sandbox_id uuid;
alter table public.enrollments add column if not exists sandbox_id uuid;
alter table public.materials add column if not exists sandbox_id uuid;
alter table public.material_chunks add column if not exists sandbox_id uuid;
alter table public.blueprints add column if not exists sandbox_id uuid;
alter table public.topics add column if not exists sandbox_id uuid;
alter table public.objectives add column if not exists sandbox_id uuid;
alter table public.activities add column if not exists sandbox_id uuid;
alter table public.assignments add column if not exists sandbox_id uuid;
alter table public.assignment_recipients add column if not exists sandbox_id uuid;
alter table public.submissions add column if not exists sandbox_id uuid;
alter table public.quiz_questions add column if not exists sandbox_id uuid;
alter table public.flashcards add column if not exists sandbox_id uuid;
alter table public.feedback add column if not exists sandbox_id uuid;
alter table public.reflections add column if not exists sandbox_id uuid;
alter table public.class_chat_sessions add column if not exists sandbox_id uuid;
alter table public.class_chat_messages add column if not exists sandbox_id uuid;
alter table public.class_chat_session_compactions add column if not exists sandbox_id uuid;
alter table public.class_insights_snapshots add column if not exists sandbox_id uuid;
alter table public.class_teaching_brief_snapshots add column if not exists sandbox_id uuid;
alter table public.ai_requests add column if not exists sandbox_id uuid;

create index if not exists classes_sandbox_id_idx
  on public.classes (sandbox_id)
  where sandbox_id is not null;

create index if not exists enrollments_sandbox_id_idx
  on public.enrollments (sandbox_id)
  where sandbox_id is not null;

create index if not exists materials_sandbox_id_idx
  on public.materials (sandbox_id)
  where sandbox_id is not null;

create index if not exists material_chunks_sandbox_id_idx
  on public.material_chunks (sandbox_id)
  where sandbox_id is not null;

create index if not exists blueprints_sandbox_id_idx
  on public.blueprints (sandbox_id)
  where sandbox_id is not null;

create index if not exists activities_sandbox_id_idx
  on public.activities (sandbox_id)
  where sandbox_id is not null;

create index if not exists assignments_sandbox_id_idx
  on public.assignments (sandbox_id)
  where sandbox_id is not null;

create index if not exists assignment_recipients_sandbox_id_idx
  on public.assignment_recipients (sandbox_id)
  where sandbox_id is not null;

create index if not exists submissions_sandbox_id_idx
  on public.submissions (sandbox_id)
  where sandbox_id is not null;

create index if not exists class_chat_sessions_sandbox_id_idx
  on public.class_chat_sessions (sandbox_id)
  where sandbox_id is not null;

create index if not exists class_chat_messages_sandbox_id_idx
  on public.class_chat_messages (sandbox_id)
  where sandbox_id is not null;

create index if not exists ai_requests_sandbox_id_idx
  on public.ai_requests (sandbox_id)
  where sandbox_id is not null;

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  account_type_text text;
  parsed_account_type public.account_type;
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  account_type_text := lower(trim(coalesce(new.raw_user_meta_data ->> 'account_type', '')));
  if account_type_text not in ('teacher', 'student') then
    raise exception 'account_type is required and must be teacher or student';
  end if;

  parsed_account_type := account_type_text::public.account_type;

  insert into public.profiles (id, display_name, avatar_url, account_type)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    parsed_account_type
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url = excluded.avatar_url;

  return new;
end;
$$;

create or replace function public.requesting_sandbox_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select gs.id
  from public.guest_sandboxes gs
  where gs.user_id = auth.uid()
    and gs.status = 'active'
  limit 1;
$$;

create or replace function public.requesting_guest_role()
returns public.account_type
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select gs.guest_role
  from public.guest_sandboxes gs
  where gs.user_id = auth.uid()
    and gs.status = 'active'
  limit 1;
$$;

create or replace function public.is_guest_user()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and coalesce(u.is_anonymous, false)
  );
$$;

create or replace function public.matches_requesting_guest_sandbox(target_sandbox_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    target_sandbox_id is not null
    and public.is_guest_user()
    and target_sandbox_id = public.requesting_sandbox_id();
$$;

create or replace function public.increment_guest_ai_usage(
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
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.guest_sandboxes
     set chat_messages_used = chat_messages_used + case when p_feature = 'chat' then 1 else 0 end,
         quiz_generations_used = quiz_generations_used + case when p_feature = 'quiz' then 1 else 0 end,
         flashcard_generations_used = flashcard_generations_used + case when p_feature = 'flashcards' then 1 else 0 end,
         blueprint_regenerations_used = blueprint_regenerations_used + case when p_feature = 'blueprint' then 1 else 0 end,
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id
     and user_id = auth.uid()
     and status = 'active'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Guest sandbox not found.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

grant execute on function public.increment_guest_ai_usage(uuid, text) to authenticated;

create or replace function public.clone_guest_sandbox(
  p_sandbox_id uuid,
  p_guest_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seed_sandbox_id constant uuid := '00000000-0000-0000-0000-000000000000';
  v_seed_class_id uuid;
  v_seed_blueprint_id uuid;
  v_existing_class_id uuid;
  v_class_id uuid := gen_random_uuid();
  v_blueprint_id uuid := gen_random_uuid();
  v_material_row record;
  v_material_map jsonb := '{}'::jsonb;
  v_material_chunk_row record;
  v_topic_row record;
  v_topic_map jsonb := '{}'::jsonb;
  v_topic_id uuid;
  v_objective_row record;
  v_activity_row record;
  v_activity_map jsonb := '{}'::jsonb;
  v_activity_id uuid;
  v_assignment_row record;
  v_assignment_map jsonb := '{}'::jsonb;
  v_assignment_id uuid;
  v_recipient_row record;
  v_recipient_id uuid;
  v_submission_row record;
  v_submission_map jsonb := '{}'::jsonb;
  v_submission_id uuid;
  v_feedback_row record;
  v_reflection_row record;
  v_chat_session_row record;
  v_chat_session_map jsonb := '{}'::jsonb;
  v_chat_session_id uuid;
  v_chat_message_row record;
  v_compaction_row record;
  v_snapshot_row record;
  v_teaching_brief_row record;
  v_ai_request_row record;
begin
  if auth.uid() is distinct from p_guest_user_id then
    raise exception 'Guest sandbox can only be cloned for the authenticated anonymous user.'
      using errcode = '42501';
  end if;

  if not public.is_guest_user() then
    raise exception 'Guest sandbox cloning requires an anonymous session.'
      using errcode = '42501';
  end if;

  select gs.class_id
    into v_existing_class_id
    from public.guest_sandboxes gs
   where gs.id = p_sandbox_id
     and gs.user_id = p_guest_user_id
     and gs.status = 'active'
   limit 1;

  if v_existing_class_id is not null then
    return v_existing_class_id;
  end if;

  select c.id
    into v_seed_class_id
    from public.classes c
   where c.sandbox_id = v_seed_sandbox_id
   order by c.created_at asc
   limit 1;

  if v_seed_class_id is null then
    raise exception 'Guest seed class is missing.' using errcode = 'P0002';
  end if;

  select b.id
    into v_seed_blueprint_id
    from public.blueprints b
   where b.class_id = v_seed_class_id
     and b.sandbox_id = v_seed_sandbox_id
     and b.status = 'published'
   order by b.published_at desc nulls last, b.created_at desc
   limit 1;

  insert into public.classes (
    id,
    owner_id,
    title,
    description,
    subject,
    level,
    join_code,
    ai_provider,
    archived,
    sandbox_id
  )
  select
    v_class_id,
    p_guest_user_id,
    c.title,
    c.description,
    c.subject,
    c.level,
    upper(substr(replace(p_sandbox_id::text, '-', ''), 1, 8)),
    c.ai_provider,
    false,
    p_sandbox_id
  from public.classes c
  where c.id = v_seed_class_id;

  insert into public.enrollments (
    class_id,
    user_id,
    role,
    sandbox_id
  )
  values (
    v_class_id,
    p_guest_user_id,
    'student',
    p_sandbox_id
  )
  on conflict (class_id, user_id) do update
    set role = excluded.role,
        sandbox_id = excluded.sandbox_id;

  for v_material_row in
    select *
    from public.materials
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by created_at asc, id asc
  loop
    v_material_map := v_material_map || jsonb_build_object(v_material_row.id::text, gen_random_uuid()::text);

    insert into public.materials (
      id,
      class_id,
      uploaded_by,
      title,
      storage_path,
      mime_type,
      size_bytes,
      status,
      extracted_text,
      metadata,
      created_at,
      sandbox_id
    )
    values (
      (v_material_map ->> v_material_row.id::text)::uuid,
      v_class_id,
      p_guest_user_id,
      v_material_row.title,
      v_material_row.storage_path,
      v_material_row.mime_type,
      v_material_row.size_bytes,
      coalesce(v_material_row.status, 'ready'),
      v_material_row.extracted_text,
      v_material_row.metadata,
      v_material_row.created_at,
      p_sandbox_id
    );
  end loop;

  for v_material_chunk_row in
    select *
    from public.material_chunks
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by created_at asc, id asc
  loop
    insert into public.material_chunks (
      id,
      material_id,
      class_id,
      source_type,
      source_index,
      section_title,
      text,
      token_count,
      embedding,
      embedding_provider,
      embedding_model,
      extraction_method,
      quality_score,
      metadata,
      created_at,
      sandbox_id
    )
    values (
      gen_random_uuid(),
      (v_material_map ->> v_material_chunk_row.material_id::text)::uuid,
      v_class_id,
      v_material_chunk_row.source_type,
      v_material_chunk_row.source_index,
      v_material_chunk_row.section_title,
      v_material_chunk_row.text,
      v_material_chunk_row.token_count,
      v_material_chunk_row.embedding,
      v_material_chunk_row.embedding_provider,
      v_material_chunk_row.embedding_model,
      v_material_chunk_row.extraction_method,
      v_material_chunk_row.quality_score,
      v_material_chunk_row.metadata,
      v_material_chunk_row.created_at,
      p_sandbox_id
    );
  end loop;

  if v_seed_blueprint_id is not null then
    insert into public.blueprints (
      id,
      class_id,
      version,
      status,
      summary,
      created_by,
      approved_by,
      published_by,
      created_at,
      approved_at,
      published_at,
      content_json,
      content_schema_version,
      sandbox_id
    )
    select
      v_blueprint_id,
      v_class_id,
      b.version,
      b.status,
      b.summary,
      p_guest_user_id,
      p_guest_user_id,
      p_guest_user_id,
      b.created_at,
      b.approved_at,
      b.published_at,
      b.content_json,
      b.content_schema_version,
      p_sandbox_id
    from public.blueprints b
    where b.id = v_seed_blueprint_id;

    for v_topic_row in
      select *
      from public.topics
      where blueprint_id = v_seed_blueprint_id
        and sandbox_id = v_seed_sandbox_id
      order by sequence asc, created_at asc, id asc
    loop
      v_topic_id := gen_random_uuid();
      v_topic_map := v_topic_map || jsonb_build_object(v_topic_row.id::text, v_topic_id::text);

      insert into public.topics (
        id,
        blueprint_id,
        title,
        description,
        section,
        sequence,
        prerequisite_topic_ids,
        created_at,
        sandbox_id
      )
      values (
        v_topic_id,
        v_blueprint_id,
        v_topic_row.title,
        v_topic_row.description,
        v_topic_row.section,
        v_topic_row.sequence,
        '{}'::uuid[],
        v_topic_row.created_at,
        p_sandbox_id
      );

      for v_objective_row in
        select *
        from public.objectives
        where topic_id = v_topic_row.id
          and sandbox_id = v_seed_sandbox_id
        order by created_at asc, id asc
      loop
        insert into public.objectives (
          id,
          topic_id,
          statement,
          level,
          created_at,
          sandbox_id
        )
        values (
          gen_random_uuid(),
          v_topic_id,
          v_objective_row.statement,
          v_objective_row.level,
          v_objective_row.created_at,
          p_sandbox_id
        );
      end loop;
    end loop;

    for v_topic_row in
      select *
      from public.topics
      where blueprint_id = v_seed_blueprint_id
        and sandbox_id = v_seed_sandbox_id
        and cardinality(prerequisite_topic_ids) > 0
    loop
      update public.topics
         set prerequisite_topic_ids = (
           select coalesce(array_agg((v_topic_map ->> prereq::text)::uuid), '{}'::uuid[])
           from unnest(v_topic_row.prerequisite_topic_ids) prereq
         )
       where id = (v_topic_map ->> v_topic_row.id::text)::uuid;
    end loop;
  end if;

  for v_activity_row in
    select *
    from public.activities
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by created_at asc, id asc
  loop
    v_activity_id := gen_random_uuid();
    v_activity_map := v_activity_map || jsonb_build_object(v_activity_row.id::text, v_activity_id::text);

    insert into public.activities (
      id,
      class_id,
      blueprint_id,
      topic_id,
      type,
      title,
      config,
      status,
      created_by,
      created_at,
      sandbox_id
    )
    values (
      v_activity_id,
      v_class_id,
      case
        when v_activity_row.blueprint_id is not null and v_seed_blueprint_id is not null then v_blueprint_id
        else null
      end,
      case
        when v_activity_row.topic_id is not null then (v_topic_map ->> v_activity_row.topic_id::text)::uuid
        else null
      end,
      v_activity_row.type,
      v_activity_row.title,
      v_activity_row.config,
      v_activity_row.status,
      p_guest_user_id,
      v_activity_row.created_at,
      p_sandbox_id
    );

    insert into public.quiz_questions (
      id,
      activity_id,
      question,
      choices,
      answer,
      explanation,
      order_index,
      sandbox_id
    )
    select
      gen_random_uuid(),
      v_activity_id,
      qq.question,
      qq.choices,
      qq.answer,
      qq.explanation,
      qq.order_index,
      p_sandbox_id
    from public.quiz_questions qq
    where qq.activity_id = v_activity_row.id
      and qq.sandbox_id = v_seed_sandbox_id;

    insert into public.flashcards (
      id,
      activity_id,
      front,
      back,
      order_index,
      sandbox_id
    )
    select
      gen_random_uuid(),
      v_activity_id,
      f.front,
      f.back,
      f.order_index,
      p_sandbox_id
    from public.flashcards f
    where f.activity_id = v_activity_row.id
      and f.sandbox_id = v_seed_sandbox_id;
  end loop;

  for v_assignment_row in
    select *
    from public.assignments
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by created_at asc, id asc
  loop
    v_assignment_id := gen_random_uuid();
    v_assignment_map := v_assignment_map || jsonb_build_object(v_assignment_row.id::text, v_assignment_id::text);

    insert into public.assignments (
      id,
      class_id,
      activity_id,
      assigned_by,
      due_at,
      created_at,
      sandbox_id
    )
    values (
      v_assignment_id,
      v_class_id,
      (v_activity_map ->> v_assignment_row.activity_id::text)::uuid,
      p_guest_user_id,
      v_assignment_row.due_at,
      v_assignment_row.created_at,
      p_sandbox_id
    );

    for v_recipient_row in
      select *
      from public.assignment_recipients
      where assignment_id = v_assignment_row.id
        and sandbox_id = v_seed_sandbox_id
      order by assigned_at asc, id asc
      limit 1
    loop
      v_recipient_id := gen_random_uuid();

      insert into public.assignment_recipients (
        id,
        assignment_id,
        student_id,
        status,
        assigned_at,
        sandbox_id
      )
      values (
        v_recipient_id,
        v_assignment_id,
        p_guest_user_id,
        v_recipient_row.status,
        v_recipient_row.assigned_at,
        p_sandbox_id
      );
    end loop;

    for v_submission_row in
      select *
      from public.submissions
      where assignment_id = v_assignment_row.id
        and sandbox_id = v_seed_sandbox_id
      order by submitted_at asc, id asc
    loop
      v_submission_id := gen_random_uuid();
      v_submission_map := v_submission_map || jsonb_build_object(v_submission_row.id::text, v_submission_id::text);

      insert into public.submissions (
        id,
        assignment_id,
        student_id,
        content,
        score,
        submitted_at,
        updated_at,
        sandbox_id
      )
      values (
        v_submission_id,
        v_assignment_id,
        p_guest_user_id,
        v_submission_row.content,
        v_submission_row.score,
        v_submission_row.submitted_at,
        v_submission_row.updated_at,
        p_sandbox_id
      );
    end loop;
  end loop;

  for v_feedback_row in
    select *
    from public.feedback
    where sandbox_id = v_seed_sandbox_id
    order by created_at asc, id asc
  loop
    if (v_submission_map ->> v_feedback_row.submission_id::text) is not null then
      insert into public.feedback (
        id,
        submission_id,
        created_by,
        source,
        content,
        is_edited,
        created_at,
        sandbox_id
      )
      values (
        gen_random_uuid(),
        (v_submission_map ->> v_feedback_row.submission_id::text)::uuid,
        p_guest_user_id,
        v_feedback_row.source,
        v_feedback_row.content,
        v_feedback_row.is_edited,
        v_feedback_row.created_at,
        p_sandbox_id
      );
    end if;
  end loop;

  for v_reflection_row in
    select *
    from public.reflections
    where sandbox_id = v_seed_sandbox_id
    order by created_at asc, id asc
  loop
    if (v_assignment_map ->> v_reflection_row.assignment_id::text) is not null then
      insert into public.reflections (
        id,
        assignment_id,
        student_id,
        content,
        created_at,
        sandbox_id
      )
      values (
        gen_random_uuid(),
        (v_assignment_map ->> v_reflection_row.assignment_id::text)::uuid,
        p_guest_user_id,
        v_reflection_row.content,
        v_reflection_row.created_at,
        p_sandbox_id
      );
    end if;
  end loop;

  for v_chat_session_row in
    select *
    from public.class_chat_sessions
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by created_at asc, id asc
  loop
    v_chat_session_id := gen_random_uuid();
    v_chat_session_map := v_chat_session_map || jsonb_build_object(v_chat_session_row.id::text, v_chat_session_id::text);

    insert into public.class_chat_sessions (
      id,
      class_id,
      owner_user_id,
      title,
      is_pinned,
      archived_at,
      last_message_at,
      created_at,
      updated_at,
      sandbox_id
    )
    values (
      v_chat_session_id,
      v_class_id,
      p_guest_user_id,
      v_chat_session_row.title,
      v_chat_session_row.is_pinned,
      v_chat_session_row.archived_at,
      v_chat_session_row.last_message_at,
      v_chat_session_row.created_at,
      v_chat_session_row.updated_at,
      p_sandbox_id
    );
  end loop;

  for v_chat_message_row in
    select *
    from public.class_chat_messages
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by created_at asc, id asc
  loop
    if (v_chat_session_map ->> v_chat_message_row.session_id::text) is not null then
      insert into public.class_chat_messages (
        id,
        session_id,
        class_id,
        author_user_id,
        author_kind,
        content,
        citations,
        safety,
        provider,
        model,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        latency_ms,
        created_at,
        sandbox_id
      )
      values (
        gen_random_uuid(),
        (v_chat_session_map ->> v_chat_message_row.session_id::text)::uuid,
        v_class_id,
        case
          when v_chat_message_row.author_kind = 'assistant' then null
          else p_guest_user_id
        end,
        v_chat_message_row.author_kind,
        v_chat_message_row.content,
        v_chat_message_row.citations,
        v_chat_message_row.safety,
        v_chat_message_row.provider,
        v_chat_message_row.model,
        v_chat_message_row.prompt_tokens,
        v_chat_message_row.completion_tokens,
        v_chat_message_row.total_tokens,
        v_chat_message_row.latency_ms,
        v_chat_message_row.created_at,
        p_sandbox_id
      );
    end if;
  end loop;

  for v_compaction_row in
    select *
    from public.class_chat_session_compactions
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by created_at asc, session_id asc
  loop
    if (v_chat_session_map ->> v_compaction_row.session_id::text) is not null then
      insert into public.class_chat_session_compactions (
        session_id,
        class_id,
        owner_user_id,
        summary_text,
        summary_json,
        compacted_through_created_at,
        compacted_through_message_id,
        compacted_turn_count,
        last_compacted_at,
        created_at,
        updated_at,
        sandbox_id
      )
      values (
        (v_chat_session_map ->> v_compaction_row.session_id::text)::uuid,
        v_class_id,
        p_guest_user_id,
        v_compaction_row.summary_text,
        v_compaction_row.summary_json,
        v_compaction_row.compacted_through_created_at,
        null,
        v_compaction_row.compacted_turn_count,
        v_compaction_row.last_compacted_at,
        v_compaction_row.created_at,
        v_compaction_row.updated_at,
        p_sandbox_id
      );
    end if;
  end loop;

  for v_snapshot_row in
    select *
    from public.class_insights_snapshots
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by generated_at desc, id desc
  loop
    insert into public.class_insights_snapshots (
      id,
      class_id,
      generated_at,
      payload,
      sandbox_id
    )
    values (
      gen_random_uuid(),
      v_class_id,
      v_snapshot_row.generated_at,
      v_snapshot_row.payload,
      p_sandbox_id
    )
    on conflict (class_id) do update
      set generated_at = excluded.generated_at,
          payload = excluded.payload,
          sandbox_id = excluded.sandbox_id;
  end loop;

  for v_teaching_brief_row in
    select *
    from public.class_teaching_brief_snapshots
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by generated_at desc, id desc
  loop
    insert into public.class_teaching_brief_snapshots (
      id,
      class_id,
      generated_at,
      updated_at,
      status,
      payload,
      error_message,
      sandbox_id
    )
    values (
      gen_random_uuid(),
      v_class_id,
      v_teaching_brief_row.generated_at,
      v_teaching_brief_row.updated_at,
      v_teaching_brief_row.status,
      v_teaching_brief_row.payload,
      v_teaching_brief_row.error_message,
      p_sandbox_id
    )
    on conflict (class_id) do update
      set generated_at = excluded.generated_at,
          updated_at = excluded.updated_at,
          status = excluded.status,
          payload = excluded.payload,
          error_message = excluded.error_message,
          sandbox_id = excluded.sandbox_id;
  end loop;

  for v_ai_request_row in
    select *
    from public.ai_requests
    where class_id = v_seed_class_id
      and sandbox_id = v_seed_sandbox_id
    order by created_at asc, id asc
  loop
    insert into public.ai_requests (
      id,
      class_id,
      user_id,
      provider,
      model,
      purpose,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      latency_ms,
      status,
      created_at,
      sandbox_id
    )
    values (
      gen_random_uuid(),
      v_class_id,
      p_guest_user_id,
      v_ai_request_row.provider,
      v_ai_request_row.model,
      v_ai_request_row.purpose,
      v_ai_request_row.prompt_tokens,
      v_ai_request_row.completion_tokens,
      v_ai_request_row.total_tokens,
      v_ai_request_row.latency_ms,
      v_ai_request_row.status,
      v_ai_request_row.created_at,
      p_sandbox_id
    );
  end loop;

  update public.guest_sandboxes
     set class_id = v_class_id,
         last_seen_at = now(),
         updated_at = now()
   where id = p_sandbox_id;

  return v_class_id;
end;
$$;

grant execute on function public.clone_guest_sandbox(uuid, uuid) to authenticated;

create or replace function public.cleanup_expired_guest_sandboxes()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select gs.id, gs.user_id
    from public.guest_sandboxes gs
    where gs.status = 'active'
      and (
        gs.expires_at <= now()
        or gs.last_seen_at <= now() - interval '1 hour'
      )
  loop
    update public.guest_sandboxes
       set status = 'expired',
           updated_at = now()
     where id = v_row.id;

    delete from public.classes where sandbox_id = v_row.id;
    delete from auth.users where id = v_row.user_id and coalesce(is_anonymous, false);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.allow_guest_sandbox_access(
  target_sandbox_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.matches_requesting_guest_sandbox(target_sandbox_id);
$$;

drop policy if exists classes_guest_manage on public.classes;
create policy classes_guest_manage
on public.classes
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists enrollments_guest_manage on public.enrollments;
create policy enrollments_guest_manage
on public.enrollments
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists materials_guest_manage on public.materials;
create policy materials_guest_manage
on public.materials
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists material_chunks_guest_manage on public.material_chunks;
create policy material_chunks_guest_manage
on public.material_chunks
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists blueprints_guest_manage on public.blueprints;
create policy blueprints_guest_manage
on public.blueprints
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists topics_guest_manage on public.topics;
create policy topics_guest_manage
on public.topics
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists objectives_guest_manage on public.objectives;
create policy objectives_guest_manage
on public.objectives
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists activities_guest_manage on public.activities;
create policy activities_guest_manage
on public.activities
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists assignments_guest_manage on public.assignments;
create policy assignments_guest_manage
on public.assignments
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists assignment_recipients_guest_manage on public.assignment_recipients;
create policy assignment_recipients_guest_manage
on public.assignment_recipients
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists submissions_guest_manage on public.submissions;
create policy submissions_guest_manage
on public.submissions
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists quiz_questions_guest_manage on public.quiz_questions;
create policy quiz_questions_guest_manage
on public.quiz_questions
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists flashcards_guest_manage on public.flashcards;
create policy flashcards_guest_manage
on public.flashcards
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists feedback_guest_manage on public.feedback;
create policy feedback_guest_manage
on public.feedback
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists reflections_guest_manage on public.reflections;
create policy reflections_guest_manage
on public.reflections
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists class_chat_sessions_guest_manage on public.class_chat_sessions;
create policy class_chat_sessions_guest_manage
on public.class_chat_sessions
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists class_chat_messages_guest_manage on public.class_chat_messages;
create policy class_chat_messages_guest_manage
on public.class_chat_messages
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists class_chat_compactions_guest_manage on public.class_chat_session_compactions;
create policy class_chat_compactions_guest_manage
on public.class_chat_session_compactions
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists class_insights_snapshots_guest_select on public.class_insights_snapshots;
create policy class_insights_snapshots_guest_select
on public.class_insights_snapshots
for select
using (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists class_teaching_brief_snapshots_guest_select on public.class_teaching_brief_snapshots;
create policy class_teaching_brief_snapshots_guest_select
on public.class_teaching_brief_snapshots
for select
using (public.allow_guest_sandbox_access(sandbox_id));

drop policy if exists ai_requests_guest_manage on public.ai_requests;
create policy ai_requests_guest_manage
on public.ai_requests
for all
using (public.allow_guest_sandbox_access(sandbox_id))
with check (public.allow_guest_sandbox_access(sandbox_id));
