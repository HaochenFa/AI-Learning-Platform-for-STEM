# Deployment Guide (Supabase + Vercel)

This runbook deploys the project with two environments:

- `staging` for preview validation
- `production` for live traffic

## 1. Prerequisites

- Node.js 20+
- pnpm 10+
- Supabase CLI (`npx supabase --version`)
- Vercel project connected to this repository

## 2. Create Supabase projects

Create two Supabase projects from the dashboard:

- `stem-learning-platform-staging`
- `stem-learning-platform-production`

For each project, configure:

- Auth email confirmation: enabled
- Phone auth provider: disabled
- Database extensions required by migrations (`pgcrypto`, `vector`, `pgmq`, `pg_net`, `pg_cron`, `vault`)

## 3. Apply migrations to staging

Set your staging context and push schema:

```bash
export SUPABASE_DB_PASSWORD="<staging-db-password>"
npx supabase link --project-ref <STAGING_PROJECT_REF>
npx supabase db push
```

## 4. Apply migrations to production

Set your production context and push schema:

```bash
export SUPABASE_DB_PASSWORD="<production-db-password>"
npx supabase link --project-ref <PRODUCTION_PROJECT_REF>
npx supabase db push
```

## 5. Deploy Supabase Edge Function worker

From repo root:

```bash
npx supabase functions deploy material-worker
```

`supabase/functions/material-worker/config.toml` sets `verify_jwt = false` because dispatch auth is handled via `MATERIAL_WORKER_TOKEN`.

Set function secrets for each project:

```bash
npx supabase secrets set MATERIAL_WORKER_TOKEN="<strong-random-token>"
```

Also set required AI and worker tuning secrets on Supabase (same values used by web app where relevant):

- `AI_PROVIDER_DEFAULT`
- `AI_REQUEST_TIMEOUT_MS` (recommended: `30000`)
- `AI_EMBEDDING_TIMEOUT_MS` (recommended: `30000`)
- `BLUEPRINT_TOTAL_TIMEOUT_MS` (recommended: `120000`)
- `OPENROUTER_API_KEY`, `OPENROUTER_EMBEDDING_MODEL` (and optional metadata envs)
- `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL` (if used)
- `GEMINI_API_KEY`, `GEMINI_EMBEDDING_MODEL` (if used)
- `EMBEDDING_DIM=1536`
- `MATERIAL_WORKER_BATCH=3`
- `MATERIAL_JOB_MAX_ATTEMPTS=5`
- `MATERIAL_JOB_VISIBILITY_TIMEOUT_SECONDS=300`
- `MATERIAL_JOB_LOCK_MINUTES=15`
- `PDF_TEXT_PAGE_LIMIT=40`

## 6. Configure Supabase Vault secrets for dispatch

Run in SQL editor for each project:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<same-material-worker-token>', 'material_worker_token');
```

The migration-created cron job (`material-worker-dispatch-30s`) calls `public.run_material_worker_dispatch()` which reads these secrets to invoke the worker securely.

## 7. Configure Vercel project

In Vercel project settings:

- Root directory: `web`
- Install command: `pnpm install`
- Build command: `pnpm build`

`web/vercel.json` no longer schedules material processing cron.

## 8. Configure Vercel environment variables

Set these in Vercel for both Preview (staging Supabase) and Production (production Supabase):

### Required Supabase

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Legacy fallback names (optional):

- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Required AI (OpenRouter-first)

- `AI_PROVIDER_DEFAULT=openrouter`
- `AI_REQUEST_TIMEOUT_MS=30000`
- `AI_EMBEDDING_TIMEOUT_MS=30000`
- `BLUEPRINT_TOTAL_TIMEOUT_MS=120000`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_EMBEDDING_MODEL`

### Recommended AI metadata

- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`
- `OPENROUTER_BASE_URL` (optional; defaults to OpenRouter API)

### Material processing backend

- `MATERIAL_WORKER_BACKEND=supabase` (default recommended)
- Optional fallback-only route worker secret: `CRON_SECRET`

## 9. Deployment flow

- Pull requests -> Preview deployment (staging env vars)
- Merge to `main` -> Production deployment (production env vars)

## 10. Post-deploy smoke tests

- Register teacher and student accounts
- Teacher creates class and uploads a material
- Material processing reaches `ready` status (without Vercel cron)
- Blueprint generation succeeds
- Student joins class and accesses at least one assignment

## 11. Rollback

- App rollback: promote previous Vercel deployment
- Database rollback: restore from Supabase backup/PITR or forward-fix with a new migration
- Worker rollback: set `MATERIAL_WORKER_BACKEND=legacy` in Vercel and trigger `/api/materials/process` with `CRON_SECRET`
