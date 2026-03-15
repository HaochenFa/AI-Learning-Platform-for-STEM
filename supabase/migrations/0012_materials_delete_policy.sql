-- supabase/migrations/0012_materials_delete_policy.sql
-- Add missing DELETE RLS policy on materials table.
-- The storage bucket already has materials_storage_delete_teacher (0001_init.sql:789).
-- This mirrors the exact pattern from materials_update_teacher (0001_init.sql:752).

create policy materials_delete_teacher
on materials for delete
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
