# STEM Learning Platform with GenAI

Production-ready STEM learning platform where teachers transform class materials into a structured Course Blueprint that powers student activities. The system is subject-agnostic, keeps AI outputs editable and auditable, and centers teacher control.

**Status**
This repo is aligned to the roadmap in `ROADMAP.md`, with core services, blueprint workflows, AI chat, and quiz vertical slices implemented.

**Key Workflows**

- Teacher: create classes, upload materials, generate and curate blueprints, assign activities, review outcomes.
- Student: join classes, use AI chat grounded in the blueprint, complete quizzes and flashcards, request homework help, submit reflections.

**Architecture**

- Next.js app for UI and role-based routing.
- API layer via server actions or API routes for all data writes.
- Optional Python backend adapter (`backend/`) for AI orchestration migration slices.
- AI orchestrator with provider adapters, prompt templates, and safety checks.
- Supabase for Auth, Postgres, Storage, and RLS.

**Blueprint Lifecycle**

- Draft: editable working version.
- Overview: approved preview for final review.
- Published: read-only student-facing snapshot.

**AI Provider Policy**

- Supports OpenAI, Google Gemini, and OpenRouter via a provider adapter interface.
- Configuration is environment-driven, no keys in code or committed files.
- Providers can be swapped without changing feature logic.
- Model name, latency, and token usage are logged for observability.

**Repository Layout**

- `web/`: Next.js application.
- `backend/`: FastAPI backend for optional AI-provider orchestration.
- `supabase/`: database migrations and setup notes.

**Requirements**

- Node.js 20+
- pnpm
- Supabase project (URL, publishable key, secret key)

**Setup**

1. Copy `web/.env.example` to `web/.env.local` and fill in values.
2. Install dependencies from the repo root:

```bash
pnpm install
```

3. Run the dev server from the repo root:

```bash
pnpm dev
```

**Scripts (Repo Root)**

- `pnpm dev`: run Next.js dev server.
- `pnpm build`: build the web app.
- `pnpm start`: run the production server.
- `pnpm lint`: run linting.
- `pnpm test`: run tests.
- `pnpm test:watch`: run tests in watch mode.

**Git Remotes**

- This repository uses two remotes: `origin` and `org`.
- Push active branches to both remotes to keep mirrors aligned:

```bash
git push origin HEAD
git push org HEAD
```

**Database Migrations**

- Apply migrations using the Supabase CLI or dashboard SQL editor.
- The baseline schema is consolidated in `supabase/migrations/0001_init.sql`.
- Historical incremental migrations live in `supabase/migrations_archive/` and are not applied by the CLI.

**Security And Privacy**

- RLS enforced for all tables.
- Inputs validated on every API route and server action.
- File uploads are size-limited and content-type checked.
- AI context restricted to approved materials and the blueprint.
- Material ingestion is queue-driven on Supabase (`pgmq` + Supabase Cron + Edge Function worker) to avoid Vercel Cron plan limits.
- Set Vault secrets `project_url` and `material_worker_token` in Supabase for worker dispatch auth.
- Configure provider-specific embedding models so background material processing can complete.
- `POST /api/materials/process` routes through Python backend `/v1/materials/process`.

**Docs**

- Architecture and flows: `DESIGN.md`.
- Delivery milestones: `ROADMAP.md`.
- Deployment runbook: `DEPLOYMENT.md`.
- Supabase notes: `supabase/README.md`.
- Web app details: `web/README.md`.
