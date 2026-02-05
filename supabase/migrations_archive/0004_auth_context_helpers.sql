-- Provide a per-request user id helper without touching auth schema.

create or replace function public.requesting_user_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

-- Use the helper in security-definer helpers to avoid cached auth.uid().
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.admin_users where user_id = public.requesting_user_id()
  );
$$;

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
      and c.owner_id = public.requesting_user_id()
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
      and c.owner_id = public.requesting_user_id()
  ) or exists (
    select 1
    from public.enrollments e
    where e.class_id = target_class_id
      and e.user_id = public.requesting_user_id()
  );
$$;

create or replace function join_class_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_class_id uuid;
  requester_id uuid;
begin
  requester_id := public.requesting_user_id();

  if requester_id is null then
    return null;
  end if;

  if code is null or length(trim(code)) = 0 then
    return null;
  end if;

  select id into target_class_id
  from public.classes
  where upper(join_code) = upper(code)
  limit 1;

  if target_class_id is null then
    return null;
  end if;

  insert into public.enrollments (class_id, user_id, role)
  values (target_class_id, requester_id, 'student')
  on conflict (class_id, user_id) do nothing;

  return target_class_id;
end;
$$;

-- Update update/delete policies to use the helper directly.
drop policy if exists classes_update_owner on classes;
create policy classes_update_owner
on classes for update
using (public.requesting_user_id() = owner_id);

drop policy if exists classes_delete_owner on classes;
create policy classes_delete_owner
on classes for delete
using (public.requesting_user_id() = owner_id);

drop policy if exists enrollments_insert_self on enrollments;
create policy enrollments_insert_self
on enrollments for insert
with check (public.requesting_user_id() = user_id);
