-- Requeue materials stuck in `processing` without an active job.
-- Run once after deploying the direct-upload + dispatch hardening fixes.

with orphaned_materials as (
  select
    m.id as material_id,
    m.class_id,
    m.storage_path,
    exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'materials'
        and o.name = m.storage_path
    ) as has_storage_object
  from public.materials m
  where m.status = 'processing'
    and not exists (
      select 1
      from public.material_processing_jobs j
      where j.material_id = m.id
        and j.class_id = m.class_id
        and j.status in ('pending', 'retry', 'processing')
    )
),
requeued_jobs as (
  insert into public.material_processing_jobs (
    material_id,
    class_id,
    status,
    stage,
    attempts,
    locked_at
  )
  select
    o.material_id,
    o.class_id,
    'pending',
    'queued',
    0,
    null
  from orphaned_materials o
  where o.has_storage_object
  returning id, material_id, class_id
),
queued_messages as (
  select
    pgmq.send(
      queue_name => 'material_jobs',
      msg => jsonb_build_object(
        'job_id', r.id,
        'material_id', r.material_id,
        'class_id', r.class_id,
        'enqueued_at', now()
      )
    ) as queue_message_id,
    r.id as job_id
  from requeued_jobs r
),
marked_failed as (
  update public.materials m
  set
    status = 'failed',
    metadata = jsonb_set(
      coalesce(m.metadata, '{}'::jsonb),
      '{warnings}',
      to_jsonb(
        array[
          'Processing could not be started. Please delete this file and upload it again.'
        ]::text[]
      ),
      true
    )
  from orphaned_materials o
  where m.id = o.material_id
    and not o.has_storage_object
  returning m.id
)
select
  (select count(*) from requeued_jobs) as requeued_job_count,
  (select count(*) from queued_messages) as queue_message_count,
  (select count(*) from marked_failed) as marked_failed_count;
