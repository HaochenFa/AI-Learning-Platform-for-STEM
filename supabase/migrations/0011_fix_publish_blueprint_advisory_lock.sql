-- Fix publish_blueprint advisory lock call to use a valid Postgres signature.
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
      select 1 from public.classes c
      where c.id = p_class_id
        and c.owner_id = auth.uid()
    )
  ) then
    raise exception 'Not authorized to publish blueprint.';
  end if;

  -- Advisory transaction lock scoped to the class to serialize publish operations.
  perform pg_advisory_xact_lock(hashtextextended(p_class_id::text, 0::bigint));

  select status
    into v_status
    from public.blueprints
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

  update public.blueprints
     set status = 'archived'
   where class_id = p_class_id
     and id <> p_blueprint_id
     and status in ('approved', 'published');

  update public.blueprints
     set status = 'published',
         published_by = auth.uid(),
         published_at = now()
   where id = p_blueprint_id;
end;
$$;
