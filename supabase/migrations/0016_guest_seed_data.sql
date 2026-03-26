-- Canonical guest-mode seed data.
-- All rows in this migration use the well-known seed sandbox id and synthetic content only.

do $$
declare
  v_seed_sandbox_id constant uuid := '00000000-0000-0000-0000-000000000000';
  v_seed_teacher_id constant uuid := '00000000-0000-0000-0000-000000000111';
  v_seed_student_id constant uuid := '00000000-0000-0000-0000-000000000112';
  v_seed_class_id constant uuid := '00000000-0000-0000-0000-000000000211';
  v_seed_material_id constant uuid := '00000000-0000-0000-0000-000000000311';
  v_seed_blueprint_id constant uuid := '00000000-0000-0000-0000-000000000411';
  v_topic_velocity_id constant uuid := '00000000-0000-0000-0000-000000000511';
  v_topic_forces_id constant uuid := '00000000-0000-0000-0000-000000000512';
  v_objective_1_id constant uuid := '00000000-0000-0000-0000-000000000611';
  v_objective_2_id constant uuid := '00000000-0000-0000-0000-000000000612';
  v_objective_3_id constant uuid := '00000000-0000-0000-0000-000000000613';
  v_objective_4_id constant uuid := '00000000-0000-0000-0000-000000000614';
  v_quiz_activity_id constant uuid := '00000000-0000-0000-0000-000000000711';
  v_chat_activity_id constant uuid := '00000000-0000-0000-0000-000000000712';
  v_flashcards_activity_id constant uuid := '00000000-0000-0000-0000-000000000713';
  v_quiz_assignment_id constant uuid := '00000000-0000-0000-0000-000000000811';
  v_chat_assignment_id constant uuid := '00000000-0000-0000-0000-000000000812';
  v_flashcards_assignment_id constant uuid := '00000000-0000-0000-0000-000000000813';
  v_quiz_recipient_id constant uuid := '00000000-0000-0000-0000-000000000911';
  v_chat_recipient_id constant uuid := '00000000-0000-0000-0000-000000000912';
  v_flashcards_recipient_id constant uuid := '00000000-0000-0000-0000-000000000913';
  v_quiz_submission_id constant uuid := '00000000-0000-0000-0000-000000001011';
  v_chat_submission_id constant uuid := '00000000-0000-0000-0000-000000001012';
  v_flashcards_submission_id constant uuid := '00000000-0000-0000-0000-000000001013';
  v_quiz_feedback_id constant uuid := '00000000-0000-0000-0000-000000001111';
  v_chat_feedback_id constant uuid := '00000000-0000-0000-0000-000000001112';
  v_reflection_id constant uuid := '00000000-0000-0000-0000-000000001211';
  v_chat_session_id constant uuid := '00000000-0000-0000-0000-000000001311';
  v_chat_message_1_id constant uuid := '00000000-0000-0000-0000-000000001411';
  v_chat_message_2_id constant uuid := '00000000-0000-0000-0000-000000001412';
  v_chat_message_3_id constant uuid := '00000000-0000-0000-0000-000000001413';
  v_chat_message_4_id constant uuid := '00000000-0000-0000-0000-000000001414';
  v_insights_snapshot_id constant uuid := '00000000-0000-0000-0000-000000001511';
  v_teaching_brief_snapshot_id constant uuid := '00000000-0000-0000-0000-000000001611';
  v_ai_request_1_id constant uuid := '00000000-0000-0000-0000-000000001711';
  v_ai_request_2_id constant uuid := '00000000-0000-0000-0000-000000001712';
  v_zero_vector text;
begin
  v_zero_vector := '[' || array_to_string(array_fill('0.001'::text, array[1536]), ',') || ']';

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token,
    is_sso_user,
    is_anonymous
  )
  values
    (
      '00000000-0000-0000-0000-000000000000',
      v_seed_teacher_id,
      'authenticated',
      'authenticated',
      'guest-seed-teacher@example.com',
      crypt('GuestSeedTeacher1', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"account_type":"teacher","display_name":"Dr. Rowan Hale"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      v_seed_student_id,
      'authenticated',
      'authenticated',
      'guest-seed-student@example.com',
      crypt('GuestSeedStudent1', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"account_type":"student","display_name":"Maya Chen"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    )
  on conflict (id) do update
    set raw_user_meta_data = excluded.raw_user_meta_data,
        raw_app_meta_data = excluded.raw_app_meta_data,
        updated_at = excluded.updated_at;

  insert into public.profiles (id, display_name, account_type)
  values
    (v_seed_teacher_id, 'Dr. Rowan Hale', 'teacher'),
    (v_seed_student_id, 'Maya Chen', 'student')
  on conflict (id) do update
    set display_name = excluded.display_name;

  delete from public.ai_requests where sandbox_id = v_seed_sandbox_id;
  delete from public.classes where sandbox_id = v_seed_sandbox_id;

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
  values (
    v_seed_class_id,
    v_seed_teacher_id,
    'Physics of Motion Studio',
    'A synthetic guest-mode class focused on kinematics, force models, and evidence-based explanations.',
    'Physics',
    'High school / early college',
    'GUESTPHY',
    'openrouter',
    false,
    v_seed_sandbox_id
  );

  insert into public.enrollments (
    id,
    class_id,
    user_id,
    role,
    sandbox_id
  )
  values (
    gen_random_uuid(),
    v_seed_class_id,
    v_seed_student_id,
    'student',
    v_seed_sandbox_id
  );

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
    sandbox_id
  )
  values (
    v_seed_material_id,
    v_seed_class_id,
    v_seed_teacher_id,
    'Motion Lab Reader',
    'guest-seed/motion-lab-reader.pdf',
    'application/pdf',
    245760,
    'ready',
    'Section 1 introduces position, displacement, speed, and velocity using a motion cart investigation. Section 2 compares balanced and unbalanced forces. Section 3 asks students to defend claims about motion with evidence from graphs and free-body diagrams.',
    jsonb_build_object(
      'original_name', 'motion-lab-reader.pdf',
      'kind', 'pdf',
      'warnings', jsonb_build_array(),
      'page_count', 12
    ),
    v_seed_sandbox_id
  );

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
    sandbox_id
  )
  values
    (
      '00000000-0000-0000-0000-000000001901',
      v_seed_material_id,
      v_seed_class_id,
      'page',
      1,
      'Describing velocity',
      'Velocity combines speed and direction. Students compare position-time and velocity-time graphs to explain when motion is constant, accelerating, or changing direction.',
      28,
      v_zero_vector::vector,
      'openai',
      'text-embedding-3-small',
      'synthetic-seed',
      0.98,
      '{}'::jsonb,
      v_seed_sandbox_id
    ),
    (
      '00000000-0000-0000-0000-000000001902',
      v_seed_material_id,
      v_seed_class_id,
      'page',
      2,
      'Forces and motion',
      'Balanced forces do not change velocity, while unbalanced forces produce acceleration. Students use force diagrams to predict how a cart will move after different pushes.',
      27,
      v_zero_vector::vector,
      'openai',
      'text-embedding-3-small',
      'synthetic-seed',
      0.97,
      '{}'::jsonb,
      v_seed_sandbox_id
    ),
    (
      '00000000-0000-0000-0000-000000001903',
      v_seed_material_id,
      v_seed_class_id,
      'page',
      3,
      'Scientific explanation',
      'Students support claims with graph evidence, numerical comparisons, and force reasoning. Strong explanations connect the observed pattern to the underlying cause of motion.',
      25,
      v_zero_vector::vector,
      'openai',
      'text-embedding-3-small',
      'synthetic-seed',
      0.97,
      '{}'::jsonb,
      v_seed_sandbox_id
    );

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
  values (
    v_seed_blueprint_id,
    v_seed_class_id,
    1,
    'published',
    'A concise motion unit that moves from describing velocity to explaining changes in motion with force models and evidence.',
    v_seed_teacher_id,
    v_seed_teacher_id,
    v_seed_teacher_id,
    now() - interval '12 days',
    now() - interval '11 days',
    now() - interval '10 days',
    jsonb_build_object(
      'schemaVersion', 'v2',
      'summary', 'A concise motion unit that moves from describing velocity to explaining changes in motion with force models and evidence.',
      'topics', jsonb_build_array(
        jsonb_build_object(
          'key', 'describe-velocity',
          'sequence', 1,
          'title', 'Describe velocity with multiple representations',
          'description', 'Interpret motion through graphs, position data, and directional language.',
          'section', 'Kinematics foundations',
          'prerequisites', jsonb_build_array(),
          'objectives', jsonb_build_array(
            jsonb_build_object('statement', 'Interpret position-time and velocity-time graphs.', 'level', 'understand'),
            jsonb_build_object('statement', 'Explain the difference between speed and velocity with evidence.', 'level', 'apply')
          ),
          'assessmentIdeas', jsonb_build_array(
            'Graph interpretation warm-up',
            'Short claim-evidence paragraph about a cart run'
          )
        ),
        jsonb_build_object(
          'key', 'connect-forces-and-motion',
          'sequence', 2,
          'title', 'Connect forces to changes in motion',
          'description', 'Use force diagrams and observations to explain acceleration.',
          'section', 'Force reasoning',
          'prerequisites', jsonb_build_array('describe-velocity'),
          'objectives', jsonb_build_array(
            jsonb_build_object('statement', 'Predict motion changes from balanced and unbalanced forces.', 'level', 'apply'),
            jsonb_build_object('statement', 'Justify a motion claim using graph and force evidence.', 'level', 'analyze')
          ),
          'assessmentIdeas', jsonb_build_array(
            'Force diagram exit ticket',
            'Structured explanation comparing two motion scenarios'
          )
        )
      )
    ),
    'v2',
    v_seed_sandbox_id
  );

  insert into public.topics (
    id,
    blueprint_id,
    title,
    description,
    section,
    sequence,
    prerequisite_topic_ids,
    sandbox_id
  )
  values
    (
      v_topic_velocity_id,
      v_seed_blueprint_id,
      'Describe velocity with multiple representations',
      'Interpret motion through graphs, position data, and directional language.',
      'Kinematics foundations',
      1,
      '{}'::uuid[],
      v_seed_sandbox_id
    ),
    (
      v_topic_forces_id,
      v_seed_blueprint_id,
      'Connect forces to changes in motion',
      'Use force diagrams and observations to explain acceleration.',
      'Force reasoning',
      2,
      array[v_topic_velocity_id]::uuid[],
      v_seed_sandbox_id
    );

  insert into public.objectives (
    id,
    topic_id,
    statement,
    level,
    sandbox_id
  )
  values
    (v_objective_1_id, v_topic_velocity_id, 'Interpret position-time and velocity-time graphs.', 'understand', v_seed_sandbox_id),
    (v_objective_2_id, v_topic_velocity_id, 'Explain the difference between speed and velocity with evidence.', 'apply', v_seed_sandbox_id),
    (v_objective_3_id, v_topic_forces_id, 'Predict motion changes from balanced and unbalanced forces.', 'apply', v_seed_sandbox_id),
    (v_objective_4_id, v_topic_forces_id, 'Justify a motion claim using graph and force evidence.', 'analyze', v_seed_sandbox_id);

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
  values
    (
      v_quiz_activity_id,
      v_seed_class_id,
      v_seed_blueprint_id,
      v_topic_velocity_id,
      'quiz',
      'Velocity Checks',
      jsonb_build_object(
        'mode', 'assignment',
        'questionCount', 3,
        'attemptLimit', 2,
        'scoringPolicy', 'best_of_attempts',
        'revealPolicy', 'after_final_attempt',
        'instructions', 'Answer each item using the graph evidence from the motion lab.'
      ),
      'published',
      v_seed_teacher_id,
      now() - interval '9 days',
      v_seed_sandbox_id
    ),
    (
      v_chat_activity_id,
      v_seed_class_id,
      v_seed_blueprint_id,
      v_topic_forces_id,
      'chat',
      'Explain the Push',
      jsonb_build_object(
        'mode', 'assignment',
        'instructions', 'Use the class blueprint and lab notes to explain why the cart changed motion.'
      ),
      'published',
      v_seed_teacher_id,
      now() - interval '8 days',
      v_seed_sandbox_id
    ),
    (
      v_flashcards_activity_id,
      v_seed_class_id,
      v_seed_blueprint_id,
      v_topic_forces_id,
      'flashcards',
      'Force and Motion Review',
      jsonb_build_object(
        'mode', 'assignment',
        'cardCount', 4,
        'attemptLimit', 1,
        'instructions', 'Review key concepts before the lab debrief.'
      ),
      'published',
      v_seed_teacher_id,
      now() - interval '7 days',
      v_seed_sandbox_id
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
  values
    (
      '00000000-0000-0000-0000-000000002011',
      v_quiz_activity_id,
      'A cart moves to the right at a constant speed. Which statement best describes its velocity?',
      jsonb_build_array('Increasing and changing direction', 'Constant and directed to the right', 'Zero because the speed is unchanged', 'Changing because the cart is moving'),
      'Constant and directed to the right',
      'Velocity includes both speed and direction, so a constant-speed motion to the right means a constant rightward velocity.',
      0,
      v_seed_sandbox_id
    ),
    (
      '00000000-0000-0000-0000-000000002012',
      v_quiz_activity_id,
      'Which graph feature shows the cart is speeding up?',
      jsonb_build_array('A flat position-time line', 'A steeper position-time slope over time', 'A horizontal velocity-time line at zero', 'A decreasing time interval'),
      'A steeper position-time slope over time',
      'A steeper slope means more distance covered per unit time, which indicates a larger speed.',
      1,
      v_seed_sandbox_id
    ),
    (
      '00000000-0000-0000-0000-000000002013',
      v_quiz_activity_id,
      'Why is speed alone not enough to describe velocity?',
      jsonb_build_array('Velocity uses different units', 'Velocity also includes direction', 'Velocity only applies to graphs', 'Velocity is always larger than speed'),
      'Velocity also includes direction',
      'Two objects can have the same speed but different velocities if they move in different directions.',
      2,
      v_seed_sandbox_id
    );

  insert into public.flashcards (
    id,
    activity_id,
    front,
    back,
    order_index,
    sandbox_id
  )
  values
    ('00000000-0000-0000-0000-000000002111', v_flashcards_activity_id, 'Balanced forces', 'Forces that cancel so velocity does not change.', 0, v_seed_sandbox_id),
    ('00000000-0000-0000-0000-000000002112', v_flashcards_activity_id, 'Unbalanced forces', 'Forces that produce acceleration and change motion.', 1, v_seed_sandbox_id),
    ('00000000-0000-0000-0000-000000002113', v_flashcards_activity_id, 'Velocity', 'Speed with direction.', 2, v_seed_sandbox_id),
    ('00000000-0000-0000-0000-000000002114', v_flashcards_activity_id, 'Evidence-based explanation', 'A claim supported by graph data, calculations, and force reasoning.', 3, v_seed_sandbox_id);

  insert into public.assignments (
    id,
    class_id,
    activity_id,
    assigned_by,
    due_at,
    created_at,
    sandbox_id
  )
  values
    (v_quiz_assignment_id, v_seed_class_id, v_quiz_activity_id, v_seed_teacher_id, now() + interval '5 days', now() - interval '6 days', v_seed_sandbox_id),
    (v_chat_assignment_id, v_seed_class_id, v_chat_activity_id, v_seed_teacher_id, now() + interval '4 days', now() - interval '5 days', v_seed_sandbox_id),
    (v_flashcards_assignment_id, v_seed_class_id, v_flashcards_activity_id, v_seed_teacher_id, now() + interval '3 days', now() - interval '4 days', v_seed_sandbox_id);

  insert into public.assignment_recipients (
    id,
    assignment_id,
    student_id,
    status,
    assigned_at,
    sandbox_id
  )
  values
    (v_quiz_recipient_id, v_quiz_assignment_id, v_seed_student_id, 'submitted', now() - interval '6 days', v_seed_sandbox_id),
    (v_chat_recipient_id, v_chat_assignment_id, v_seed_student_id, 'reviewed', now() - interval '5 days', v_seed_sandbox_id),
    (v_flashcards_recipient_id, v_flashcards_assignment_id, v_seed_student_id, 'submitted', now() - interval '4 days', v_seed_sandbox_id);

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
  values
    (
      v_quiz_submission_id,
      v_quiz_assignment_id,
      v_seed_student_id,
      jsonb_build_object(
        'mode', 'quiz_attempt',
        'activityId', v_quiz_activity_id::text,
        'attemptNumber', 1,
        'answers', jsonb_build_array(
          jsonb_build_object('questionId', '00000000-0000-0000-0000-000000002011', 'selectedChoice', 'Constant and directed to the right'),
          jsonb_build_object('questionId', '00000000-0000-0000-0000-000000002012', 'selectedChoice', 'A steeper position-time slope over time'),
          jsonb_build_object('questionId', '00000000-0000-0000-0000-000000002013', 'selectedChoice', 'Velocity also includes direction')
        ),
        'scoreRaw', 3,
        'scorePercent', 100,
        'maxPoints', 3,
        'submittedAt', (now() - interval '6 days')::text
      ),
      100,
      now() - interval '6 days',
      now() - interval '6 days',
      v_seed_sandbox_id
    ),
    (
      v_chat_submission_id,
      v_chat_assignment_id,
      v_seed_student_id,
      jsonb_build_object(
        'mode', 'chat_assignment',
        'activityId', v_chat_activity_id::text,
        'transcript', jsonb_build_array(
          jsonb_build_object('role', 'student', 'message', 'The cart sped up after the push.', 'createdAt', (now() - interval '5 days')::text),
          jsonb_build_object('role', 'assistant', 'message', 'What evidence from the graph supports that claim?', 'createdAt', (now() - interval '5 days' + interval '1 minute')::text),
          jsonb_build_object('role', 'student', 'message', 'The slope became steeper and the velocity bars got larger.', 'createdAt', (now() - interval '5 days' + interval '2 minutes')::text)
        ),
        'reflection', 'I can connect the graph pattern to the unbalanced force now.',
        'completedAt', (now() - interval '5 days')::text
      ),
      92,
      now() - interval '5 days',
      now() - interval '5 days',
      v_seed_sandbox_id
    ),
    (
      v_flashcards_submission_id,
      v_flashcards_assignment_id,
      v_seed_student_id,
      jsonb_build_object(
        'mode', 'flashcards_session',
        'activityId', v_flashcards_activity_id::text,
        'sessionNumber', 1,
        'cardsReviewed', 4,
        'knownCount', 3,
        'reviewCount', 1,
        'scorePercent', 75,
        'submittedAt', (now() - interval '4 days')::text
      ),
      75,
      now() - interval '4 days',
      now() - interval '4 days',
      v_seed_sandbox_id
    );

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
  values
    (
      v_quiz_feedback_id,
      v_quiz_submission_id,
      v_seed_teacher_id,
      'teacher',
      jsonb_build_object(
        'summary', 'Excellent precision on graph evidence.',
        'strengths', jsonb_build_array('Correctly distinguished speed and velocity.'),
        'next_steps', jsonb_build_array('Try explaining the same idea with a free-body diagram.')
      ),
      false,
      now() - interval '5 days',
      v_seed_sandbox_id
    ),
    (
      v_chat_feedback_id,
      v_chat_submission_id,
      v_seed_teacher_id,
      'ai',
      jsonb_build_object(
        'summary', 'Clear reasoning with room to cite force direction more explicitly.',
        'strengths', jsonb_build_array('Used both graph and language evidence.'),
        'next_steps', jsonb_build_array('Name the force causing the acceleration in one sentence.')
      ),
      false,
      now() - interval '4 days',
      v_seed_sandbox_id
    );

  insert into public.reflections (
    id,
    assignment_id,
    student_id,
    content,
    created_at,
    sandbox_id
  )
  values (
    v_reflection_id,
    v_chat_assignment_id,
    v_seed_student_id,
    'I used to think faster always meant more force, but now I can separate constant velocity from acceleration.',
    now() - interval '4 days',
    v_seed_sandbox_id
  );

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
    v_seed_class_id,
    v_seed_student_id,
    'Open practice: motion graphs',
    true,
    null,
    now() - interval '2 days',
    now() - interval '2 days',
    now() - interval '2 days',
    v_seed_sandbox_id
  );

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
  values
    (
      v_chat_message_1_id,
      v_chat_session_id,
      v_seed_class_id,
      v_seed_student_id,
      'student',
      'How can I tell from the graph when the cart is accelerating?',
      '[]'::jsonb,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      now() - interval '2 days',
      v_seed_sandbox_id
    ),
    (
      v_chat_message_2_id,
      v_chat_session_id,
      v_seed_class_id,
      null,
      'assistant',
      'Look for a changing slope or changing velocity values over time. Those patterns show the velocity is not constant.',
      jsonb_build_array(
        jsonb_build_object('sourceLabel', 'Motion Lab Reader', 'snippet', 'Velocity-time graphs show acceleration when the plotted values change.')
      ),
      'ok',
      'openrouter',
      'gpt-5-mini',
      140,
      96,
      236,
      1240,
      now() - interval '2 days' + interval '1 minute',
      v_seed_sandbox_id
    ),
    (
      v_chat_message_3_id,
      v_chat_session_id,
      v_seed_class_id,
      v_seed_student_id,
      'student',
      'So a flat line on a velocity graph means no acceleration, right?',
      '[]'::jsonb,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      now() - interval '2 days' + interval '2 minutes',
      v_seed_sandbox_id
    ),
    (
      v_chat_message_4_id,
      v_chat_session_id,
      v_seed_class_id,
      null,
      'assistant',
      'Yes. A flat velocity-time line means the velocity stays constant, so acceleration is zero during that interval.',
      jsonb_build_array(
        jsonb_build_object('sourceLabel', 'Motion Lab Reader', 'snippet', 'Balanced forces do not change velocity.')
      ),
      'ok',
      'openrouter',
      'gpt-5-mini',
      118,
      83,
      201,
      1175,
      now() - interval '2 days' + interval '3 minutes',
      v_seed_sandbox_id
    );

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
    v_chat_session_id,
    v_seed_class_id,
    v_seed_student_id,
    'Student can identify acceleration from changing graph features and is now checking when flat velocity implies zero acceleration.',
    jsonb_build_object(
      'version', 'v1',
      'generatedAt', (now() - interval '2 days' + interval '5 minutes')::text,
      'compactedThrough', jsonb_build_object(
        'createdAt', (now() - interval '2 days' + interval '3 minutes')::text,
        'messageId', v_chat_message_4_id::text,
        'turnCount', 4
      ),
      'keyTerms', jsonb_build_array(
        jsonb_build_object('term', 'acceleration', 'weight', 0.9, 'occurrences', 3, 'lastSeen', (now() - interval '2 days' + interval '3 minutes')::text)
      ),
      'resolvedFacts', jsonb_build_array('A flat velocity-time line means zero acceleration.'),
      'openQuestions', jsonb_build_array('How to distinguish negative acceleration from positive acceleration?'),
      'studentNeeds', jsonb_build_array('More practice translating between graph patterns and force language.'),
      'timeline', jsonb_build_object(
        'from', (now() - interval '2 days')::text,
        'to', (now() - interval '2 days' + interval '3 minutes')::text,
        'highlights', jsonb_build_array('Clarified when velocity is constant.')
      )
    ),
    now() - interval '2 days' + interval '3 minutes',
    v_chat_message_4_id,
    4,
    now() - interval '2 days' + interval '5 minutes',
    now() - interval '2 days' + interval '5 minutes',
    now() - interval '2 days' + interval '5 minutes',
    v_seed_sandbox_id
  );

  insert into public.class_insights_snapshots (
    id,
    class_id,
    generated_at,
    payload,
    sandbox_id
  )
  values (
    v_insights_snapshot_id,
    v_seed_class_id,
    now() - interval '1 day',
    jsonb_build_object(
      'generated_at', (now() - interval '1 day')::text,
      'class_summary', jsonb_build_object(
        'student_count', 1,
        'avg_score', 89,
        'completion_rate', 100,
        'at_risk_count', 0,
        'avg_chat_messages', 2,
        'is_empty', false
      ),
      'topics', jsonb_build_array(
        jsonb_build_object(
          'topic_id', v_topic_velocity_id::text,
          'title', 'Describe velocity with multiple representations',
          'bloom_levels', jsonb_build_array('understand', 'apply'),
          'avg_score', 100,
          'attempt_count', 1,
          'status', 'good'
        ),
        jsonb_build_object(
          'topic_id', v_topic_forces_id::text,
          'title', 'Connect forces to changes in motion',
          'bloom_levels', jsonb_build_array('apply', 'analyze'),
          'avg_score', 84,
          'attempt_count', 2,
          'status', 'warning'
        )
      ),
      'students', jsonb_build_array(
        jsonb_build_object(
          'student_id', v_seed_student_id::text,
          'display_name', 'Maya C.',
          'avg_score', 89,
          'completion_rate', 100,
          'chat_message_count', 2,
          'risk_level', 'low',
          'activity_breakdown', jsonb_build_array(
            jsonb_build_object('activity_id', v_quiz_activity_id::text, 'title', 'Velocity Checks', 'score', 100, 'attempts', 1),
            jsonb_build_object('activity_id', v_flashcards_activity_id::text, 'title', 'Force and Motion Review', 'score', 75, 'attempts', 1)
          ),
          'ai_mini_summary', 'Strong on graph interpretation and improving force-language precision.'
        )
      ),
      'ai_narrative', jsonb_build_object(
        'executive_summary', 'Students are confidently reading motion graphs and are ready for one more push on force explanations.',
        'key_findings', jsonb_build_array(
          'Velocity representations are secure.',
          'Force-language explanations still need explicit cause-and-effect phrasing.'
        ),
        'interventions', jsonb_build_array(
          jsonb_build_object(
            'type', 'generate_quiz',
            'topic_id', v_topic_forces_id::text,
            'topic_title', 'Connect forces to changes in motion',
            'reason', 'Students benefit from one additional targeted explanation check.',
            'suggested_action', 'Assign a short quiz focused on balanced versus unbalanced force scenarios.'
          )
        )
      )
    ),
    v_seed_sandbox_id
  )
  on conflict (class_id) do update
    set generated_at = excluded.generated_at,
        payload = excluded.payload,
        sandbox_id = excluded.sandbox_id;

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
    v_teaching_brief_snapshot_id,
    v_seed_class_id,
    now() - interval '12 hours',
    now() - interval '12 hours',
    'ready',
    jsonb_build_object(
      'summary', 'Students can read motion graphs confidently and are close to articulating force-driven explanations independently.',
      'strongest_action', 'Follow the current sequence with one more evidence-rich force explanation task before moving on.',
      'attention_items', jsonb_build_array(
        'Push students to name the force causing the change in motion.',
        'Ask for one sentence that connects the graph feature to the physical cause.'
      ),
      'misconceptions', jsonb_build_array(
        jsonb_build_object(
          'topic_id', v_topic_forces_id::text,
          'topic_title', 'Connect forces to changes in motion',
          'description', 'Students may describe acceleration correctly without naming the unbalanced force behind it.'
        )
      ),
      'students_to_watch', jsonb_build_array(
        jsonb_build_object(
          'student_id', v_seed_student_id::text,
          'display_name', 'Maya C.',
          'reason', 'Doing well overall, but still benefits from more explicit force-language practice.'
        )
      ),
      'next_step', 'Run a quick verbal rehearsal where students justify motion changes from a force diagram and graph together.',
      'recommended_activity', jsonb_build_object(
        'type', 'quiz',
        'reason', 'A short quiz can confirm whether students can connect force cause to motion effect without teacher prompting.'
      ),
      'evidence_basis', 'Built from one quiz attempt, one flashcards session, and recent always-on chat exchanges.'
    ),
    null,
    v_seed_sandbox_id
  )
  on conflict (class_id) do update
    set generated_at = excluded.generated_at,
        updated_at = excluded.updated_at,
        status = excluded.status,
        payload = excluded.payload,
        error_message = excluded.error_message,
        sandbox_id = excluded.sandbox_id;

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
  values
    (
      v_ai_request_1_id,
      v_seed_class_id,
      v_seed_teacher_id,
      'openrouter',
      'gpt-5-mini',
      'blueprint_generation_v2',
      1820,
      946,
      2766,
      18250,
      'success',
      now() - interval '10 days',
      v_seed_sandbox_id
    ),
    (
      v_ai_request_2_id,
      v_seed_class_id,
      v_seed_student_id,
      'openrouter',
      'gpt-5-mini',
      'student_chat_always_on_v1',
      140,
      96,
      236,
      1240,
      'success',
      now() - interval '2 days',
      v_seed_sandbox_id
    );
end;
$$;
