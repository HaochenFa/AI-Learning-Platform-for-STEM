-- Blueprint access controls, admin support, and topic sections

alter table topics
  add column if not exists section text;

create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table admin_users enable row level security;

create policy admin_users_select_self on admin_users for select
using (auth.uid() = user_id);

create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from admin_users where user_id = auth.uid()
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

-- Admin read access
create policy profiles_select_admin on profiles for select
using (is_admin());

create policy classes_select_admin on classes for select
using (is_admin());

create policy enrollments_select_admin on enrollments for select
using (is_admin());

create policy materials_select_admin on materials for select
using (is_admin());

create policy blueprints_select_admin on blueprints for select
using (is_admin());

create policy topics_select_admin on topics for select
using (is_admin());

create policy objectives_select_admin on objectives for select
using (is_admin());

create policy activities_select_admin on activities for select
using (is_admin());

create policy assignments_select_admin on assignments for select
using (is_admin());

create policy assignment_recipients_select_admin on assignment_recipients for select
using (is_admin());

create policy submissions_select_admin on submissions for select
using (is_admin());

create policy quiz_questions_select_admin on quiz_questions for select
using (is_admin());

create policy flashcards_select_admin on flashcards for select
using (is_admin());

create policy feedback_select_admin on feedback for select
using (is_admin());

create policy reflections_select_admin on reflections for select
using (is_admin());

create policy ai_requests_select_admin on ai_requests for select
using (is_admin());

create policy classes_delete_admin on classes for delete
using (is_admin());

-- Blueprint visibility rules

drop policy if exists blueprints_select_member on blueprints;

drop policy if exists topics_select_member on topics;

drop policy if exists objectives_select_member on objectives;

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

-- Restrict topic/objective writes to draft blueprints

drop policy if exists topics_write_teacher on topics;

drop policy if exists objectives_write_teacher on objectives;

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
