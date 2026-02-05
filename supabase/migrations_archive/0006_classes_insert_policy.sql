-- Allow any authenticated user to create a class while preventing owner spoofing.

drop policy if exists classes_insert_owner on classes;
create policy classes_insert_authenticated
on classes for insert
with check (public.requesting_user_id() is not null);

-- Prevent clients from setting/changing ownership directly.
revoke insert (owner_id) on public.classes from anon, authenticated;
revoke update (owner_id) on public.classes from anon, authenticated;
