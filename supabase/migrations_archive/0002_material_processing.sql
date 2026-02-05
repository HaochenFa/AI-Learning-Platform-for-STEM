-- Material processing jobs + chunked retrieval
create extension if not exists vector;

create table if not exists material_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  status text not null default 'pending',
  stage text not null default 'queued',
  attempts int not null default 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists material_processing_jobs_status_idx
  on material_processing_jobs(status, created_at);

create table if not exists material_chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  source_type text not null,
  source_index int not null,
  section_title text,
  text text not null,
  token_count int not null,
  -- NOTE: Update 1536 to match EMBEDDING_DIM in web/.env.local when using different embedding models.
  embedding vector(1536),
  embedding_provider text,
  embedding_model text,
  extraction_method text,
  quality_score real,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists material_chunks_class_id_idx
  on material_chunks(class_id);

create index if not exists material_chunks_material_id_idx
  on material_chunks(material_id);

create index if not exists material_chunks_embedding_idx
  on material_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table material_processing_jobs enable row level security;
alter table material_chunks enable row level security;

create policy material_processing_jobs_select_teacher
on material_processing_jobs for select
using (
  exists (
    select 1 from classes c
    where c.id = material_processing_jobs.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = material_processing_jobs.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy material_processing_jobs_insert_teacher
on material_processing_jobs for insert
with check (
  exists (
    select 1
    from materials m
    join classes c on c.id = m.class_id
    where m.id = material_processing_jobs.material_id
      and m.class_id = material_processing_jobs.class_id
      and (
        c.owner_id = auth.uid()
        or exists (
          select 1 from enrollments e
          where e.class_id = m.class_id
            and e.user_id = auth.uid()
            and e.role in ('teacher', 'ta')
        )
      )
  )
);

create policy material_processing_jobs_update_teacher
on material_processing_jobs for update
using (
  exists (
    select 1 from classes c
    where c.id = material_processing_jobs.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = material_processing_jobs.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy material_processing_jobs_update_teacher_check
on material_processing_jobs for update
with check (
  exists (
    select 1
    from materials m
    join classes c on c.id = m.class_id
    where m.id = material_processing_jobs.material_id
      and m.class_id = material_processing_jobs.class_id
      and (
        c.owner_id = auth.uid()
        or exists (
          select 1 from enrollments e
          where e.class_id = m.class_id
            and e.user_id = auth.uid()
            and e.role in ('teacher', 'ta')
        )
      )
  )
);

create policy material_processing_jobs_delete_teacher
on material_processing_jobs for delete
using (
  exists (
    select 1 from classes c
    where c.id = material_processing_jobs.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = material_processing_jobs.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy material_processing_jobs_select_admin on material_processing_jobs for select
using (is_admin());

create policy material_chunks_select_teacher
on material_chunks for select
using (
  exists (
    select 1 from classes c
    where c.id = material_chunks.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = material_chunks.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy material_chunks_insert_teacher
on material_chunks for insert
with check (
  exists (
    select 1 from classes c
    where c.id = material_chunks.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = material_chunks.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy material_chunks_update_teacher
on material_chunks for update
using (
  exists (
    select 1 from classes c
    where c.id = material_chunks.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = material_chunks.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy material_chunks_delete_teacher
on material_chunks for delete
using (
  exists (
    select 1 from classes c
    where c.id = material_chunks.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = material_chunks.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy material_chunks_select_admin on material_chunks for select
using (is_admin());

create or replace function set_material_processing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger material_processing_jobs_set_updated_at
before update on material_processing_jobs
for each row
execute function set_material_processing_updated_at();

create or replace function match_material_chunks(
  p_class_id uuid,
  -- NOTE: Update 1536 to match EMBEDDING_DIM in web/.env.local when using different embedding models.
  query_embedding vector(1536),
  match_count int
)
returns table (
  id uuid,
  material_id uuid,
  material_title text,
  source_type text,
  source_index int,
  section_title text,
  text text,
  token_count int,
  similarity float
)
language sql
stable
as $$
  select
    mc.id,
    mc.material_id,
    m.title as material_title,
    mc.source_type,
    mc.source_index,
    mc.section_title,
    mc.text,
    mc.token_count,
    1 - (mc.embedding <=> query_embedding) as similarity
  from material_chunks mc
  join materials m on m.id = mc.material_id
  where mc.class_id = p_class_id
  order by mc.embedding <=> query_embedding
  limit match_count;
$$;
