-- Inspect the canonical guest sandbox template
  -- Safe: read-only SELECTs only

  -- 1) High-level row counts across all template-backed tables
  with seed as (
    select '00000000-0000-0000-0000-000000000000'::uuid as sandbox_id
  )
  select *
  from (
    select 'classes' as table_name, count(*)::bigint as row_count
    from public.classes
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'enrollments', count(*)::bigint
    from public.enrollments
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'materials', count(*)::bigint
    from public.materials
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'material_chunks', count(*)::bigint
    from public.material_chunks
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'blueprints', count(*)::bigint
    from public.blueprints
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'topics', count(*)::bigint
    from public.topics
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'objectives', count(*)::bigint
    from public.objectives
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'activities', count(*)::bigint
    from public.activities
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'quiz_questions', count(*)::bigint
    from public.quiz_questions
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'flashcards', count(*)::bigint
    from public.flashcards
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'assignments', count(*)::bigint
    from public.assignments
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'assignment_recipients', count(*)::bigint
    from public.assignment_recipients
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'submissions', count(*)::bigint
    from public.submissions
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'feedback', count(*)::bigint
    from public.feedback
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'reflections', count(*)::bigint
    from public.reflections
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'class_chat_sessions', count(*)::bigint
    from public.class_chat_sessions
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'class_chat_messages', count(*)::bigint
    from public.class_chat_messages
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'class_chat_session_compactions', count(*)::bigint
    from public.class_chat_session_compactions
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'class_insights_snapshots', count(*)::bigint
    from public.class_insights_snapshots
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'class_teaching_brief_snapshots', count(*)::bigint
    from public.class_teaching_brief_snapshots
    where sandbox_id = (select sandbox_id from seed)

    union all
    select 'ai_requests', count(*)::bigint
    from public.ai_requests
    where sandbox_id = (select sandbox_id from seed)
  ) t
  order by table_name;


  -- 2) Template class + owner summary
  select
    c.id as class_id,
    c.title,
    c.description,
    c.subject,
    c.level,
    c.join_code,
    c.ai_provider,
    c.owner_id,
    p.display_name as owner_name,
    p.account_type as owner_account_type,
    c.created_at,
    c.updated_at,
    c.sandbox_id
  from public.classes c
  left join public.profiles p
    on p.id = c.owner_id
  where c.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by c.created_at asc;


  -- 3) Enrollments in the template class
  select
    e.id,
    e.class_id,
    e.user_id,
    p.display_name,
    p.account_type,
    e.role,
    e.joined_at,
    e.sandbox_id
  from public.enrollments e
  left join public.profiles p
    on p.id = e.user_id
  where e.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by e.joined_at asc;


  -- 4) Blueprint summary + pretty-printed blueprint JSON
  select
    b.id as blueprint_id,
    b.class_id,
    b.version,
    b.status,
    b.summary,
    b.created_by,
    b.approved_by,
    b.published_by,
    b.created_at,
    b.approved_at,
    b.published_at,
    b.content_schema_version,
    jsonb_pretty(b.content_json) as content_json_pretty
  from public.blueprints b
  where b.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by b.created_at desc;


  -- 5) Topics + objectives structure
  select
    t.id as topic_id,
    t.blueprint_id,
    t.sequence,
    t.section,
    t.title,
    t.description,
    t.prerequisite_topic_ids,
    o.id as objective_id,
    o.statement as objective_statement,
    o.level as objective_level
  from public.topics t
  left join public.objectives o
    on o.topic_id = t.id
  where t.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by t.sequence asc, o.created_at asc nulls last, o.id asc;


  -- 6) Activities with attached quiz/flashcard counts
  select
    a.id as activity_id,
    a.class_id,
    a.blueprint_id,
    a.topic_id,
    a.type,
    a.title,
    a.status,
    a.created_by,
    a.created_at,
    a.config,
    coalesce(qq.question_count, 0) as quiz_question_count,
    coalesce(fc.flashcard_count, 0) as flashcard_count
  from public.activities a
  left join (
    select activity_id, count(*)::int as question_count
    from public.quiz_questions
    where sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
    group by activity_id
  ) qq
    on qq.activity_id = a.id
  left join (
    select activity_id, count(*)::int as flashcard_count
    from public.flashcards
    where sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
    group by activity_id
  ) fc
    on fc.activity_id = a.id
  where a.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by a.created_at asc, a.id asc;


  -- 7) Materials and chunk previews
  select
    m.id as material_id,
    m.class_id,
    m.title,
    m.storage_path,
    m.mime_type,
    m.size_bytes,
    m.status,
    left(m.extracted_text, 300) as extracted_text_preview,
    m.metadata,
    m.created_at
  from public.materials m
  where m.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by m.created_at asc;

  select
    mc.id as chunk_id,
    mc.material_id,
    mc.source_type,
    mc.source_index,
    mc.section_title,
    mc.token_count,
    mc.embedding_provider,
    mc.embedding_model,
    mc.quality_score,
    left(mc.text, 220) as text_preview,
    mc.created_at
  from public.material_chunks mc
  where mc.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by mc.material_id, mc.source_index, mc.created_at;


  -- 8) Assignments, recipients, submissions, and feedback
  select
    a.id as assignment_id,
    a.class_id,
    a.activity_id,
    act.title as activity_title,
    a.assigned_by,
    p.display_name as assigned_by_name,
    a.due_at,
    a.created_at
  from public.assignments a
  left join public.activities act
    on act.id = a.activity_id
  left join public.profiles p
    on p.id = a.assigned_by
  where a.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by a.created_at asc;

  select
    ar.id as recipient_id,
    ar.assignment_id,
    ar.student_id,
    p.display_name as student_name,
    ar.status,
    ar.assigned_at
  from public.assignment_recipients ar
  left join public.profiles p
    on p.id = ar.student_id
  where ar.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by ar.assigned_at asc;

  select
    s.id as submission_id,
    s.assignment_id,
    s.student_id,
    p.display_name as student_name,
    s.score,
    s.submitted_at,
    s.updated_at,
    jsonb_pretty(s.content) as content_pretty
  from public.submissions s
  left join public.profiles p
    on p.id = s.student_id
  where s.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by s.submitted_at asc;

  select
    f.id as feedback_id,
    f.submission_id,
    f.created_by,
    p.display_name as created_by_name,
    f.source,
    f.is_edited,
    f.created_at,
    jsonb_pretty(f.content) as content_pretty
  from public.feedback f
  left join public.profiles p
    on p.id = f.created_by
  where f.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by f.created_at asc;


  -- 9) Chat seed content
  select
    cs.id as session_id,
    cs.class_id,
    cs.owner_user_id,
    p.display_name as owner_name,
    cs.title,
    cs.is_pinned,
    cs.last_message_at,
    cs.created_at,
    cs.updated_at
  from public.class_chat_sessions cs
  left join public.profiles p
    on p.id = cs.owner_user_id
  where cs.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by cs.created_at asc;

  select
    cm.id as message_id,
    cm.session_id,
    cm.author_kind,
    cm.author_user_id,
    p.display_name as author_name,
    left(cm.content, 250) as content_preview,
    cm.provider,
    cm.model,
    cm.prompt_tokens,
    cm.completion_tokens,
    cm.total_tokens,
    cm.latency_ms,
    cm.created_at
  from public.class_chat_messages cm
  left join public.profiles p
    on p.id = cm.author_user_id
  where cm.sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by cm.created_at asc;


  -- 10) Pretty-print teacher-facing snapshot payloads
  select
    id,
    class_id,
    generated_at,
    jsonb_pretty(payload) as insights_payload_pretty
  from public.class_insights_snapshots
  where sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by generated_at desc;

  select
    id,
    class_id,
    generated_at,
    updated_at,
    status,
    error_message,
    jsonb_pretty(payload) as teaching_brief_payload_pretty
  from public.class_teaching_brief_snapshots
  where sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by generated_at desc;


  -- 11) AI request history included in the template
  select
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
    created_at
  from public.ai_requests
  where sandbox_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by created_at asc;
