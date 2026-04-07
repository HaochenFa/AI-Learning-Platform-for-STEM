-- Supabase-native material processing queue + worker dispatch.

create extension if not exists pgmq;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create schema if not exists vault;

do $$
begin
  if exists (
    select 1
    from pg_extension
    where extname in ('supabase_vault', 'vault')
  ) then
    return;
  end if;

  begin
    create extension if not exists supabase_vault with schema vault;
  exception
    when undefined_file then
      create extension if not exists vault with schema vault;
  end;
end;
$$;

-- Durable queue used by the material worker.
do $$
begin
  if not exists (
    select 1
    from pg_tables
    where schemaname = 'pgmq'
      and tablename = 'q_material_jobs'
  ) then
    perform pgmq.create('material_jobs');
  end if;
end;
$$;

create or replace function public.enqueue_material_job(
  p_material_id uuid,
  p_class_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_authorized boolean;
  v_material_exists boolean;
  v_job_id uuid;
begin
  v_user_id := public.requesting_user_id();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.materials m
    where m.id = p_material_id
      and m.class_id = p_class_id
  ) into v_material_exists;

  if not v_material_exists then
    raise exception 'Material not found for class.' using errcode = '22023';
  end if;

  select (
    exists (
      select 1
      from public.classes c
      where c.id = p_class_id
        and c.owner_id = v_user_id
    )
    or exists (
      select 1
      from public.enrollments e
      where e.class_id = p_class_id
        and e.user_id = v_user_id
        and e.role in ('teacher', 'ta')
    )
  ) into v_authorized;

  if not coalesce(v_authorized, false) then
    raise exception 'Teacher access required.' using errcode = '42501';
  end if;

  -- Reuse the latest active job if one is already in flight.
  select j.id
    into v_job_id
    from public.material_processing_jobs j
   where j.material_id = p_material_id
     and j.class_id = p_class_id
     and j.status in ('pending', 'retry', 'processing')
   order by j.created_at desc
   limit 1;

  if v_job_id is null then
    insert into public.material_processing_jobs (
      material_id,
      class_id,
      status,
      stage,
      attempts,
      locked_at
    )
    values (
      p_material_id,
      p_class_id,
      'pending',
      'queued',
      0,
      null
    )
    returning id into v_job_id;
  end if;

  perform pgmq.send(
    queue_name => 'material_jobs',
    msg => jsonb_build_object(
      'job_id', v_job_id,
      'material_id', p_material_id,
      'class_id', p_class_id,
      'enqueued_at', now()
    )
  );

  return v_job_id;
end;
$$;

revoke all on function public.enqueue_material_job(uuid, uuid) from public;
grant execute on function public.enqueue_material_job(uuid, uuid) to authenticated;

create or replace function public.dequeue_material_jobs(
  p_limit int default 3,
  p_visibility_timeout_seconds int default 300
)
returns table (
  queue_message_id bigint,
  payload jsonb
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    q.msg_id as queue_message_id,
    q.message as payload
  from pgmq.read(
    queue_name => 'material_jobs',
    vt => greatest(30, coalesce(p_visibility_timeout_seconds, 300)),
    qty => least(greatest(1, coalesce(p_limit, 3)), 50)
  ) as q;
$$;

revoke all on function public.dequeue_material_jobs(int, int) from public;
grant execute on function public.dequeue_material_jobs(int, int) to service_role;

create or replace function public.ack_material_job(
  p_queue_message_id bigint
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  select pgmq.delete(
    queue_name => 'material_jobs',
    msg_id => p_queue_message_id
  );
$$;

revoke all on function public.ack_material_job(bigint) from public;
grant execute on function public.ack_material_job(bigint) to service_role;

create or replace function public.run_material_worker_dispatch(
  p_batch_size int default 3,
  p_timeout_milliseconds int default 15000
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_project_url text;
  v_worker_token text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_project_url
    from vault.decrypted_secrets
   where name = 'project_url'
   limit 1;

  if v_project_url is null then
    raise exception 'Missing vault secret: project_url';
  end if;

  select decrypted_secret
    into v_worker_token
    from vault.decrypted_secrets
   where name = 'material_worker_token'
   limit 1;

  if v_worker_token is null then
    raise exception 'Missing vault secret: material_worker_token';
  end if;

  select net.http_post(
    url := v_project_url || '/functions/v1/material-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_worker_token
    ),
    body := jsonb_build_object('batchSize', greatest(1, coalesce(p_batch_size, 3))),
    timeout_milliseconds := greatest(1000, coalesce(p_timeout_milliseconds, 15000))
  )
    into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.run_material_worker_dispatch(int, int) from public;
grant execute on function public.run_material_worker_dispatch(int, int) to postgres;

-- Install or replace the recurring dispatch schedule.
do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'material-worker-dispatch-30s'
  ) then
    perform cron.unschedule('material-worker-dispatch-30s');
  end if;

  perform cron.schedule(
    'material-worker-dispatch-30s',
    '30 seconds',
    $job$select public.run_material_worker_dispatch();$job$
  );
end;
$$;
