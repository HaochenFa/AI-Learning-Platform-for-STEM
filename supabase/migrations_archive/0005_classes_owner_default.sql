-- Default class owner to the requesting user to avoid client-supplied owner_id.

alter table public.classes
  alter column owner_id set default public.requesting_user_id();
