-- Fix RLS recursion between classes and enrollments

create or replace function is_class_owner(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.classes c
    where c.id = target_class_id
      and c.owner_id = auth.uid()
  );
$$;

create or replace function is_class_member(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.classes c
    where c.id = target_class_id
      and c.owner_id = auth.uid()
  ) or exists (
    select 1
    from public.enrollments e
    where e.class_id = target_class_id
      and e.user_id = auth.uid()
  );
$$;

drop policy if exists classes_select_member on classes;
create policy classes_select_member
on classes for select
using (is_class_member(id));

drop policy if exists enrollments_select_member on enrollments;
create policy enrollments_select_member
on enrollments for select
using (
  auth.uid() = user_id
  or is_class_owner(enrollments.class_id)
);

drop policy if exists enrollments_delete_self_or_owner on enrollments;
create policy enrollments_delete_self_or_owner
on enrollments for delete
using (
  auth.uid() = user_id
  or is_class_owner(enrollments.class_id)
);
