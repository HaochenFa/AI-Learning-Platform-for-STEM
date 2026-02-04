-- Enforce a single draft per class to prevent concurrent draft creation.
-- Clean up any existing duplicate drafts per class before creating the index.
with ranked_drafts as (
  select
    id,
    class_id,
    row_number() over (
      partition by class_id
      order by version desc, created_at desc, id desc
    ) as rn
  from blueprints
  where status = 'draft'
)
update blueprints b
set status = 'archived'
from ranked_drafts r
where b.id = r.id
  and r.rn > 1;

create unique index if not exists blueprints_single_draft_per_class
  on blueprints (class_id)
  where status = 'draft';
