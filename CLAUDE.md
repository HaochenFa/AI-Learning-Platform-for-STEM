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
```

Run a single test file:

```bash
pnpm vitest run path/to/testfile.test.ts
```

## Architecture

**Monorepo Structure**:

- `web/` - Next.js application with App Router
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

## Key Design Patterns

**Blueprint Lifecycle**: Draft → Overview (Approved) → Published (read-only, student-facing)

**AI Provider Policy**: Pluggable adapter interface supporting OpenAI, Gemini, OpenRouter. Configuration is environment-driven. Providers can be swapped without changing feature logic.

**Security**: RLS enforced on all tables, input validation on every API route and server action, file uploads are size-limited and content-type checked. AI context restricted to approved materials and blueprint.

## Important Notes

- Email/password auth only; `profiles.account_type` is immutable (teacher or student)
- Material ingestion is queue-driven on Supabase (`pgmq` + Edge Function worker)
- Chat uses long-session context engineering with memory compaction
- All AI outputs are saved before use and are editable/auditable by teachers

## Lessons Learned

- **Edge Function Secrets**: When using AI providers (like `OPENROUTER_*`) in Supabase Edge Functions, secrets must be set in **Edge Function Secrets** (in Supabase Dashboard → Edge Functions → Secrets), not in the Vault. Edge Functions cannot access Vault secrets.
- **Vercel + Supabase Integration**: While the Vercel + Supabase integration plugin allows Vercel to access Supabase secrets, the reverse is not true—Supabase Edge Functions cannot access secrets stored in Vercel. All secrets required by Edge Functions must be configured directly in Supabase.
