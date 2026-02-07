-- Canonical blueprint snapshot for richer AI-grounded downstream features.
alter table public.blueprints
  add column if not exists content_json jsonb not null default '{}'::jsonb;

alter table public.blueprints
  add column if not exists content_schema_version text not null default 'v2';
