-- Allow deleting draft blueprints for rollback/cleanup.
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
