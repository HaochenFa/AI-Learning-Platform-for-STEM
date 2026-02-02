# Supabase Setup

This folder contains SQL migrations for the core schema.

**Apply migrations**

- Use Supabase CLI or the dashboard SQL editor to apply migrations in order.
- Start with `supabase/migrations/0001_init.sql`.

**Notes**

- Row Level Security is enabled for all tables.
- Policies assume join code enrollment and teacher ownership.
- Use the service role key for server side jobs (never in client code).
- Create a private storage bucket named `materials` for class uploads.
