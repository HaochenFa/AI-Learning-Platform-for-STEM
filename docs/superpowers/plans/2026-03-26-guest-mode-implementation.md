# Guest Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class guest mode that starts from the homepage, provisions a sandboxed sample classroom via Supabase Anonymous Auth, supports teacher/student role switching, allows live feature use inside the sandbox, and discards guest work on signup.

**Architecture:** Guest sessions use Supabase Anonymous Auth (`signInAnonymously()`) to create real `auth.users` rows. A `guest_sandboxes` table tracks each sandbox. On guest entry, a PL/pgSQL clone function copies canonical seed rows into production tables with a new `sandbox_id` column and remapped UUIDs. All existing RLS policies are extended with `sandbox_id` filtering. The `getAuthContext()` helper is extended to detect anonymous users and attach sandbox context, providing a normalized actor model for both real and guest users.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + RLS + Anonymous Auth + Storage), FastAPI (Python backend), Vitest, Python unittest.

---

## File structure

### Existing files to modify

| File | Change |
|------|--------|
| `supabase/migrations/0003_auth_account_hardening.sql` | N/A (reference only — new migration overrides trigger) |
| `web/src/lib/auth/session.ts` | Extend `AuthContext` with `isGuest`, `sandboxId`, `guestRole`. Extend `getAuthContext()` to detect anonymous users. Add `requireGuestOrVerifiedUser()`. |
| `web/src/lib/activities/access.ts` | Extend `requireAuthenticatedUser()` to accept guest actors. Add `requireRealAccountOnly()`. |
| `web/middleware.ts` | Allow anonymous (guest) users through protected routes without email verification. Redirect expired guest sessions. |
| `web/src/app/page.tsx` | Add guest CTA prop wiring. |
| `web/src/app/components/HeroContent.tsx` | Add `guestHref`/`guestLabel` props and tertiary CTA button. |
| `web/src/app/actions.ts` | Add `startGuestSession()` and `resetGuestSession()` server actions. Modify `signUp()` to discard guest session. |
| `web/src/app/classes/[classId]/page.tsx` | Support guest actor context for sandbox-bound class access. |
| `web/src/app/components/Sidebar.tsx` | Render guest-specific nav items when actor is guest. |
| `web/src/app/components/AuthHeader.tsx` | Show guest badge and signup CTA when actor is guest. |
| `backend/app/main.py` | Detect guest users via Supabase JWT `is_anonymous` claim. Add rate limit checks before AI endpoints. |
| `backend/app/config.py` | Add guest rate limit settings. |
| `backend/app/schemas.py` | Add `sandbox_id` field to request schemas that need it. |

### New files to create

| File | Purpose |
|------|---------|
| `supabase/migrations/0015_guest_mode_schema.sql` | `guest_sandboxes` table, `sandbox_id` columns on all content tables, modified profile trigger, clone function, cleanup function, RLS policy extensions. |
| `supabase/migrations/0016_guest_seed_data.sql` | Canonical seed dataset (class, materials, blueprint, topics, objectives, activities, quiz questions, flashcards, assignments, submissions, analytics). |
| `web/src/lib/guest/sandbox.ts` | Sandbox provisioning (calls clone function), reset, and status helpers. |
| `web/src/lib/guest/rate-limit.ts` | Server-side rate limit checks for guest AI operations. |
| `web/src/components/guest/GuestBanner.tsx` | Persistent guest mode banner with role switcher and signup CTA. |
| `backend/app/guest_rate_limit.py` | Backend rate limit enforcement for guest AI endpoints. |
| `web/src/lib/guest/storage.ts` | Sandbox-scoped storage path helpers and signed URL guard for guest mode. |

### Test files to create

| File | Purpose |
|------|---------|
| `web/src/lib/auth/session.test.ts` | Tests for extended auth context with guest detection. |
| `web/src/lib/guest/sandbox.test.ts` | Tests for sandbox provisioning, reset, and isolation. |
| `web/src/lib/guest/rate-limit.test.ts` | Tests for guest rate limit enforcement. |
| `backend/tests/test_guest_rate_limit.py` | Tests for backend guest rate limiting. |

---

### Task 1: Add `sandbox_id` columns and guest sandbox schema

**Files:**
- Create: `supabase/migrations/0015_guest_mode_schema.sql`

This is the foundation migration. It adds the `sandbox_id` column to every content table, creates the `guest_sandboxes` tracking table, modifies the profile sync trigger to handle anonymous users, and adds the sandbox clone function.

- [ ] **Step 1: Write the migration — part 1: guest_sandboxes table and sandbox_id columns**

```sql
-- 0015_guest_mode_schema.sql
-- Guest mode: sandbox infrastructure, profile trigger update, clone function, RLS extensions

-- ============================================================
-- 1. guest_sandboxes tracking table
-- ============================================================

create table public.guest_sandboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid, -- populated after clone; FK added after clone creates the class row
  status text not null default 'active' check (status in ('active', 'expired', 'discarded')),
  guest_role text not null default 'teacher' check (guest_role in ('teacher', 'student')),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours'),
  created_at timestamptz not null default now(),
  -- rate limit counters
  chat_messages_used int not null default 0,
  quiz_generations_used int not null default 0,
  flashcard_generations_used int not null default 0,
  blueprint_regenerations_used int not null default 0
);

create index guest_sandboxes_user_id_idx on public.guest_sandboxes(user_id);
create index guest_sandboxes_status_idx on public.guest_sandboxes(status, expires_at);

alter table public.guest_sandboxes enable row level security;

-- Guests can read their own sandbox
create policy guest_sandboxes_select_own on public.guest_sandboxes
  for select using (user_id = auth.uid());

-- Service role only for insert/update/delete (server actions use service role for sandbox ops)
create policy guest_sandboxes_service_role on public.guest_sandboxes
  for all using (auth.role() = 'service_role');
```

- [ ] **Step 2: Write the migration — part 2: add sandbox_id to all content tables**

Append to the same migration file:

```sql
-- ============================================================
-- 2. Add sandbox_id column to all content tables
-- ============================================================
-- NULL = production data (real users), non-NULL = guest sandbox data
-- Well-known seed sandbox ID: 00000000-0000-0000-0000-000000000000

alter table public.classes add column sandbox_id uuid;
alter table public.enrollments add column sandbox_id uuid;
alter table public.materials add column sandbox_id uuid;
alter table public.material_chunks add column sandbox_id uuid;
alter table public.blueprints add column sandbox_id uuid;
alter table public.topics add column sandbox_id uuid;
alter table public.objectives add column sandbox_id uuid;
alter table public.activities add column sandbox_id uuid;
alter table public.assignments add column sandbox_id uuid;
alter table public.assignment_recipients add column sandbox_id uuid;
alter table public.submissions add column sandbox_id uuid;
alter table public.quiz_questions add column sandbox_id uuid;
alter table public.flashcards add column sandbox_id uuid;
alter table public.feedback add column sandbox_id uuid;
alter table public.reflections add column sandbox_id uuid;
alter table public.class_chat_sessions add column sandbox_id uuid;
alter table public.class_chat_messages add column sandbox_id uuid;
alter table public.class_chat_session_compactions add column sandbox_id uuid;
alter table public.class_insights_snapshots add column sandbox_id uuid;
alter table public.class_teaching_brief_snapshots add column sandbox_id uuid;
alter table public.ai_requests add column sandbox_id uuid;

-- Indexes for sandbox filtering on high-traffic tables
create index classes_sandbox_id_idx on public.classes(sandbox_id) where sandbox_id is not null;
create index enrollments_sandbox_id_idx on public.enrollments(sandbox_id) where sandbox_id is not null;
create index activities_sandbox_id_idx on public.activities(sandbox_id) where sandbox_id is not null;
create index submissions_sandbox_id_idx on public.submissions(sandbox_id) where sandbox_id is not null;
create index class_chat_sessions_sandbox_id_idx on public.class_chat_sessions(sandbox_id) where sandbox_id is not null;
create index class_chat_messages_sandbox_id_idx on public.class_chat_messages(sandbox_id) where sandbox_id is not null;
```

- [ ] **Step 3: Write the migration — part 3: update profile sync trigger for anonymous users**

Append to the same migration file:

```sql
-- ============================================================
-- 3. Update profile sync trigger to handle anonymous users
-- ============================================================
-- Anonymous users created by signInAnonymously() don't have account_type metadata.
-- We skip profile creation for anonymous users — they don't need a profile row.

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  account_type_text text;
  parsed_account_type public.account_type;
begin
  -- Skip profile creation for anonymous users (guest mode)
  if new.is_anonymous = true then
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
    set account_type = excluded.account_type;

  return new;
end;
$$;
```

- [ ] **Step 4: Write the migration — part 4: sandbox clone function**

Append to the same migration file:

```sql
-- ============================================================
-- 4. Sandbox clone function
-- ============================================================
-- Clones all seed data (sandbox_id = '00000000-0000-0000-0000-000000000000')
-- into new rows with the provided sandbox_id and remapped UUIDs.
-- Returns the cloned class_id.

create or replace function public.clone_guest_sandbox(
  p_sandbox_id uuid,
  p_guest_user_id uuid
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  seed_id constant uuid := '00000000-0000-0000-0000-000000000000';
  -- ID mappings (seed → cloned)
  v_class_id uuid := gen_random_uuid();
  v_seed_class_id uuid;
  v_blueprint_id uuid := gen_random_uuid();
  v_seed_blueprint_id uuid;
  v_topic_rec record;
  v_new_topic_id uuid;
  v_obj_rec record;
  v_activity_rec record;
  v_new_activity_id uuid;
  v_assignment_rec record;
  v_new_assignment_id uuid;
  v_recipient_rec record;
  v_new_recipient_id uuid;
  v_submission_rec record;
  v_new_submission_id uuid;
  -- Topic ID mapping for FK remapping
  v_topic_map jsonb := '{}'::jsonb;
begin
  -- Get seed class
  select id into v_seed_class_id from public.classes where sandbox_id = seed_id limit 1;
  if v_seed_class_id is null then
    raise exception 'No seed class found for sandbox_id %', seed_id;
  end if;

  -- Get seed blueprint
  select id into v_seed_blueprint_id from public.blueprints
    where class_id = v_seed_class_id and sandbox_id = seed_id and status = 'published' limit 1;

  -- Clone class
  insert into public.classes (id, owner_id, title, description, subject, level, join_code, ai_provider, sandbox_id)
  select v_class_id, p_guest_user_id, title, description, subject, level,
         'guest-' || substr(p_sandbox_id::text, 1, 8), ai_provider, p_sandbox_id
  from public.classes where id = v_seed_class_id;

  -- Clone enrollments (teacher + student for the guest user)
  insert into public.enrollments (id, class_id, user_id, role, sandbox_id)
  values
    (gen_random_uuid(), v_class_id, p_guest_user_id, 'teacher', p_sandbox_id),
    (gen_random_uuid(), v_class_id, p_guest_user_id, 'student', p_sandbox_id);

  -- Clone materials (reference same storage paths — immutable seed files)
  insert into public.materials (id, class_id, uploaded_by, title, storage_path, mime_type, size_bytes, status, extracted_text, metadata, sandbox_id)
  select gen_random_uuid(), v_class_id, p_guest_user_id, title, storage_path, mime_type, size_bytes, status, extracted_text, metadata, p_sandbox_id
  from public.materials where class_id = v_seed_class_id and sandbox_id = seed_id;

  -- Clone material_chunks (reference same embeddings — immutable)
  insert into public.material_chunks (id, material_id, class_id, source_type, source_index, section_title, text, token_count, embedding, embedding_provider, embedding_model, extraction_method, quality_score, metadata, sandbox_id)
  select gen_random_uuid(), m_new.id, v_class_id, mc.source_type, mc.source_index, mc.section_title, mc.text, mc.token_count, mc.embedding, mc.embedding_provider, mc.embedding_model, mc.extraction_method, mc.quality_score, mc.metadata, p_sandbox_id
  from public.material_chunks mc
  join public.materials m_seed on mc.material_id = m_seed.id and m_seed.sandbox_id = seed_id
  join public.materials m_new on m_new.title = m_seed.title and m_new.sandbox_id = p_sandbox_id and m_new.class_id = v_class_id;

  -- Clone blueprint
  if v_seed_blueprint_id is not null then
    insert into public.blueprints (id, class_id, version, status, summary, created_by, approved_by, published_by, content_json, content_schema_version, sandbox_id, created_at, approved_at, published_at)
    select v_blueprint_id, v_class_id, version, status, summary, p_guest_user_id, p_guest_user_id, p_guest_user_id, content_json, content_schema_version, p_sandbox_id, created_at, approved_at, published_at
    from public.blueprints where id = v_seed_blueprint_id;

    -- Clone topics and build ID mapping
    for v_topic_rec in
      select * from public.topics where blueprint_id = v_seed_blueprint_id and sandbox_id = seed_id order by sequence
    loop
      v_new_topic_id := gen_random_uuid();
      v_topic_map := v_topic_map || jsonb_build_object(v_topic_rec.id::text, v_new_topic_id::text);

      insert into public.topics (id, blueprint_id, title, description, section, sequence, prerequisite_topic_ids, sandbox_id)
      values (v_new_topic_id, v_blueprint_id, v_topic_rec.title, v_topic_rec.description, v_topic_rec.section, v_topic_rec.sequence, '{}'::uuid[], p_sandbox_id);

      -- Clone objectives for this topic
      for v_obj_rec in
        select * from public.objectives where topic_id = v_topic_rec.id and sandbox_id = seed_id
      loop
        insert into public.objectives (id, topic_id, statement, level, sandbox_id)
        values (gen_random_uuid(), v_new_topic_id, v_obj_rec.statement, v_obj_rec.level, p_sandbox_id);
      end loop;
    end loop;

    -- Clone activities
    for v_activity_rec in
      select * from public.activities where class_id = v_seed_class_id and sandbox_id = seed_id
    loop
      v_new_activity_id := gen_random_uuid();

      insert into public.activities (id, class_id, blueprint_id, topic_id, type, title, config, status, created_by, sandbox_id)
      values (
        v_new_activity_id, v_class_id,
        case when v_activity_rec.blueprint_id = v_seed_blueprint_id then v_blueprint_id else null end,
        case when v_activity_rec.topic_id is not null then (v_topic_map ->> v_activity_rec.topic_id::text)::uuid else null end,
        v_activity_rec.type, v_activity_rec.title, v_activity_rec.config, v_activity_rec.status, p_guest_user_id, p_sandbox_id
      );

      -- Clone quiz_questions for this activity
      insert into public.quiz_questions (id, activity_id, question, choices, answer, explanation, order_index, sandbox_id)
      select gen_random_uuid(), v_new_activity_id, question, choices, answer, explanation, order_index, p_sandbox_id
      from public.quiz_questions where activity_id = v_activity_rec.id and sandbox_id = seed_id;

      -- Clone flashcards for this activity
      insert into public.flashcards (id, activity_id, front, back, order_index, sandbox_id)
      select gen_random_uuid(), v_new_activity_id, front, back, order_index, p_sandbox_id
      from public.flashcards where activity_id = v_activity_rec.id and sandbox_id = seed_id;

      -- Clone assignments for this activity
      for v_assignment_rec in
        select * from public.assignments where activity_id = v_activity_rec.id and sandbox_id = seed_id
      loop
        v_new_assignment_id := gen_random_uuid();

        insert into public.assignments (id, class_id, activity_id, assigned_by, due_at, sandbox_id)
        values (v_new_assignment_id, v_class_id, v_new_activity_id, p_guest_user_id, v_assignment_rec.due_at, p_sandbox_id);

        -- Clone assignment_recipients
        for v_recipient_rec in
          select * from public.assignment_recipients where assignment_id = v_assignment_rec.id and sandbox_id = seed_id
        loop
          v_new_recipient_id := gen_random_uuid();

          insert into public.assignment_recipients (id, assignment_id, student_id, status, sandbox_id)
          values (v_new_recipient_id, v_new_assignment_id, p_guest_user_id, v_recipient_rec.status, p_sandbox_id);

          -- Clone submissions
          for v_submission_rec in
            select * from public.submissions where assignment_id = v_assignment_rec.id and student_id = v_recipient_rec.student_id and sandbox_id = seed_id
          loop
            v_new_submission_id := gen_random_uuid();

            insert into public.submissions (id, assignment_id, student_id, content, score, sandbox_id)
            values (v_new_submission_id, v_new_assignment_id, p_guest_user_id, v_submission_rec.content, v_submission_rec.score, p_sandbox_id);

            -- Clone feedback
            insert into public.feedback (id, submission_id, created_by, source, content, is_edited, sandbox_id)
            select gen_random_uuid(), v_new_submission_id, p_guest_user_id, source, content, is_edited, p_sandbox_id
            from public.feedback where submission_id = v_submission_rec.id and sandbox_id = seed_id;
          end loop;
        end loop;
      end loop;
    end loop;
  end if;

  -- Clone analytics snapshots
  insert into public.class_insights_snapshots (id, class_id, payload, sandbox_id)
  select gen_random_uuid(), v_class_id, payload, p_sandbox_id
  from public.class_insights_snapshots where class_id = v_seed_class_id and sandbox_id = seed_id;

  insert into public.class_teaching_brief_snapshots (id, class_id, payload, status, sandbox_id)
  select gen_random_uuid(), v_class_id, payload, status, p_sandbox_id
  from public.class_teaching_brief_snapshots where class_id = v_seed_class_id and sandbox_id = seed_id;

  -- Update guest_sandboxes with the cloned class_id
  update public.guest_sandboxes set class_id = v_class_id where id = p_sandbox_id;

  return v_class_id;
end;
$$;
```

- [ ] **Step 5: Write the migration — part 5: cleanup function and RLS extensions**

Append to the same migration file:

```sql
-- ============================================================
-- 5. Sandbox cleanup function
-- ============================================================

create or replace function public.cleanup_expired_guest_sandboxes()
returns int
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_count int := 0;
  v_sandbox record;
begin
  for v_sandbox in
    select id, user_id from public.guest_sandboxes
    where status = 'active'
      and (expires_at < now() or last_seen_at < now() - interval '1 hour')
  loop
    -- Mark sandbox as expired
    update public.guest_sandboxes set status = 'expired' where id = v_sandbox.id;

    -- Delete all sandbox-scoped data (cascade handles most FKs)
    delete from public.classes where sandbox_id = v_sandbox.id;

    -- Delete the anonymous auth user (cascades to guest_sandboxes row)
    delete from auth.users where id = v_sandbox.user_id and is_anonymous = true;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ============================================================
-- 6. RLS policy extensions for sandbox isolation
-- ============================================================
-- Existing policies allow access based on class membership / ownership.
-- For guest users, we additionally need to ensure they can only access
-- rows matching their sandbox_id. We do this by:
-- 1. Adding a helper function to get the current user's sandbox_id
-- 2. Extending existing SELECT policies with sandbox awareness

create or replace function public.requesting_sandbox_id()
returns uuid
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select gs.id
  from public.guest_sandboxes gs
  where gs.user_id = auth.uid()
    and gs.status = 'active'
  limit 1;
$$;

create or replace function public.is_guest_user()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and is_anonymous = true
  );
$$;

-- Guest users can only see classes in their sandbox
create policy classes_select_guest on public.classes
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can update classes in their sandbox
create policy classes_update_guest on public.classes
  for update using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select their sandbox enrollments
create policy enrollments_select_guest on public.enrollments
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox materials
create policy materials_select_guest on public.materials
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox material_chunks
create policy material_chunks_select_guest on public.material_chunks
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox blueprints
create policy blueprints_select_guest on public.blueprints
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can update sandbox blueprints
create policy blueprints_update_guest on public.blueprints
  for update using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox topics
create policy topics_select_guest on public.topics
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox objectives
create policy objectives_select_guest on public.objectives
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can CRUD sandbox activities
create policy activities_select_guest on public.activities
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy activities_insert_guest on public.activities
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy activities_update_guest on public.activities
  for update using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can CRUD sandbox quiz_questions
create policy quiz_questions_select_guest on public.quiz_questions
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy quiz_questions_insert_guest on public.quiz_questions
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can CRUD sandbox flashcards
create policy flashcards_select_guest on public.flashcards
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy flashcards_insert_guest on public.flashcards
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox assignments
create policy assignments_select_guest on public.assignments
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy assignments_insert_guest on public.assignments
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox assignment_recipients
create policy assignment_recipients_select_guest on public.assignment_recipients
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can CRUD sandbox submissions
create policy submissions_select_guest on public.submissions
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy submissions_insert_guest on public.submissions
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox feedback
create policy feedback_select_guest on public.feedback
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can CRUD sandbox chat sessions
create policy class_chat_sessions_select_guest on public.class_chat_sessions
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy class_chat_sessions_insert_guest on public.class_chat_sessions
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy class_chat_sessions_update_guest on public.class_chat_sessions
  for update using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can CRUD sandbox chat messages
create policy class_chat_messages_select_guest on public.class_chat_messages
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy class_chat_messages_insert_guest on public.class_chat_messages
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox analytics
create policy class_insights_snapshots_select_guest on public.class_insights_snapshots
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy class_teaching_brief_snapshots_select_guest on public.class_teaching_brief_snapshots
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can select sandbox reflections
create policy reflections_select_guest on public.reflections
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy reflections_insert_guest on public.reflections
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can insert sandbox ai_requests (logging)
create policy ai_requests_insert_guest on public.ai_requests
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy ai_requests_select_guest on public.ai_requests
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- Guest users can CRUD sandbox chat session compactions
create policy class_chat_session_compactions_select_guest on public.class_chat_session_compactions
  for select using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy class_chat_session_compactions_insert_guest on public.class_chat_session_compactions
  for insert with check (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

create policy class_chat_session_compactions_update_guest on public.class_chat_session_compactions
  for update using (
    public.is_guest_user()
    and sandbox_id = public.requesting_sandbox_id()
  );

-- ============================================================
-- 7. Ensure existing RLS policies exclude sandbox data for real users
-- ============================================================
-- Existing policies use auth.uid() checks which won't match guest sandbox data
-- because sandbox rows have different owner_ids. However, to be safe, we add
-- explicit sandbox_id IS NULL checks to ensure real users never see sandbox data.
-- This is done via a helper that existing policies can incorporate.

create or replace function public.is_production_row(p_sandbox_id uuid)
returns boolean
language sql immutable
as $$
  select p_sandbox_id is null;
$$;

-- Note: Existing policies already effectively filter by owner_id / enrollment,
-- which won't match sandbox rows. The is_production_row() helper is available
-- for any policy that needs explicit exclusion.

-- ============================================================
-- 8. Schedule cleanup job via pg_cron (every 15 minutes)
-- ============================================================

select cron.schedule(
  'cleanup-expired-guest-sandboxes',
  '*/15 * * * *',
  $$select public.cleanup_expired_guest_sandboxes()$$
);
```

- [ ] **Step 6: Apply migration and verify**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && supabase db push
```

Then verify objects exist:

```bash
mcp__supabase__execute_sql --query "select to_regclass('public.guest_sandboxes'); select column_name from information_schema.columns where table_name = 'classes' and column_name = 'sandbox_id'; select proname from pg_proc where proname in ('clone_guest_sandbox', 'cleanup_expired_guest_sandboxes', 'requesting_sandbox_id', 'is_guest_user');"
```

Expected: all objects exist.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0015_guest_mode_schema.sql
git commit -m "feat: add guest mode sandbox schema, clone function, and RLS policies"
```

---

### Task 2: Insert canonical seed data

**Files:**
- Create: `supabase/migrations/0016_guest_seed_data.sql`

This migration inserts the curated sample dataset that every guest sandbox clones from. All content is synthetic.

- [ ] **Step 1: Write the seed data migration**

```sql
-- 0016_guest_seed_data.sql
-- Canonical guest seed data with well-known sandbox_id

do $$
declare
  seed_id constant uuid := '00000000-0000-0000-0000-000000000000';
  -- Well-known UUIDs for seed data (stable across environments)
  v_teacher_id constant uuid := '00000000-0000-0000-0001-000000000001';
  v_student_id constant uuid := '00000000-0000-0000-0001-000000000002';
  v_class_id constant uuid := '00000000-0000-0000-0002-000000000001';
  v_mat1_id constant uuid := '00000000-0000-0000-0003-000000000001';
  v_mat2_id constant uuid := '00000000-0000-0000-0003-000000000002';
  v_bp_id constant uuid := '00000000-0000-0000-0004-000000000001';
  v_topic1_id constant uuid := '00000000-0000-0000-0005-000000000001';
  v_topic2_id constant uuid := '00000000-0000-0000-0005-000000000002';
  v_topic3_id constant uuid := '00000000-0000-0000-0005-000000000003';
  v_obj1_id constant uuid := '00000000-0000-0000-0006-000000000001';
  v_obj2_id constant uuid := '00000000-0000-0000-0006-000000000002';
  v_obj3_id constant uuid := '00000000-0000-0000-0006-000000000003';
  v_obj4_id constant uuid := '00000000-0000-0000-0006-000000000004';
  v_obj5_id constant uuid := '00000000-0000-0000-0006-000000000005';
  v_obj6_id constant uuid := '00000000-0000-0000-0006-000000000006';
  v_quiz_act_id constant uuid := '00000000-0000-0000-0007-000000000001';
  v_flash_act_id constant uuid := '00000000-0000-0000-0007-000000000002';
  v_chat_act_id constant uuid := '00000000-0000-0000-0007-000000000003';
  v_quiz_assign_id constant uuid := '00000000-0000-0000-0008-000000000001';
  v_flash_assign_id constant uuid := '00000000-0000-0000-0008-000000000002';
  v_quiz_recip_id constant uuid := '00000000-0000-0000-0009-000000000001';
  v_flash_recip_id constant uuid := '00000000-0000-0000-0009-000000000002';
  v_quiz_sub_id constant uuid := '00000000-0000-0000-000a-000000000001';
begin
  -- Seed class
  insert into public.classes (id, owner_id, title, description, subject, level, join_code, ai_provider, sandbox_id)
  values (
    v_class_id, v_teacher_id,
    'Introduction to Cell Biology',
    'Explore the fundamentals of cell structure, function, and division. This course covers prokaryotic and eukaryotic cells, organelles, membrane transport, and the cell cycle.',
    'Biology', 'Introductory',
    'SEED-0000', 'openrouter', seed_id
  );

  -- Seed enrollments
  insert into public.enrollments (class_id, user_id, role, sandbox_id) values
    (v_class_id, v_teacher_id, 'teacher', seed_id),
    (v_class_id, v_student_id, 'student', seed_id);

  -- Seed materials (references to demo files in storage — paths only, no actual upload needed for seed)
  insert into public.materials (id, class_id, uploaded_by, title, storage_path, mime_type, size_bytes, status, extracted_text, sandbox_id) values
    (v_mat1_id, v_class_id, v_teacher_id, 'Cell Structure and Function - Lecture Notes',
     'materials/seed/cell-structure-notes.pdf', 'application/pdf', 245000, 'ready',
     'Chapter 1: Introduction to Cells. All living organisms are composed of cells. Cells are the basic structural and functional units of life. Robert Hooke first described cells in 1665 when he observed cork under a microscope. The cell theory states that: (1) all living things are made of cells, (2) cells are the basic units of structure and function, and (3) new cells are produced from existing cells. There are two main types of cells: prokaryotic and eukaryotic. Prokaryotic cells lack a membrane-bound nucleus and are typically smaller and simpler. Eukaryotic cells have a membrane-bound nucleus and complex organelles. Key organelles include: the nucleus (contains DNA), mitochondria (energy production), endoplasmic reticulum (protein and lipid synthesis), Golgi apparatus (modification and sorting), lysosomes (digestion), and the cell membrane (selective barrier).',
     seed_id),
    (v_mat2_id, v_class_id, v_teacher_id, 'Cell Division and the Cell Cycle - Slides',
     'materials/seed/cell-division-slides.pdf', 'application/pdf', 380000, 'ready',
     'The Cell Cycle and Division. The cell cycle consists of interphase and the mitotic phase. Interphase includes G1 (growth), S (DNA synthesis), and G2 (preparation for division). Mitosis has four stages: prophase (chromosomes condense), metaphase (chromosomes align), anaphase (chromosomes separate), and telophase (nuclear envelopes reform). Cytokinesis divides the cytoplasm. Meiosis is a special type of cell division that produces gametes with half the chromosome number. It involves two rounds of division: meiosis I (homologous chromosomes separate) and meiosis II (sister chromatids separate). Crossing over during prophase I increases genetic diversity.',
     seed_id);

  -- Seed material chunks (pre-embedded — embedding vectors omitted for seed, clone copies them)
  insert into public.material_chunks (material_id, class_id, source_type, source_index, section_title, text, token_count, sandbox_id) values
    (v_mat1_id, v_class_id, 'page', 0, 'Introduction to Cells',
     'All living organisms are composed of cells. Cells are the basic structural and functional units of life. Robert Hooke first described cells in 1665.',
     28, seed_id),
    (v_mat1_id, v_class_id, 'page', 1, 'Cell Theory',
     'The cell theory states that: (1) all living things are made of cells, (2) cells are the basic units of structure and function, and (3) new cells are produced from existing cells.',
     36, seed_id),
    (v_mat1_id, v_class_id, 'page', 2, 'Cell Types',
     'There are two main types of cells: prokaryotic and eukaryotic. Prokaryotic cells lack a membrane-bound nucleus. Eukaryotic cells have a membrane-bound nucleus and complex organelles.',
     32, seed_id),
    (v_mat2_id, v_class_id, 'page', 0, 'The Cell Cycle',
     'The cell cycle consists of interphase and the mitotic phase. Interphase includes G1 (growth), S (DNA synthesis), and G2 (preparation for division).',
     28, seed_id),
    (v_mat2_id, v_class_id, 'page', 1, 'Mitosis',
     'Mitosis has four stages: prophase (chromosomes condense), metaphase (chromosomes align), anaphase (chromosomes separate), and telophase (nuclear envelopes reform).',
     28, seed_id),
    (v_mat2_id, v_class_id, 'page', 2, 'Meiosis',
     'Meiosis is a special type of cell division that produces gametes with half the chromosome number. It involves two rounds of division increasing genetic diversity.',
     28, seed_id);

  -- Seed published blueprint
  insert into public.blueprints (id, class_id, version, status, summary, created_by, approved_by, published_by, content_json, content_schema_version, sandbox_id, approved_at, published_at) values
    (v_bp_id, v_class_id, 1, 'published',
     'A three-topic blueprint covering cell structure fundamentals, membrane transport mechanisms, and cell division processes.',
     v_teacher_id, v_teacher_id, v_teacher_id,
     '{
       "topics": [
         {"id": "' || v_topic1_id || '", "title": "Cell Structure and Organelles", "objectives": ["Identify the main organelles of eukaryotic cells", "Compare prokaryotic and eukaryotic cell structures"]},
         {"id": "' || v_topic2_id || '", "title": "Membrane Transport", "objectives": ["Explain passive and active transport mechanisms", "Describe osmosis and its effects on cells"]},
         {"id": "' || v_topic3_id || '", "title": "Cell Division", "objectives": ["Describe the stages of mitosis", "Compare mitosis and meiosis"]}
       ]
     }'::jsonb,
     'v2', seed_id, now(), now());

  -- Seed topics
  insert into public.topics (id, blueprint_id, title, description, section, sequence, sandbox_id) values
    (v_topic1_id, v_bp_id, 'Cell Structure and Organelles', 'Understanding the building blocks of cells and their functions.', 'Unit 1', 0, seed_id),
    (v_topic2_id, v_bp_id, 'Membrane Transport', 'How substances move across cell membranes.', 'Unit 1', 1, seed_id),
    (v_topic3_id, v_bp_id, 'Cell Division', 'The processes of mitosis and meiosis.', 'Unit 2', 2, seed_id);

  -- Seed objectives
  insert into public.objectives (id, topic_id, statement, level, sandbox_id) values
    (v_obj1_id, v_topic1_id, 'Identify the main organelles of eukaryotic cells and describe their functions', 'understand', seed_id),
    (v_obj2_id, v_topic1_id, 'Compare and contrast prokaryotic and eukaryotic cell structures', 'analyze', seed_id),
    (v_obj3_id, v_topic2_id, 'Explain passive and active transport mechanisms across cell membranes', 'understand', seed_id),
    (v_obj4_id, v_topic2_id, 'Describe osmosis and predict its effects on cells in different solutions', 'apply', seed_id),
    (v_obj5_id, v_topic3_id, 'Describe the stages of mitosis and explain their significance', 'understand', seed_id),
    (v_obj6_id, v_topic3_id, 'Compare mitosis and meiosis in terms of purpose and outcome', 'analyze', seed_id);

  -- Seed activities
  insert into public.activities (id, class_id, blueprint_id, topic_id, type, title, config, status, created_by, sandbox_id) values
    (v_quiz_act_id, v_class_id, v_bp_id, v_topic1_id, 'quiz', 'Cell Structure Quiz', '{"questionCount": 5}'::jsonb, 'published', v_teacher_id, seed_id),
    (v_flash_act_id, v_class_id, v_bp_id, v_topic1_id, 'flashcards', 'Cell Organelles Flashcards', '{"cardCount": 8}'::jsonb, 'published', v_teacher_id, seed_id),
    (v_chat_act_id, v_class_id, v_bp_id, v_topic2_id, 'chat', 'Membrane Transport Discussion', '{}'::jsonb, 'published', v_teacher_id, seed_id);

  -- Seed quiz questions
  insert into public.quiz_questions (activity_id, question, choices, answer, explanation, order_index, sandbox_id) values
    (v_quiz_act_id, 'Which organelle is responsible for energy production in eukaryotic cells?',
     '["Nucleus", "Mitochondria", "Golgi apparatus", "Endoplasmic reticulum"]'::jsonb,
     'Mitochondria', 'Mitochondria are often called the powerhouse of the cell because they generate most of the ATP through cellular respiration.', 0, seed_id),
    (v_quiz_act_id, 'What is the primary function of the cell membrane?',
     '["Energy production", "Protein synthesis", "Selective barrier", "DNA storage"]'::jsonb,
     'Selective barrier', 'The cell membrane acts as a selective barrier, controlling what enters and exits the cell.', 1, seed_id),
    (v_quiz_act_id, 'Which statement is part of cell theory?',
     '["Cells can spontaneously generate", "All living things are made of cells", "Only animals have cells", "Cells do not need energy"]'::jsonb,
     'All living things are made of cells', 'Cell theory states that all living organisms are composed of one or more cells.', 2, seed_id),
    (v_quiz_act_id, 'Prokaryotic cells differ from eukaryotic cells because they:',
     '["Are larger", "Have more organelles", "Lack a membrane-bound nucleus", "Cannot reproduce"]'::jsonb,
     'Lack a membrane-bound nucleus', 'Prokaryotic cells lack a membrane-bound nucleus, while eukaryotic cells have one.', 3, seed_id),
    (v_quiz_act_id, 'Which organelle is responsible for modifying and sorting proteins?',
     '["Ribosome", "Lysosome", "Golgi apparatus", "Vacuole"]'::jsonb,
     'Golgi apparatus', 'The Golgi apparatus modifies, sorts, and packages proteins and lipids for transport.', 4, seed_id);

  -- Seed flashcards
  insert into public.flashcards (activity_id, front, back, order_index, sandbox_id) values
    (v_flash_act_id, 'What is the function of mitochondria?', 'Mitochondria produce ATP through cellular respiration, providing energy for the cell.', 0, seed_id),
    (v_flash_act_id, 'What is the endoplasmic reticulum?', 'A network of membranes involved in protein synthesis (rough ER) and lipid synthesis (smooth ER).', 1, seed_id),
    (v_flash_act_id, 'What does the Golgi apparatus do?', 'It modifies, sorts, and packages proteins and lipids for secretion or delivery to other organelles.', 2, seed_id),
    (v_flash_act_id, 'What is the function of lysosomes?', 'Lysosomes contain digestive enzymes that break down waste materials, cellular debris, and foreign invaders.', 3, seed_id),
    (v_flash_act_id, 'What is the nucleus?', 'The membrane-bound organelle that contains the cell''s DNA and controls gene expression and cell activities.', 4, seed_id),
    (v_flash_act_id, 'What is the difference between prokaryotic and eukaryotic cells?', 'Prokaryotic cells lack a membrane-bound nucleus and complex organelles. Eukaryotic cells have both.', 5, seed_id),
    (v_flash_act_id, 'What are ribosomes?', 'Small organelles that synthesize proteins by translating messenger RNA. Found free in cytoplasm or on rough ER.', 6, seed_id),
    (v_flash_act_id, 'What is the cell membrane made of?', 'A phospholipid bilayer with embedded proteins, cholesterol, and carbohydrates (fluid mosaic model).', 7, seed_id);

  -- Seed assignments
  insert into public.assignments (id, class_id, activity_id, assigned_by, due_at, sandbox_id) values
    (v_quiz_assign_id, v_class_id, v_quiz_act_id, v_teacher_id, now() + interval '7 days', seed_id),
    (v_flash_assign_id, v_class_id, v_flash_act_id, v_teacher_id, now() + interval '5 days', seed_id);

  -- Seed assignment recipients
  insert into public.assignment_recipients (id, assignment_id, student_id, status, sandbox_id) values
    (v_quiz_recip_id, v_quiz_assign_id, v_student_id, 'submitted', seed_id),
    (v_flash_recip_id, v_flash_assign_id, v_student_id, 'assigned', seed_id);

  -- Seed a quiz submission with score
  insert into public.submissions (id, assignment_id, student_id, content, score, sandbox_id) values
    (v_quiz_sub_id, v_quiz_assign_id, v_student_id,
     '{"answers": [{"questionIndex": 0, "selectedChoice": "Mitochondria", "isCorrect": true}, {"questionIndex": 1, "selectedChoice": "Selective barrier", "isCorrect": true}, {"questionIndex": 2, "selectedChoice": "All living things are made of cells", "isCorrect": true}, {"questionIndex": 3, "selectedChoice": "Lack a membrane-bound nucleus", "isCorrect": true}, {"questionIndex": 4, "selectedChoice": "Ribosome", "isCorrect": false}], "attemptNumber": 1, "mode": "quiz_attempt"}'::jsonb,
     80, seed_id);

  -- Seed feedback for the submission
  insert into public.feedback (submission_id, created_by, source, content, sandbox_id) values
    (v_quiz_sub_id, v_teacher_id, 'ai',
     '{"summary": "Excellent work! You scored 4/5. Review the function of the Golgi apparatus for Q5.", "strengths": ["Strong understanding of cell theory", "Correctly identified mitochondria and membrane function"], "improvements": ["Review protein modification and sorting organelles"]}'::jsonb,
     seed_id);

  -- Seed analytics snapshot
  insert into public.class_insights_snapshots (class_id, payload, sandbox_id) values
    (v_class_id,
     '{"totalStudents": 24, "avgCompletionRate": 0.72, "avgQuizScore": 76.5, "topicMastery": {"Cell Structure and Organelles": 0.85, "Membrane Transport": 0.68, "Cell Division": 0.62}, "recentActivity": "12 students completed the Cell Structure Quiz this week", "engagementTrend": "increasing"}'::jsonb,
     seed_id);

  insert into public.class_teaching_brief_snapshots (class_id, payload, status, sandbox_id) values
    (v_class_id,
     '{"strengths": ["Strong engagement with Cell Structure content", "Quiz completion rates above 70%"], "improvements": ["Membrane Transport topic needs reinforcement", "Cell Division content has lowest mastery scores"], "recommendations": [{"topic": "Membrane Transport", "action": "Consider additional practice activities on osmosis", "priority": "high"}, {"topic": "Cell Division", "action": "Review meiosis concepts before next assessment", "priority": "medium"}], "nextSteps": "Focus upcoming activities on transport mechanisms to build foundation before Cell Division unit."}'::jsonb,
     'ready', seed_id);
end;
$$;
```

- [ ] **Step 2: Apply migration**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && supabase db push
```

Verify seed data:

```bash
mcp__supabase__execute_sql --query "select count(*) as seed_classes from classes where sandbox_id = '00000000-0000-0000-0000-000000000000'; select count(*) as seed_topics from topics where sandbox_id = '00000000-0000-0000-0000-000000000000'; select count(*) as seed_quiz_qs from quiz_questions where sandbox_id = '00000000-0000-0000-0000-000000000000';"
```

Expected: 1 class, 3 topics, 5 quiz questions.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0016_guest_seed_data.sql
git commit -m "feat: add canonical guest seed data for cell biology sample class"
```

---

### Task 3: Extend auth context for guest detection

**Files:**
- Modify: `web/src/lib/auth/session.ts`
- Create: `web/src/lib/auth/session.test.ts`

This task extends the core auth helper to detect anonymous Supabase users and attach sandbox context.

- [ ] **Step 1: Write failing tests**

Create `web/src/lib/auth/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase server client
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "./session";

function mockSupabase(overrides: {
  user?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  sandbox?: Record<string, unknown> | null;
}) {
  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: overrides.session ?? (overrides.user ? { access_token: "test-token" } : null),
        },
      }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: overrides.user ?? null },
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: overrides.profile ?? null,
            error: overrides.profile ? null : { code: "PGRST116" },
          }),
        };
      }
      if (table === "guest_sandboxes") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: overrides.sandbox ?? null,
            error: overrides.sandbox ? null : { code: "PGRST116" },
          }),
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) };
    }),
  };
  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
  return supabase;
}

describe("getAuthContext", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null user when no session exists", async () => {
    mockSupabase({ user: null });
    const ctx = await getAuthContext();
    expect(ctx.user).toBeNull();
    expect(ctx.isGuest).toBe(false);
  });

  it("returns authenticated user context for real user", async () => {
    mockSupabase({
      user: { id: "user-1", email: "test@example.com", email_confirmed_at: "2026-01-01", app_metadata: {} },
      profile: { id: "user-1", account_type: "teacher", display_name: "Test Teacher" },
    });
    const ctx = await getAuthContext();
    expect(ctx.user).toBeTruthy();
    expect(ctx.isGuest).toBe(false);
    expect(ctx.profile?.account_type).toBe("teacher");
    expect(ctx.sandboxId).toBeNull();
  });

  it("returns guest context for anonymous user with active sandbox", async () => {
    mockSupabase({
      user: { id: "anon-1", email: null, email_confirmed_at: null, app_metadata: { provider: "anonymous" }, is_anonymous: true },
      sandbox: { id: "sandbox-1", user_id: "anon-1", class_id: "class-1", status: "active", guest_role: "teacher" },
    });
    const ctx = await getAuthContext();
    expect(ctx.user).toBeTruthy();
    expect(ctx.isGuest).toBe(true);
    expect(ctx.sandboxId).toBe("sandbox-1");
    expect(ctx.guestRole).toBe("teacher");
    expect(ctx.guestClassId).toBe("class-1");
  });

  it("returns isGuest false for anonymous user without active sandbox", async () => {
    mockSupabase({
      user: { id: "anon-2", email: null, email_confirmed_at: null, app_metadata: { provider: "anonymous" }, is_anonymous: true },
      sandbox: null,
    });
    const ctx = await getAuthContext();
    expect(ctx.isGuest).toBe(false);
    expect(ctx.sandboxId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm vitest run web/src/lib/auth/session.test.ts
```

Expected: FAIL — `isGuest`, `sandboxId`, `guestRole`, `guestClassId` properties don't exist on AuthContext.

- [ ] **Step 3: Implement guest-aware auth context**

Modify `web/src/lib/auth/session.ts`:

```ts
// Add to AuthContext type (after existing fields):
export type AuthContext = {
  supabase: SupabaseClient;
  user: User | null;
  accessToken: string | null;
  profile: ProfileRow | null;
  isEmailVerified: boolean;
  // Guest mode fields
  isGuest: boolean;
  sandboxId: string | null;
  guestRole: "teacher" | "student" | null;
  guestClassId: string | null;
};

// In getAuthContext(), after fetching profile, add guest detection:
export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  const accessToken = session?.access_token ?? null;

  let profile: ProfileRow | null = null;
  let isEmailVerified = false;
  let isGuest = false;
  let sandboxId: string | null = null;
  let guestRole: "teacher" | "student" | null = null;
  let guestClassId: string | null = null;

  if (user) {
    // Check if this is an anonymous (guest) user
    const isAnonymous = user.is_anonymous === true ||
      user.app_metadata?.provider === "anonymous";

    if (isAnonymous) {
      // Look up active sandbox for this anonymous user
      const { data: sandbox } = await supabase
        .from("guest_sandboxes")
        .select("id, class_id, guest_role, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      if (sandbox) {
        isGuest = true;
        sandboxId = sandbox.id;
        guestRole = sandbox.guest_role;
        guestClassId = sandbox.class_id;
      }
    } else {
      // Regular user — fetch profile
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      profile = data;
      isEmailVerified = Boolean(user.email_confirmed_at);
    }
  }

  return { supabase, user, accessToken, profile, isEmailVerified, isGuest, sandboxId, guestRole, guestClassId };
}
```

Also update `requireVerifiedUser()` to reject guest users (they should use guest-specific routes):

```ts
export async function requireVerifiedUser(options?: {
  accountType?: AccountType;
  redirectPath?: string;
}) {
  const ctx = await getAuthContext();

  // Guest users should not reach real-account-only pages
  if (ctx.isGuest) {
    redirect("/");
  }

  // ... rest of existing implementation unchanged
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm vitest run web/src/lib/auth/session.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/auth/session.ts web/src/lib/auth/session.test.ts
git commit -m "feat: extend auth context with guest mode detection via anonymous auth"
```

---

### Task 4: Implement guest session entry and sandbox provisioning

**Files:**
- Create: `web/src/lib/guest/sandbox.ts`
- Modify: `web/src/app/actions.ts`
- Create: `web/src/lib/guest/sandbox.test.ts`

- [ ] **Step 1: Write failing tests for sandbox provisioning**

Create `web/src/lib/guest/sandbox.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { provisionGuestSandbox, switchGuestRole, resetGuestSandbox } from "./sandbox";

function mockSupabase(overrides: Record<string, unknown> = {}) {
  const supabase = {
    auth: {
      signInAnonymously: vi.fn().mockResolvedValue({
        data: { user: { id: "anon-1" }, session: { access_token: "tok" } },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "sandbox-1" }, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({
      data: "cloned-class-id",
      error: null,
    }),
    ...overrides,
  };
  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
  return supabase;
}

describe("provisionGuestSandbox", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates anonymous user and provisions sandbox", async () => {
    const supabase = mockSupabase();
    const result = await provisionGuestSandbox();
    expect(supabase.auth.signInAnonymously).toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith("clone_guest_sandbox", expect.objectContaining({
      p_sandbox_id: expect.any(String),
      p_guest_user_id: "anon-1",
    }));
    expect(result.ok).toBe(true);
    expect(result.classId).toBeTruthy();
  });

  it("returns error when signInAnonymously fails", async () => {
    mockSupabase({
      auth: {
        signInAnonymously: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "Anonymous auth disabled" },
        }),
      },
    });
    const result = await provisionGuestSandbox();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Anonymous auth");
  });
});

describe("switchGuestRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates guest_role in sandbox row", async () => {
    const supabase = mockSupabase();
    const result = await switchGuestRole("sandbox-1", "student");
    expect(result.ok).toBe(true);
  });
});

describe("resetGuestSandbox", () => {
  beforeEach(() => vi.clearAllMocks());

  it("discards old sandbox and provisions new one", async () => {
    const supabase = mockSupabase();
    const result = await resetGuestSandbox("anon-1");
    expect(result.ok).toBe(true);
    expect(result.classId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm vitest run web/src/lib/guest/sandbox.test.ts
```

Expected: FAIL — module `./sandbox` does not exist.

- [ ] **Step 3: Implement sandbox helpers**

Create `web/src/lib/guest/sandbox.ts`:

```ts
"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type SandboxResult = { ok: true; classId: string; sandboxId: string } | { ok: false; error: string };

export async function provisionGuestSandbox(): Promise<SandboxResult> {
  const supabase = await createServerSupabaseClient();

  // Step 0: Check if current session already has an active sandbox (idempotency guard)
  const { data: { session: existingSession } } = await supabase.auth.getSession();
  if (existingSession?.user) {
    const { data: existingSandbox } = await supabase
      .from("guest_sandboxes")
      .select("id, class_id")
      .eq("user_id", existingSession.user.id)
      .eq("status", "active")
      .single();
    if (existingSandbox?.class_id) {
      return { ok: true, classId: existingSandbox.class_id, sandboxId: existingSandbox.id };
    }
  }

  // Step 1: Create anonymous user
  const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
  if (authError || !authData.user) {
    return { ok: false, error: authError?.message ?? "Failed to create guest session" };
  }

  const userId = authData.user.id;
  const sandboxId = crypto.randomUUID();

  // Step 2: Create sandbox tracking row (using service-role via RPC or direct insert)
  const { error: sandboxError } = await supabase
    .from("guest_sandboxes")
    .insert({
      id: sandboxId,
      user_id: userId,
      guest_role: "teacher",
      status: "active",
      expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    });

  if (sandboxError) {
    return { ok: false, error: "Failed to create sandbox: " + sandboxError.message };
  }

  // Step 3: Clone seed data into sandbox
  const { data: classId, error: cloneError } = await supabase.rpc("clone_guest_sandbox", {
    p_sandbox_id: sandboxId,
    p_guest_user_id: userId,
  });

  if (cloneError || !classId) {
    return { ok: false, error: "Failed to provision sandbox: " + (cloneError?.message ?? "no class returned") };
  }

  return { ok: true, classId, sandboxId };
}

export async function switchGuestRole(
  sandboxId: string,
  newRole: "teacher" | "student",
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("guest_sandboxes")
    .update({ guest_role: newRole })
    .eq("id", sandboxId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function resetGuestSandbox(
  userId: string,
): Promise<SandboxResult> {
  const supabase = await createServerSupabaseClient();

  // Find and discard existing sandbox
  const { data: oldSandbox } = await supabase
    .from("guest_sandboxes")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .single();

  if (oldSandbox) {
    await supabase
      .from("guest_sandboxes")
      .update({ status: "discarded" })
      .eq("id", oldSandbox.id);

    // Delete old sandbox data by sandbox_id (classes CASCADE handles child tables)
    await supabase
      .from("classes")
      .delete()
      .eq("sandbox_id", oldSandbox.id);
  }

  // Provision fresh sandbox
  const sandboxId = crypto.randomUUID();
  const { error: sandboxError } = await supabase
    .from("guest_sandboxes")
    .insert({
      id: sandboxId,
      user_id: userId,
      guest_role: "teacher",
      status: "active",
      expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    });

  if (sandboxError) {
    return { ok: false, error: "Failed to create sandbox: " + sandboxError.message };
  }

  const { data: classId, error: cloneError } = await supabase.rpc("clone_guest_sandbox", {
    p_sandbox_id: sandboxId,
    p_guest_user_id: userId,
  });

  if (cloneError || !classId) {
    return { ok: false, error: "Failed to re-provision sandbox: " + (cloneError?.message ?? "no class returned") };
  }

  return { ok: true, classId, sandboxId };
}

export async function touchGuestSandbox(sandboxId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase
    .from("guest_sandboxes")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", sandboxId);
}
```

- [ ] **Step 4: Add server actions for guest entry**

Add to `web/src/app/actions.ts`:

```ts
import { provisionGuestSandbox, resetGuestSandbox } from "@/lib/guest/sandbox";

export async function startGuestSession(): Promise<{ ok: boolean; redirectTo?: string; error?: string }> {
  "use server";
  const result = await provisionGuestSandbox();
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, redirectTo: `/classes/${result.classId}` };
}

export async function resetGuestSessionAction(): Promise<{ ok: boolean; redirectTo?: string; error?: string }> {
  "use server";
  const { user, isGuest } = await getAuthContext();
  if (!user || !isGuest) return { ok: false, error: "Not in guest mode" };
  const result = await resetGuestSandbox(user.id);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, redirectTo: `/classes/${result.classId}` };
}
```

Also modify `signUp()` to discard guest session if one exists:

```ts
// At the top of signUp(), before the actual signup:
const ctx = await getAuthContext();
if (ctx.isGuest && ctx.user) {
  // Sign out the anonymous user first — discards guest session
  await ctx.supabase.auth.signOut();
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm vitest run web/src/lib/guest/sandbox.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/guest/sandbox.ts web/src/lib/guest/sandbox.test.ts web/src/app/actions.ts
git commit -m "feat: add guest sandbox provisioning and server actions"
```

---

### Task 5: Update middleware for guest sessions

**Files:**
- Modify: `web/middleware.ts`

Guest users (anonymous auth) should be allowed through protected routes without email verification, but only to their sandbox class page.

- [ ] **Step 1: Modify middleware to handle anonymous users**

In `web/middleware.ts`, update the auth check logic:

```ts
// After getting the user from supabase.auth.getUser():
const isAnonymous = user?.is_anonymous === true || user?.app_metadata?.provider === "anonymous";

// Replace the email verification redirect check:
if (isProtectedRoute) {
  if (!user) {
    // No user at all — redirect to login
    return NextResponse.redirect(new URL("/login?error=Please+sign+in", request.url));
  }
  if (isAnonymous) {
    // Guest user — allow through to class pages only
    // Guest-specific route validation happens in page loaders
    return response;
  }
  if (!user.email_confirmed_at) {
    // Real user without verified email
    return NextResponse.redirect(
      new URL("/login?error=Please+verify+your+email+before+continuing", request.url),
    );
  }
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm vitest run
```

Expected: PASS (no regressions).

- [ ] **Step 3: Commit**

```bash
git add web/middleware.ts
git commit -m "feat: allow anonymous guest users through protected routes"
```

---

### Task 6: Add homepage guest CTA and guest UX components

**Files:**
- Modify: `web/src/app/page.tsx`
- Modify: `web/src/app/components/HeroContent.tsx`
- Create: `web/src/components/guest/GuestBanner.tsx`

- [ ] **Step 1: Add guest CTA to homepage**

Modify `web/src/app/page.tsx` — add `guestHref` and `guestLabel` props:

```tsx
// After the existing CTA logic:
const guestHref = isAuthed ? undefined : "/guest/enter";
const guestLabel = isAuthed ? undefined : "Try as guest";

// Pass to HeroContent:
<HeroContent
  primaryHref={primaryHref}
  primaryLabel={primaryLabel}
  secondaryHref={secondaryHref}
  secondaryLabel={secondaryLabel}
  guestHref={guestHref}
  guestLabel={guestLabel}
/>
```

- [ ] **Step 2: Add guest CTA button to HeroContent**

Modify `web/src/app/components/HeroContent.tsx`:

```tsx
// Extend props type:
type HeroContentProps = {
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  guestHref?: string;
  guestLabel?: string;
};

// In the CTA section (Zone A), after the secondary link:
{guestHref && guestLabel && (
  <Link
    href={guestHref}
    className="text-sm ui-motion-color text-ui-subtle hover:text-accent"
  >
    {guestLabel} →
  </Link>
)}
```

- [ ] **Step 3: Create guest entry route**

Create `web/src/app/guest/enter/route.ts`:

```ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { startGuestSession } from "@/app/actions";

// Simple in-memory IP rate limiter for guest session creation.
// Max 5 sessions per IP per hour.
const ipSessionMap = new Map<string, number[]>();

function checkIpRate(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - 3600_000;
  const timestamps = (ipSessionMap.get(ip) ?? []).filter((t) => t > cutoff);
  ipSessionMap.set(ip, timestamps);
  return timestamps.length < 5;
}

export async function GET(request: Request) {
  // IP-level rate limit check
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkIpRate(ip)) {
    return NextResponse.redirect(new URL("/?error=too-many-guest-sessions", request.url));
  }

  const result = await startGuestSession();

  if (!result.ok || !result.redirectTo) {
    return NextResponse.redirect(new URL("/?error=guest-unavailable", request.url));
  }

  // Record successful session creation for IP tracking
  const timestamps = ipSessionMap.get(ip) ?? [];
  timestamps.push(Date.now());
  ipSessionMap.set(ip, timestamps);

  return NextResponse.redirect(new URL(result.redirectTo, request.url));
}
```

- [ ] **Step 4: Create GuestBanner component**

Create `web/src/components/guest/GuestBanner.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AppIcons } from "@/components/icons";

type GuestBannerProps = {
  guestRole: "teacher" | "student";
  sandboxId: string;
  classId: string;
  onSwitchRole: (newRole: "teacher" | "student") => void;
};

export default function GuestBanner({ guestRole, sandboxId, classId, onSwitchRole }: GuestBannerProps) {
  const otherRole = guestRole === "teacher" ? "student" : "teacher";

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <AppIcons.eye className="h-4 w-4 text-amber-600" />
        <span className="font-medium text-amber-800">
          Guest mode — viewing as <strong>{guestRole}</strong>
        </span>
        <span className="text-amber-600">·</span>
        <span className="text-amber-600">Changes are temporary</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onSwitchRole(otherRole)}
          className="text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900"
        >
          Switch to {otherRole} view
        </button>
        <Button asChild variant="warm" size="sm">
          <Link href="/register">Create account</Link>
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify build compiles**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm build
```

Expected: Build succeeds (no type errors).

- [ ] **Step 6: Commit**

```bash
git add web/src/app/page.tsx web/src/app/components/HeroContent.tsx web/src/app/guest/enter/route.ts web/src/components/guest/GuestBanner.tsx
git commit -m "feat: add homepage guest CTA and guest mode UX components"
```

---

### Task 7: Wire guest context into class pages

**Files:**
- Modify: `web/src/app/classes/[classId]/page.tsx`
- Modify: `web/src/app/components/Sidebar.tsx`
- Modify: `web/src/app/components/AuthHeader.tsx`

This task connects the guest auth context to the class page so guests can actually see their sandbox class.

- [ ] **Step 1: Update class page to support guest actors**

In `web/src/app/classes/[classId]/page.tsx`, replace the `requireVerifiedUser()` call with a guest-aware check:

```ts
import { getAuthContext } from "@/lib/auth/session";
import { touchGuestSandbox } from "@/lib/guest/sandbox";

// Replace: const { supabase, user, profile } = await requireVerifiedUser();
// With:
const ctx = await getAuthContext();
const { supabase, user, isGuest, sandboxId, guestRole, guestClassId } = ctx;

if (!user) {
  redirect("/login");
}

if (isGuest) {
  // Verify this is the guest's sandbox class
  if (guestClassId !== params.classId) {
    redirect(`/classes/${guestClassId}`);
  }
  // Touch sandbox for activity tracking
  if (sandboxId) await touchGuestSandbox(sandboxId);
} else {
  // Real user — existing verification
  if (!ctx.isEmailVerified || !ctx.profile?.account_type) {
    redirect("/login?error=Please+verify+your+email");
  }
}

// For guest mode, determine teacher/student view from guestRole.
// For real users, preserve the existing owner/enrollment check.
let isTeacher: boolean;
if (isGuest) {
  isTeacher = guestRole === "teacher";
} else {
  // Existing logic: check class ownership or enrollment role
  const classData = await supabase
    .from("classes")
    .select("owner_id, enrollments(role)")
    .eq("id", params.classId)
    .eq("enrollments.user_id", user.id)
    .single();
  isTeacher = classData.data?.owner_id === user.id ||
    ["teacher", "ta"].includes(classData.data?.enrollments?.[0]?.role ?? "");
}
```

- [ ] **Step 2: Update Sidebar to show guest nav items**

In `web/src/app/components/Sidebar.tsx`, add guest handling:

```tsx
// Accept new optional prop:
type SidebarProps = {
  accountType: string;
  userEmail?: string;
  userDisplayName?: string;
  classId?: string;
  isGuest?: boolean;
};

// For guest mode, show simplified nav (no settings, no help).
// For real users, preserve the existing teacher/student nav items unchanged.
const navItems = isGuest
  ? [{ label: "Guest Classroom", href: `/classes/${classId}`, icon: AppIcons.classes }]
  : navItemsForAccountType(accountType); // existing helper — do not modify

// Replace email/name display with "Guest" when isGuest:
const displayName = isGuest ? "Guest Explorer" : userDisplayName;
const displayEmail = isGuest ? "Temporary session" : userEmail;
```

- [ ] **Step 3: Update AuthHeader to show guest badge**

In `web/src/app/components/AuthHeader.tsx`, add guest awareness:

```tsx
// Accept new prop:
type AuthHeaderProps = {
  // ... existing props
  isGuest?: boolean;
};

// When isGuest, replace the Sign Out action with Register CTA:
{isGuest ? (
  <Button asChild variant="warm" size="sm">
    <Link href="/register">Create account</Link>
  </Button>
) : (
  <form action={signOut}>
    <Button type="submit" variant="ghost" size="sm">Sign out</Button>
  </form>
)}
```

- [ ] **Step 4: Verify build and run existing tests**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm build && pnpm vitest run
```

Expected: Build and tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/classes/[classId]/page.tsx web/src/app/components/Sidebar.tsx web/src/app/components/AuthHeader.tsx
git commit -m "feat: wire guest context into class pages and navigation"
```

---

### Task 8: Implement guest rate limiting

**Files:**
- Create: `web/src/lib/guest/rate-limit.ts`
- Create: `web/src/lib/guest/rate-limit.test.ts`
- Create: `backend/app/guest_rate_limit.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_guest_rate_limit.py`

- [ ] **Step 1: Write failing tests for rate limiting**

Create `web/src/lib/guest/rate-limit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkGuestRateLimit, incrementGuestUsage } from "./rate-limit";

function mockSupabase(sandbox: Record<string, unknown>) {
  const supabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: sandbox, error: null }),
    }),
  };
  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
  return supabase;
}

describe("checkGuestRateLimit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows when under limit", async () => {
    mockSupabase({ chat_messages_used: 10 });
    const result = await checkGuestRateLimit("sandbox-1", "chat");
    expect(result.allowed).toBe(true);
  });

  it("denies when at limit", async () => {
    mockSupabase({ chat_messages_used: 50 });
    const result = await checkGuestRateLimit("sandbox-1", "chat");
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("Create a free account");
  });

  it("denies quiz generation at limit", async () => {
    mockSupabase({ quiz_generations_used: 5 });
    const result = await checkGuestRateLimit("sandbox-1", "quiz");
    expect(result.allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm vitest run web/src/lib/guest/rate-limit.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement rate limit helpers**

Create `web/src/lib/guest/rate-limit.ts`:

```ts
"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const GUEST_LIMITS = {
  chat: { column: "chat_messages_used", limit: 50, label: "chat messages" },
  quiz: { column: "quiz_generations_used", limit: 5, label: "quiz generations" },
  flashcards: { column: "flashcard_generations_used", limit: 10, label: "flashcard generations" },
  blueprint: { column: "blueprint_regenerations_used", limit: 3, label: "blueprint regenerations" },
  embedding: { column: null, limit: 0, label: "embedding operations" }, // always blocked
} as const;

type GuestFeature = keyof typeof GUEST_LIMITS;
type RateLimitResult = { allowed: true } | { allowed: false; message: string };

export async function checkGuestRateLimit(
  sandboxId: string,
  feature: GuestFeature,
): Promise<RateLimitResult> {
  const supabase = await createServerSupabaseClient();
  const config = GUEST_LIMITS[feature];

  const { data } = await supabase
    .from("guest_sandboxes")
    .select(config.column)
    .eq("id", sandboxId)
    .single();

  // Embedding operations are always blocked for guests (pre-embedded seed only)
  if (!config.column) {
    return { allowed: false, message: `Guest mode does not support ${config.label}. Create a free account to use this feature!` };
  }

  if (!data) return { allowed: false, message: "Guest session not found" };

  const used = (data as Record<string, number>)[config.column] ?? 0;
  if (used >= config.limit) {
    return {
      allowed: false,
      message: `You've used all ${config.limit} guest ${config.label}. Create a free account to continue!`,
    };
  }

  return { allowed: true };
}

export async function incrementGuestUsage(
  sandboxId: string,
  feature: GuestFeature,
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const config = GUEST_LIMITS[feature];
  const column = config.column;

  // Increment the counter
  const { data } = await supabase
    .from("guest_sandboxes")
    .select(column)
    .eq("id", sandboxId)
    .single();

  if (data) {
    const current = (data as Record<string, number>)[column] ?? 0;
    await supabase
      .from("guest_sandboxes")
      .update({ [column]: current + 1 })
      .eq("id", sandboxId);
  }
}
```

- [ ] **Step 4: Add backend rate limit middleware**

Create `backend/app/guest_rate_limit.py`:

```python
"""Guest rate limiting for AI endpoints."""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from threading import Lock


@dataclass
class _GuestTracker:
    """In-memory tracker for guest concurrent operations and IP-level session limits."""
    _concurrent: int = 0
    _lock: Lock = field(default_factory=Lock)
    _ip_sessions: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))

    def try_acquire(self, max_concurrent: int = 20) -> bool:
        with self._lock:
            if self._concurrent >= max_concurrent:
                return False
            self._concurrent += 1
            return True

    def release(self) -> None:
        with self._lock:
            self._concurrent = max(0, self._concurrent - 1)

    def check_ip_rate(self, ip: str, max_sessions_per_hour: int = 5) -> bool:
        now = time.time()
        cutoff = now - 3600
        with self._lock:
            self._ip_sessions[ip] = [t for t in self._ip_sessions[ip] if t > cutoff]
            return len(self._ip_sessions[ip]) < max_sessions_per_hour

    def record_ip_session(self, ip: str) -> None:
        with self._lock:
            self._ip_sessions[ip].append(time.time())


guest_tracker = _GuestTracker()
```

- [ ] **Step 5: Wire rate limiting into backend AI endpoints**

In `backend/app/main.py`, add guest detection and rate limiting to AI endpoints:

```python
# At the top of AI endpoints (generate_chat_route, generate_quizzes, etc.):
from app.guest_rate_limit import guest_tracker

# In the auth resolution section of each AI endpoint, after user_id is resolved:
is_guest = False
if user_data and user_data.get("is_anonymous"):
    is_guest = True
    if not guest_tracker.try_acquire():
        return _error_response(
            request,
            status_code=429,
            message="Too many guest AI operations in progress. Please try again shortly.",
            code="guest_concurrent_limit",
        )

# Wrap the AI call in try/finally to always release the concurrent slot:
try:
    result = await run_in_threadpool(generate_with_fallback, settings, gen_request)
finally:
    if is_guest:
        guest_tracker.release()
```

- [ ] **Step 6: Run tests to verify pass**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm vitest run web/src/lib/guest/rate-limit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/guest/rate-limit.ts web/src/lib/guest/rate-limit.test.ts backend/app/guest_rate_limit.py backend/app/main.py
git commit -m "feat: add guest rate limiting for AI operations"
```

---

### Task 8.5: Implement guest storage isolation

**Files:**
- Create: `web/src/lib/guest/storage.ts`

Guest mode uses immutable seed files for reads (same `storage_path` values cloned from seed). If a guest uploads new materials or modifies files, writes must go to sandbox-scoped paths. Signed URL generation must only expose sandbox-safe or immutable seed assets.

- [ ] **Step 1: Create storage isolation helpers**

Create `web/src/lib/guest/storage.ts`:

```ts
/**
 * Guest-mode storage isolation helpers.
 *
 * Seed materials live at `materials/seed/...` and are immutable.
 * Guest-uploaded files go to `materials/sandbox/{sandboxId}/...`.
 * Signed URL generation validates the path is guest-safe.
 */

const SEED_STORAGE_PREFIX = "materials/seed/";
const SANDBOX_STORAGE_PREFIX = "materials/sandbox/";

export function buildGuestStoragePath(sandboxId: string, filename: string): string {
  return `${SANDBOX_STORAGE_PREFIX}${sandboxId}/${filename}`;
}

export function isGuestSafeStoragePath(path: string, sandboxId: string): boolean {
  // Allow immutable seed paths (read-only) or this sandbox's paths
  return path.startsWith(SEED_STORAGE_PREFIX) ||
    path.startsWith(`${SANDBOX_STORAGE_PREFIX}${sandboxId}/`);
}

export function assertGuestSafeSignedUrl(storagePath: string, sandboxId: string): void {
  if (!isGuestSafeStoragePath(storagePath, sandboxId)) {
    throw new Error(`Storage path ${storagePath} is not accessible in guest sandbox ${sandboxId}`);
  }
}
```

- [ ] **Step 2: Guard material upload actions for guest mode**

In `web/src/app/classes/actions.ts`, where materials are uploaded, add a guard:

```ts
import { buildGuestStoragePath, assertGuestSafeSignedUrl } from "@/lib/guest/storage";
import { getAuthContext } from "@/lib/auth/session";

// In the upload material server action, before writing to storage:
const ctx = await getAuthContext();
if (ctx.isGuest && ctx.sandboxId) {
  // Redirect upload to sandbox-scoped path
  storagePath = buildGuestStoragePath(ctx.sandboxId, file.name);
}

// In signed URL generation helpers, add the safety check:
if (ctx.isGuest && ctx.sandboxId) {
  assertGuestSafeSignedUrl(material.storage_path, ctx.sandboxId);
}
```

- [ ] **Step 3: Block material ingestion queue for guest uploads**

Guest-uploaded materials should NOT trigger the embedding pipeline (embedding ops are blocked for guests). In the material dispatch logic, skip enqueuing for sandbox-scoped materials:

```ts
// In the material processing dispatch, check sandbox_id:
if (material.sandbox_id) {
  // Guest material — mark as ready without embedding
  // (guest uses pre-embedded seed chunks for RAG)
  await supabase.from("materials").update({ status: "ready" }).eq("id", material.id);
  return;
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/guest/storage.ts web/src/app/classes/actions.ts
git commit -m "feat: add guest storage isolation and signed URL guards"
```

---

### Task 9: Implement guest lifecycle (expiry, reset, signup discard)

**Files:**
- Modify: `web/middleware.ts`
- Modify: `web/src/app/actions.ts`
- Modify: `web/src/lib/guest/sandbox.ts`

- [ ] **Step 1: Add expiry check to middleware**

In `web/middleware.ts`, when a guest user is detected, check sandbox expiry:

```ts
if (isAnonymous && isProtectedRoute) {
  // Check if guest sandbox is still valid
  const { data: sandbox } = await supabase
    .from("guest_sandboxes")
    .select("id, status, expires_at, last_seen_at")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  const isExpired = !sandbox ||
    new Date(sandbox.expires_at) < new Date() ||
    new Date(sandbox.last_seen_at) < new Date(Date.now() - 60 * 60 * 1000); // 1hr inactivity

  if (isExpired) {
    // Sign out the anonymous user and redirect to homepage
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/?guest=expired", request.url));
  }
}
```

- [ ] **Step 2: Ensure signup discards guest session**

Verify the `signUp()` action in `web/src/app/actions.ts` already calls `signOut()` for guest users (added in Task 4). Add explicit sandbox status update:

```ts
// In signUp(), before the actual signup:
const ctx = await getAuthContext();
if (ctx.isGuest && ctx.user && ctx.sandboxId) {
  // Mark sandbox as discarded
  await ctx.supabase
    .from("guest_sandboxes")
    .update({ status: "discarded" })
    .eq("id", ctx.sandboxId);
  // Sign out anonymous user
  await ctx.supabase.auth.signOut();
}
```

- [ ] **Step 3: Verify existing tests still pass**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm vitest run
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/middleware.ts web/src/app/actions.ts
git commit -m "feat: enforce guest session expiry and signup discard"
```

---

### Task 10: Full verification pass

**Files:**
- No new source files; verification only.

- [ ] **Step 1: Run all frontend tests**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm vitest run
```

Expected: PASS.

- [ ] **Step 2: Run all backend tests**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_*.py'
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm lint
```

Expected: PASS (or only pre-existing warnings).

- [ ] **Step 4: Verify build**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit any fixes from verification**

```bash
git add -A
git commit -m "test: finalize guest mode verification pass"
```

---

## Rollout notes

- Enable Supabase Anonymous Auth in the Supabase Dashboard (Authentication → Settings → Allow anonymous sign-ins)
- Start with feature gated by checking `NEXT_PUBLIC_GUEST_MODE_ENABLED` env var on the homepage CTA
- Set up `pg_cron` job to call `cleanup_expired_guest_sandboxes()` every 15 minutes
- Monitor `guest_sandboxes` table size and AI usage counters
- Observe rate-limit hit rates before adjusting thresholds

## Non-negotiable invariants

- Anonymous auth JWT provides the session — no custom cookie signing
- Sandbox IDs are server-generated UUIDs, never from client input
- Every guest read/write is sandbox-bounded via RLS policies
- The `sync_profile_from_auth_user` trigger skips anonymous users
- Seed data (sandbox_id = `00000000-...`) is never modified at runtime
- Signup always discards the guest sandbox, never migrates it
- Expired sandboxes reject requests even from stale tabs
- Real users never see sandbox-scoped rows (existing RLS + owner/enrollment checks)
