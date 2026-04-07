-- Ensure anonymous guest users satisfy enrollment account-type enforcement
-- before clone_guest_sandbox creates their sandbox enrollment row.

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

  insert into public.profiles (
    id,
    account_type,
    created_at
  )
  values (
    p_guest_user_id,
    'student',
    now()
  )
  on conflict (id) do nothing;

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

