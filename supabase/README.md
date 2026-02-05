# Supabase Setup

This folder contains SQL migrations for the core schema.

**Apply migrations**

- Use Supabase CLI or the dashboard SQL editor to apply migrations in order.
- The baseline schema is consolidated in `supabase/migrations/0001_init.sql`.
- Historical incremental migrations have been archived to `supabase/migrations_archive/` and are not applied by the CLI.

**Notes**

- Row Level Security is enabled for all tables.
- Policies assume join code enrollment and teacher ownership.
- Use the service role key for server side jobs (never in client code).
- The `materials` storage bucket is created by the baseline migration if it does not exist.
- `material_chunks.embedding` uses `vector(1536)`; if you change embedding models, update the migration and `EMBEDDING_DIM` to match.
