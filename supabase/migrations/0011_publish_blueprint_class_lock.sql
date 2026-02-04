-- Serialize publishes per class to avoid deadlocks on concurrent publish attempts.
create or replace function publish_blueprint(
  p_class_id uuid,
  p_blueprint_id uuid
)
returns void
language plpgsql
as $$
declare
  v_status blueprint_status;
begin
  -- Advisory transaction lock scoped to the class to serialize publish operations.
  perform pg_advisory_xact_lock(
    ('x' || substr(replace(p_class_id::text, '-', ''), 1, 16))::bit(64)::bigint,
    ('x' || substr(replace(p_class_id::text, '-', ''), 17, 16))::bit(64)::bigint
  );

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
         published_by = auth.uid(),
         published_at = now()
   where id = p_blueprint_id;
end;
$$;
