# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

STEM Learning Platform with GenAI - A production-ready educational platform where teachers transform class materials into structured Course Blueprints that power student activities (AI chat, quizzes, flashcards, homework help, exam review).

**Stack**: Next.js 16 (App Router), TypeScript, Supabase (PostgreSQL, Auth, Storage, RLS), Tailwind CSS 4, Vitest

## Common Commands

```bash
pnpm install        # Install all dependencies
pnpm dev           # Run Next.js development server
pnpm build         # Build for production
pnpm start         # Run production server
pnpm lint          # Run ESLint
pnpm test          # Run tests
pnpm test:watch    # Run tests in watch mode

# Python backend
pip install -r backend/requirements.txt                                                          # Install Python deps
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8001 --reload                      # Run backend locally
python3 -m unittest discover -s backend/tests -p 'test_*.py'                                    # Run Python tests
```

Run a single test file:

```bash
pnpm vitest run path/to/testfile.test.ts
```

## Git Remotes

- This repository has two configured remotes for push/fetch: `origin` and `org`.
- When pushing a branch, push to both remotes so they stay synchronized.
- Recommended commands:

```bash
git push origin HEAD
git push org HEAD
```

## Deployment Commands

### Vercel (Frontend/App)

```bash
cd web/

# Check Vercel version
npx vercel --version

# Check logged-in user
npx vercel whoami

# Deploy to production
npx --yes vercel --yes --prod

# Deploy to preview (staging)
npx vercel

# View deployment logs
npx vercel logs ai-stem-learning-platform-group-8

# Inspect a deployment
npx vercel inspect <deployment-url>
```

### Supabase (Database/Backend)

```bash
# Link to Supabase project
supabase link --project-ref <project-ref>

# Apply migrations
supabase db push

# Create new migration
supabase migration new migration_name

# Start local Supabase instance
supabase start

# View Supabase logs
supabase functions logs <function-name>
```

Apply migrations via MCP (if configured):

```bash
# Use the supabase MCP tool to execute SQL
mcp__supabase__execute_sql --sql "SELECT 1"
```

## Architecture

**Monorepo Structure**:

- `web/` - Next.js application with App Router
- `backend/` - Python FastAPI service for AI provider orchestration
- `supabase/` - Database migrations and Supabase configuration

**Key Boundaries**:

- Web App: UI, role-based routing, client-side workflows
- API Layer: Server actions and API routes for all data writes
- AI Orchestrator: Provider adapters (OpenAI, Gemini, OpenRouter), prompt templates, safety checks
- Data Layer: Supabase with Row Level Security (RLS) policies

## Database

- Apply migrations via Supabase CLI or dashboard SQL editor
- Baseline schema: `supabase/migrations/0001_init.sql`
- Incremental migrations in `supabase/migrations/`

## Environment Setup

1. Copy `web/.env.example` to `web/.env.local`
2. Required variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - At least one AI provider key: `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY`
   - `PYTHON_BACKEND_URL` (default: `http://localhost:8001` for local dev)
   - `PYTHON_BACKEND_API_KEY` (required when `PYTHON_BACKEND_ALLOW_UNAUTHENTICATED_REQUESTS=false`)

## Key Design Patterns

**Blueprint Lifecycle**: Draft → Overview (Approved) → Published (read-only, student-facing)

**AI Provider Policy**: Pluggable adapter interface supporting OpenAI, Gemini, OpenRouter. Configuration is environment-driven. Providers can be swapped without changing feature logic.

**Python Backend**: All AI generation (blueprints, quiz, flashcards, chat, embeddings) routes through the FastAPI `backend/` service. Next.js server actions call `web/src/lib/ai/python-*.ts` adapters, which proxy to the backend. Never call AI providers directly from Next.js. Response envelope is always `{ ok, data, error, meta }`.

**Security**: RLS enforced on all tables, input validation on every API route and server action, file uploads are size-limited and content-type checked. AI context restricted to approved materials and blueprint.

## Frontend UI Conventions

- Shared UI primitives live in `web/src/components/ui` and should be preferred over ad-hoc page-local controls.
- Utility helpers and variant merging:
  - `web/src/lib/utils.ts` (`cn`)
  - `class-variance-authority` patterns for variant-driven components
- Icons should be consumed from `web/src/components/icons/index.tsx` (Lucide registry) rather than inline SVG in pages/components, except approved exceptions (brand mark and semantic diagrams).
- Motion should use:
  - global provider: `web/src/components/providers/motion-provider.tsx`
  - reusable variants/transitions: `web/src/lib/motion/presets.ts`
- Preserve semantic warm tokens in `web/src/app/globals.css`; avoid introducing hardcoded color classes where token utilities exist.

## Session Handoff

- UI refactor handoff and current progress are tracked in `UI_REFACTOR_SESSION_CATCHUP.md`.
- High-level phase tracker remains in `UI_REFACTOR_TRACKER.md`.

## Plans and Trackers

- Store all implementation plans, session trackers, and working notes under `.claude/plans/` — not in `docs/` or the repo root.
- `.claude/` is gitignored-safe for local-only files and avoids branch noise for plan files that don't belong in PR diffs.

## Important Notes

- Email/password auth only; `profiles.account_type` is immutable (teacher or student)
- Material ingestion is queue-driven on Supabase (`pgmq` + Edge Function worker)
- Chat uses long-session context engineering with memory compaction
- All AI outputs are saved before use and are editable/auditable by teachers

## Lessons Learned

- **Edge Function Secrets**: When using AI providers (like `OPENROUTER_*`) in Supabase Edge Functions, secrets must be set in **Edge Function Secrets** (in Supabase Dashboard → Edge Functions → Secrets), not in the Vault. Edge Functions cannot access Vault secrets.
- **Vercel + Supabase Integration**: While the Vercel + Supabase integration plugin allows Vercel to access Supabase secrets, the reverse is not true—Supabase Edge Functions cannot access secrets stored in Vercel. All secrets required by Edge Functions must be configured directly in Supabase.
- **httpx trust_env**: All `httpx.Client(...)` calls in the Python backend must include `trust_env=False` to avoid picking up proxy env vars in production; omitting it causes silent connection failures in certain deploy environments.
- **Cursor pagination validation**: Cursor tokens passed to PostgREST must be validated as UUID + ISO-8601 format before string interpolation to prevent injection. See `backend/app/chat_workspace.py`.
- **Message timestamp ordering**: When persisting user + assistant message pairs, offset assistant timestamp by 1ms to guarantee correct ordering in queries that sort by `created_at`.
