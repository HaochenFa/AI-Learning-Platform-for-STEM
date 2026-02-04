alter type blueprint_status add value if not exists 'published';

alter table blueprints
  add column if not exists published_by uuid references auth.users(id) on delete set null,
  add column if not exists published_at timestamptz;

drop policy if exists blueprints_update_teacher on blueprints;

create policy blueprints_update_teacher
on blueprints for update
using (
  exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  or (
    exists (
      select 1 from enrollments e
      where e.class_id = blueprints.class_id
        and e.user_id = auth.uid()
        and e.role in ('teacher', 'ta')
    )
    and blueprints.status = 'draft'
  )
)
with check (
  exists (
    select 1 from classes c
    where c.id = blueprints.class_id
      and c.owner_id = auth.uid()
  )
  or (
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
  )
);
