-- Restrict blueprint updates to allowed status transitions

drop policy if exists blueprints_update_teacher on blueprints;
drop policy if exists blueprints_update_owner_draft on blueprints;
drop policy if exists blueprints_update_owner_approved on blueprints;
drop policy if exists blueprints_update_owner_published on blueprints;

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
