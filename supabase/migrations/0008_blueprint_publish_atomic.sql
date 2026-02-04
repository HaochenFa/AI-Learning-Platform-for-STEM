-- Publish a blueprint and archive other approved/published versions atomically.
create or replace function publish_blueprint(
  p_class_id uuid,
  p_blueprint_id uuid,
  p_published_by uuid
)
returns void
language plpgsql
as $$
declare
  v_status blueprint_status;
begin
  select status
    into v_status
    from blueprints
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

  update blueprints
     set status = 'archived'
   where class_id = p_class_id
     and id <> p_blueprint_id
     and status in ('approved', 'published');

  update blueprints
     set status = 'published',
         published_by = p_published_by,
         published_at = now()
   where id = p_blueprint_id;
end;
$$;
