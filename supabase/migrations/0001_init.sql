-- Initial schema for STEM Learning Platform
-- Supabase Postgres

create extension if not exists "pgcrypto";

-- Types
create type enrollment_role as enum ('teacher', 'student', 'ta');
create type blueprint_status as enum ('draft', 'approved', 'archived', 'published');
create type activity_type as enum ('chat', 'quiz', 'flashcards', 'homework', 'exam_review');

-- Profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Classes
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  title text not null,
  description text,
  subject text,
  level text,
  join_code text not null unique,
  ai_provider text not null default 'openrouter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived boolean not null default false
);

create index if not exists classes_owner_id_idx on classes(owner_id);
create index if not exists classes_join_code_idx on classes(join_code);

-- Enrollments
create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role enrollment_role not null default 'student',
  joined_at timestamptz not null default now(),
  unique (class_id, user_id)
);

create index if not exists enrollments_class_id_idx on enrollments(class_id);
create index if not exists enrollments_user_id_idx on enrollments(user_id);

-- Admin users
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- Materials
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  title text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'pending',
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists materials_class_id_idx on materials(class_id);

-- Blueprints
create table if not exists blueprints (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  version int not null default 1,
  status blueprint_status not null default 'draft',
  summary text,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  published_at timestamptz
);

create index if not exists blueprints_class_id_idx on blueprints(class_id);

-- Enforce a single draft per class to prevent concurrent draft creation.
-- Clean up any existing duplicate drafts per class before creating the index.
with ranked_drafts as (
  select
    id,
    class_id,
    row_number() over (
      partition by class_id
      order by version desc, created_at desc, id desc
    ) as rn
  from blueprints
  where status = 'draft'
)
update blueprints b
set status = 'archived'
from ranked_drafts r
where b.id = r.id
  and r.rn > 1;

create unique index if not exists blueprints_single_draft_per_class
  on blueprints (class_id)
  where status = 'draft';

-- Topics
create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references blueprints(id) on delete cascade,
  title text not null,
  description text,
  section text,
  sequence int not null default 0,
  prerequisite_topic_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);

create index if not exists topics_blueprint_id_idx on topics(blueprint_id);

-- Objectives
create table if not exists objectives (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  statement text not null,
  level text,
  created_at timestamptz not null default now()
);

create index if not exists objectives_topic_id_idx on objectives(topic_id);

-- Activities
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  blueprint_id uuid references blueprints(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  type activity_type not null,
  title text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists activities_class_id_idx on activities(class_id);
create index if not exists activities_topic_id_idx on activities(topic_id);

-- Assignments
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists assignments_class_id_idx on assignments(class_id);

-- Assignment recipients
create table if not exists assignment_recipients (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'assigned',
  assigned_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index if not exists assignment_recipients_assignment_id_idx on assignment_recipients(assignment_id);
create index if not exists assignment_recipients_student_id_idx on assignment_recipients(student_id);

-- Submissions
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  score numeric,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists submissions_assignment_id_idx on submissions(assignment_id);
create index if not exists submissions_student_id_idx on submissions(student_id);

-- Quiz questions
create table if not exists quiz_questions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  question text not null,
  choices jsonb,
  answer text,
  explanation text,
  order_index int not null default 0
);

create index if not exists quiz_questions_activity_id_idx on quiz_questions(activity_id);

-- Flashcards
create table if not exists flashcards (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  front text not null,
  back text not null,
  order_index int not null default 0
);

create index if not exists flashcards_activity_id_idx on flashcards(activity_id);

-- Feedback
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  source text not null default 'ai',
  content jsonb not null default '{}'::jsonb,
  is_edited boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists feedback_submission_id_idx on feedback(submission_id);

-- Reflections
create table if not exists reflections (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists reflections_assignment_id_idx on reflections(assignment_id);
create index if not exists reflections_student_id_idx on reflections(student_id);

-- AI requests
create table if not exists ai_requests (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references classes(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  model text,
  purpose text,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  latency_ms int,
  status text,
  created_at timestamptz not null default now()
);

create index if not exists ai_requests_class_id_idx on ai_requests(class_id);

-- Updated at trigger
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger classes_set_updated_at
before update on classes
for each row
execute function set_updated_at();

create trigger submissions_set_updated_at
before update on submissions
for each row
execute function set_updated_at();

-- Admin helpers
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

create or replace function join_class_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_class_id uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  if code is null or length(trim(code)) = 0 then
    return null;
  end if;

  select id into target_class_id
  from classes
  where upper(join_code) = upper(code)
  limit 1;

  if target_class_id is null then
    return null;
  end if;

  insert into enrollments (class_id, user_id, role)
  values (target_class_id, auth.uid(), 'student')
  on conflict (class_id, user_id) do nothing;

  return target_class_id;
end;
$$;

grant execute on function join_class_by_code(text) to authenticated;

-- Publish blueprint atomically with per-class locking.
create or replace function publish_blueprint(
  p_class_id uuid,
  p_blueprint_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status blueprint_status;
begin
  if not (
    is_admin()
    or exists (
      select 1 from classes c
      where c.id = p_class_id
        and c.owner_id = auth.uid()
    )
  ) then
    raise exception 'Not authorized to publish blueprint.';
  end if;

  -- Advisory transaction lock scoped to the class to serialize publish operations.
  perform pg_advisory_xact_lock(
    ('x' || substr(replace(p_class_id::text, '-', ''), 1, 16))::bit(64)::bigint,
    ('x' || substr(replace(p_class_id::text, '-', ''), 17, 16))::bit(64)::bigint
  );

  select status
    into v_status
    from blueprints
   where id = p_blueprint_id
     and class_id = p_class_id
   for update;

  if not found then
    raise exception 'Blueprint not found.';
  end if;

  if v_status = 'published' then
    return;
  end if;

  if v_status <> 'approved' then
    raise exception 'Blueprint must be approved before publishing.';
  end if;

  update blueprints
     set status = 'archived'
   where class_id = p_class_id
     and id <> p_blueprint_id
     and status in ('approved', 'published');

  update blueprints
     set status = 'published',
         published_by = auth.uid(),
         published_at = now()
   where id = p_blueprint_id;
end;
$$;

revoke execute on function publish_blueprint(uuid, uuid) from public;
grant execute on function publish_blueprint(uuid, uuid) to authenticated;

-- Row Level Security
alter table profiles enable row level security;
alter table classes enable row level security;
alter table admin_users enable row level security;
alter table enrollments enable row level security;
alter table materials enable row level security;
alter table blueprints enable row level security;
alter table topics enable row level security;
alter table objectives enable row level security;
alter table activities enable row level security;
alter table assignments enable row level security;
alter table assignment_recipients enable row level security;
alter table submissions enable row level security;
alter table quiz_questions enable row level security;
alter table flashcards enable row level security;
alter table feedback enable row level security;
alter table reflections enable row level security;
alter table ai_requests enable row level security;

-- Profiles policies
create policy profiles_select_own
on profiles for select
using (auth.uid() = id);

create policy profiles_insert_own
on profiles for insert
with check (auth.uid() = id);

create policy profiles_update_own
on profiles for update
using (auth.uid() = id);

create policy profiles_select_admin on profiles for select
using (is_admin());

-- Admin users policies
create policy admin_users_select_self on admin_users for select
using (auth.uid() = user_id);

-- Classes policies
create policy classes_select_member
on classes for select
using (
  auth.uid() = owner_id
  or exists (
    select 1 from enrollments e
    where e.class_id = classes.id
      and e.user_id = auth.uid()
  )
);

create policy classes_insert_owner
on classes for insert
with check (auth.uid() = owner_id);

create policy classes_update_owner
on classes for update
using (auth.uid() = owner_id);

create policy classes_delete_owner
on classes for delete
using (auth.uid() = owner_id);

create policy classes_select_admin on classes for select
using (is_admin());

create policy classes_delete_admin on classes for delete
using (is_admin());

-- Enrollments policies
create policy enrollments_select_member
on enrollments for select
using (
  auth.uid() = user_id
  or exists (
    select 1 from classes c
    where c.id = enrollments.class_id
      and c.owner_id = auth.uid()
  )
);

create policy enrollments_insert_self
on enrollments for insert
with check (auth.uid() = user_id);

create policy enrollments_delete_self_or_owner
on enrollments for delete
using (
  auth.uid() = user_id
  or exists (
    select 1 from classes c
    where c.id = enrollments.class_id
      and c.owner_id = auth.uid()
  )
);

create policy enrollments_select_admin on enrollments for select
using (is_admin());

-- Materials policies
create policy materials_select_teacher
on materials for select
using (
  exists (
    select 1 from classes c
    where c.id = materials.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = materials.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy materials_insert_teacher
on materials for insert
with check (
  exists (
    select 1 from classes c
    where c.id = materials.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = materials.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy materials_update_teacher
on materials for update
using (
  exists (
    select 1 from classes c
    where c.id = materials.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = materials.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy materials_select_admin on materials for select
using (is_admin());

-- Materials storage bucket and policies
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict do nothing;

create policy materials_storage_select_teacher
on storage.objects for select
using (
  bucket_id = 'materials'
  and exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = (storage.foldername(name))[2]::uuid
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy materials_storage_insert_teacher
on storage.objects for insert
with check (
  bucket_id = 'materials'
  and exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = (storage.foldername(name))[2]::uuid
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy materials_storage_delete_teacher
on storage.objects for delete
using (
  bucket_id = 'materials'
  and exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = (storage.foldername(name))[2]::uuid
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

-- Blueprints policies
create policy blueprints_select_member
on blueprints for select
using (
  is_admin()
  or exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = blueprints.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
  or (
    blueprints.status = 'published'
    and exists (
      select 1 from enrollments e
      where e.class_id = blueprints.class_id
        and e.user_id = auth.uid()
    )
  )
);

create policy blueprints_insert_teacher
on blueprints for insert
with check (
  exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = blueprints.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy blueprints_update_teacher
on blueprints for update
using (
  exists (
    select 1 from enrollments e
    where e.class_id = blueprints.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
  and blueprints.status = 'draft'
)
with check (
  exists (
    select 1 from enrollments e
    where e.class_id = blueprints.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
  and blueprints.status = 'draft'
  and blueprints.approved_by is null
  and blueprints.approved_at is null
  and blueprints.published_by is null
  and blueprints.published_at is null
);

create policy blueprints_update_owner_draft
on blueprints for update
using (
  exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  and blueprints.status = 'draft'
)
with check (
  exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  and blueprints.status in ('draft', 'approved')
);

create policy blueprints_update_owner_approved
on blueprints for update
using (
  exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  and blueprints.status = 'approved'
)
with check (
  exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  and blueprints.status in ('published', 'archived')
);

create policy blueprints_update_owner_published
on blueprints for update
using (
  exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  and blueprints.status = 'published'
)
with check (
  exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  and blueprints.status = 'archived'
);

create policy blueprints_delete_draft_teacher
on blueprints for delete
using (
  (
    exists (
      select 1 from classes c
      where c.id = blueprints.class_id
        and c.owner_id = auth.uid()
    )
    and blueprints.status = 'draft'
  )
  or (
    exists (
      select 1 from enrollments e
      where e.class_id = blueprints.class_id
        and e.user_id = auth.uid()
        and e.role in ('teacher', 'ta')
    )
    and blueprints.status = 'draft'
    and blueprints.created_by = auth.uid()
  )
);

create policy blueprints_select_admin on blueprints for select
using (is_admin());

-- Topics policies
create policy topics_select_member
on topics for select
using (
  is_admin()
  or exists (
    select 1 from blueprints b
    join classes c on c.id = b.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where b.id = topics.blueprint_id
      and (
        c.owner_id = auth.uid()
        or e.role in ('teacher', 'ta')
        or (e.user_id is not null and b.status = 'published')
      )
  )
);

create policy topics_write_teacher
on topics for all
using (
  exists (
    select 1 from blueprints b
    join classes c on c.id = b.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where b.id = topics.blueprint_id
      and b.status = 'draft'
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
)
with check (
  exists (
    select 1 from blueprints b
    join classes c on c.id = b.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where b.id = topics.blueprint_id
      and b.status = 'draft'
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy topics_select_admin on topics for select
using (is_admin());

-- Objectives policies
create policy objectives_select_member
on objectives for select
using (
  is_admin()
  or exists (
    select 1 from topics t
    join blueprints b on b.id = t.blueprint_id
    join classes c on c.id = b.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where t.id = objectives.topic_id
      and (
        c.owner_id = auth.uid()
        or e.role in ('teacher', 'ta')
        or (e.user_id is not null and b.status = 'published')
      )
  )
);

create policy objectives_write_teacher
on objectives for all
using (
  exists (
    select 1 from topics t
    join blueprints b on b.id = t.blueprint_id
    join classes c on c.id = b.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where t.id = objectives.topic_id
      and b.status = 'draft'
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
)
with check (
  exists (
    select 1 from topics t
    join blueprints b on b.id = t.blueprint_id
    join classes c on c.id = b.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where t.id = objectives.topic_id
      and b.status = 'draft'
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy objectives_select_admin on objectives for select
using (is_admin());

-- Activities policies
create policy activities_select_member
on activities for select
using (
  exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = activities.class_id
      and (c.owner_id = auth.uid() or e.user_id is not null)
  )
);

create policy activities_write_teacher
on activities for all
using (
  exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = activities.class_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
)
with check (
  exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = activities.class_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy activities_select_admin on activities for select
using (is_admin());

-- Assignments policies
create policy assignments_select_member
on assignments for select
using (
  exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = assignments.class_id
      and (c.owner_id = auth.uid() or e.user_id is not null)
  )
);

create policy assignments_write_teacher
on assignments for all
using (
  exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = assignments.class_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
)
with check (
  exists (
    select 1 from classes c
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where c.id = assignments.class_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy assignments_select_admin on assignments for select
using (is_admin());

-- Assignment recipients policies
create policy assignment_recipients_select_member
on assignment_recipients for select
using (
  auth.uid() = student_id
  or exists (
    select 1 from assignments a
    join classes c on c.id = a.class_id
    where a.id = assignment_recipients.assignment_id
      and c.owner_id = auth.uid()
  )
);

create policy assignment_recipients_write_teacher
on assignment_recipients for all
using (
  exists (
    select 1 from assignments a
    join classes c on c.id = a.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where a.id = assignment_recipients.assignment_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
)
with check (
  exists (
    select 1 from assignments a
    join classes c on c.id = a.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where a.id = assignment_recipients.assignment_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy assignment_recipients_select_admin on assignment_recipients for select
using (is_admin());

-- Submissions policies
create policy submissions_select_member
on submissions for select
using (
  auth.uid() = student_id
  or exists (
    select 1 from assignments a
    join classes c on c.id = a.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where a.id = submissions.assignment_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy submissions_insert_student
on submissions for insert
with check (auth.uid() = student_id);

create policy submissions_update_owner_or_teacher
on submissions for update
using (
  auth.uid() = student_id
  or exists (
    select 1 from assignments a
    join classes c on c.id = a.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where a.id = submissions.assignment_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy submissions_select_admin on submissions for select
using (is_admin());

-- Quiz questions policies
create policy quiz_questions_select_member
on quiz_questions for select
using (
  exists (
    select 1 from activities act
    join classes c on c.id = act.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where act.id = quiz_questions.activity_id
      and (c.owner_id = auth.uid() or e.user_id is not null)
  )
);

create policy quiz_questions_write_teacher
on quiz_questions for all
using (
  exists (
    select 1 from activities act
    join classes c on c.id = act.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where act.id = quiz_questions.activity_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
)
with check (
  exists (
    select 1 from activities act
    join classes c on c.id = act.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where act.id = quiz_questions.activity_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy quiz_questions_select_admin on quiz_questions for select
using (is_admin());

-- Flashcards policies
create policy flashcards_select_member
on flashcards for select
using (
  exists (
    select 1 from activities act
    join classes c on c.id = act.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where act.id = flashcards.activity_id
      and (c.owner_id = auth.uid() or e.user_id is not null)
  )
);

create policy flashcards_write_teacher
on flashcards for all
using (
  exists (
    select 1 from activities act
    join classes c on c.id = act.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where act.id = flashcards.activity_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
)
with check (
  exists (
    select 1 from activities act
    join classes c on c.id = act.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where act.id = flashcards.activity_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy flashcards_select_admin on flashcards for select
using (is_admin());

-- Feedback policies
create policy feedback_select_member
on feedback for select
using (
  exists (
    select 1 from submissions s
    join assignments a on a.id = s.assignment_id
    join classes c on c.id = a.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where s.id = feedback.submission_id
      and (c.owner_id = auth.uid() or auth.uid() = s.student_id or e.role in ('teacher', 'ta'))
  )
);

create policy feedback_insert_teacher
on feedback for insert
with check (
  exists (
    select 1 from submissions s
    join assignments a on a.id = s.assignment_id
    join classes c on c.id = a.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where s.id = feedback.submission_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy feedback_select_admin on feedback for select
using (is_admin());

-- Reflections policies
create policy reflections_select_member
on reflections for select
using (
  auth.uid() = student_id
  or exists (
    select 1 from assignments a
    join classes c on c.id = a.class_id
    left join enrollments e on e.class_id = c.id and e.user_id = auth.uid()
    where a.id = reflections.assignment_id
      and (c.owner_id = auth.uid() or e.role in ('teacher', 'ta'))
  )
);

create policy reflections_insert_student
on reflections for insert
with check (auth.uid() = student_id);

create policy reflections_select_admin on reflections for select
using (is_admin());

-- AI requests policies
create policy ai_requests_select_member
on ai_requests for select
using (
  auth.uid() = user_id
  or exists (
    select 1 from classes c
    where c.id = ai_requests.class_id
      and c.owner_id = auth.uid()
  )
);

create policy ai_requests_insert_member
on ai_requests for insert
with check (
  auth.uid() = user_id
  or exists (
    select 1 from classes c
    where c.id = ai_requests.class_id
      and c.owner_id = auth.uid()
  )
);

create policy ai_requests_select_admin on ai_requests for select
using (is_admin());
