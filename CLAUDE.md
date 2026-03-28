# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

STEM Learning Platform with GenAI - A production-ready educational platform where teachers transform class materials into structured Course Blueprints that power student activities (AI chat, quizzes, flashcards, homework help, exam review).

**Stack**: Next.js 16 (App Router), TypeScript, Supabase (PostgreSQL, Auth, Storage, RLS), Tailwind CSS 4, Vitest

## Common Commands

```bash
pnpm install             # Install all dependencies (from monorepo root)
pnpm dev                # Run Next.js dev server (uses --webpack; required for Next.js 16 + React 19)
pnpm build              # Build for production (--webpack required; turbopack not yet stable)
pnpm start              # Run production server
pnpm lint               # Run ESLint
pnpm test               # Run Vitest unit tests
pnpm test:watch         # Run Vitest in watch mode
pnpm export:mermaid-png # Export Mermaid diagrams in ARCHITECTURE.md as PNG images

# Python backend
pip install -r backend/requirements.txt                                                          # Install Python deps
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8001 --reload                      # Run backend locally
python3 -m unittest discover -s backend/tests -p 'test_*.py'                                    # Run Python tests
```

Run a single Vitest unit test file:

```bash
pnpm vitest run path/to/testfile.test.ts
```

### E2E Tests (Playwright)

E2E tests live in `tests/` and run against a deployed URL (default: Vercel preview/production).

```bash
# First-time setup
pnpm exec playwright install          # Install browser binaries
cp tests/.env.example tests/.env     # Fill in credentials (gitignored)

# Run all E2E tests
npx playwright test --config tests/playwright.config.ts

# Run a single spec
npx playwright test --config tests/playwright.config.ts tests/e2e/teacher-nav.spec.ts

# Open HTML report after a run
npx playwright show-report tests/results/html-report
```

Required env vars in `tests/.env`:

| Variable | Description |
|----------|-------------|
| `E2E_BASE_URL` | Target URL (defaults to Vercel deployment) |
| `E2E_TEACHER_EMAIL` / `E2E_TEACHER_PASSWORD` | Teacher test account |
| `E2E_STUDENT_EMAIL` / `E2E_STUDENT_PASSWORD` | Student test account (optional) |
| `E2E_JOIN_CODE` | Valid class join code (optional; skips join-class test if absent) |

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

## Key File Paths

| Purpose | Path |
|---------|------|
| Supabase browser client | `web/src/lib/supabase/client.ts` |
| Supabase server client | `web/src/lib/supabase/server.ts` |
| AI adapter entry (Next.js → Python) | `web/src/lib/ai/python-backend.ts` |
| Server actions (root) | `web/src/app/actions.ts` |
| Activity access/assignments | `web/src/lib/activities/` |
| Analytics/class insights | `backend/app/analytics.py` |
| Global styles & design tokens | `web/src/app/globals.css` |
| Auth session helpers (server-side) | `web/src/lib/auth/session.ts` |
| Auth URL/redirect helpers | `web/src/lib/auth/ui.ts` |
| Auth surface (modal + page) | `web/src/components/auth/AuthSurface.tsx` |
| Guest mode config + utilities | `web/src/lib/guest/` |
| Supabase email templates | `supabase/templates/` |
| E2E test specs | `tests/e2e/` |
| Playwright config | `tests/playwright.config.ts` |

## Architecture

**Monorepo Structure**:

- `web/` - Next.js application with App Router
- `backend/` - Python FastAPI service for AI provider orchestration
- `supabase/` - Database migrations and Supabase configuration
- `tests/` - Playwright E2E test suite (runs against deployed URL)

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
   - `NEXT_PUBLIC_SITE_URL` (e.g. `http://localhost:3000`; used for auth email redirect links)
   - At least one AI provider key: `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY`
   - `PYTHON_BACKEND_URL` (default: `http://localhost:8001` for local dev)
   - `PYTHON_BACKEND_API_KEY` (leave blank for local dev — backend allows unauthenticated by default)
3. Optional variables:
   - `NEXT_PUBLIC_GUEST_MODE_ENABLED` — set `true` to enable the guest entry flow (off by default)

## Key Design Patterns

**Blueprint Lifecycle**: Draft → Overview (Approved) → Published (read-only, student-facing)

**AI Provider Policy**: Pluggable adapter interface supporting OpenAI, Gemini, OpenRouter. Configuration is environment-driven. Providers can be swapped without changing feature logic.

**Python Backend**: All AI generation (blueprints, quiz, flashcards, chat, embeddings) routes through the FastAPI `backend/` service. Next.js server actions call `web/src/lib/ai/python-*.ts` adapters, which proxy to the backend. Never call AI providers directly from Next.js. Response envelope is always `{ ok, data, error, meta }`.

**Canvas / Generative Layout**: `backend/app/canvas.py` supports AI-driven layout generation for the student chat view and teacher insights panel. Layouts are generated per-session using the blueprint as context.

**Class Analytics**: `backend/app/analytics.py` + migration `0013_add_class_insights_snapshots.sql` persist aggregated class intelligence snapshots for the teacher dashboard.

**Auth Surface**: A single `AuthSurface` component handles all auth flows (sign-in, sign-up, forgot-password). It renders as a **modal** on the home page (triggered by `?auth=sign-in` / `?auth=sign-up` query params) or as a **page** at `/login` and `/register`. The `HomeAuthDialog` wraps the modal variant. Auth helpers live in `web/src/lib/auth/ui.ts` (`getAuthHref`, `buildRedirectUrl`) and `session.ts` (`getAuthContext`).

**Guest Mode**: Toggled by `NEXT_PUBLIC_GUEST_MODE_ENABLED=true`. Guests sign in via Supabase Anon Auth and get a sandboxed session (8h max, 1h inactivity, 5 sessions/hour rate limit). The entry flow is at `/guest/enter`. Guest mode is enforced at the DB layer via RLS (migrations `0015`–`0021`). Guest config lives in `web/src/lib/guest/`.

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

## Plans and Trackers

- Store all implementation plans, session trackers, and working notes under `.claude/plans/` — not in `docs/` or the repo root.
- `.claude/` is gitignored-safe for local-only files and avoids branch noise for plan files that don't belong in PR diffs.

## Important Notes

- Email/password auth only; `profiles.account_type` is immutable (teacher or student)
- Guest sessions use Supabase Anon Auth — not email/password. They are sandboxed and expire automatically.
- Material ingestion is queue-driven on Supabase (`pgmq` + Edge Function worker)
- Chat uses long-session context engineering with memory compaction
- All AI outputs are saved before use and are editable/auditable by teachers
- Branded confirmation email template lives in `supabase/templates/confirmation.html` (must be applied in Supabase Dashboard → Auth → Email Templates)

## Lessons Learned

- **Edge Function Secrets**: When using AI providers (like `OPENROUTER_*`) in Supabase Edge Functions, secrets must be set in **Edge Function Secrets** (in Supabase Dashboard → Edge Functions → Secrets), not in the Vault. Edge Functions cannot access Vault secrets.
- **Vercel + Supabase Integration**: While the Vercel + Supabase integration plugin allows Vercel to access Supabase secrets, the reverse is not true—Supabase Edge Functions cannot access secrets stored in Vercel. All secrets required by Edge Functions must be configured directly in Supabase.
- **httpx trust_env**: All `httpx.Client(...)` calls in the Python backend must include `trust_env=False` to avoid picking up proxy env vars in production; omitting it causes silent connection failures in certain deploy environments.
- **Cursor pagination validation**: Cursor tokens passed to PostgREST must be validated as UUID + ISO-8601 format before string interpolation to prevent injection. See `backend/app/chat_workspace.py`.
- **Message timestamp ordering**: When persisting user + assistant message pairs, offset assistant timestamp by 1ms to guarantee correct ordering in queries that sort by `created_at`.
- **Supabase Storage iframe embedding**: Supabase Storage serves files with `X-Frame-Options` headers that block cross-origin iframe embedding. Never use signed URLs directly as iframe `src`. Instead, fetch the file as a blob via `fetch(signedUrl)`, create a same-origin blob URL with `URL.createObjectURL(blob)`, and use that. Always clean up with `URL.revokeObjectURL()` in both the dialog close handler and a `useEffect` cleanup. See `MaterialActionsMenu.tsx` for the reference implementation.
- **CSS keyframes + Tailwind v4 centering**: Tailwind v4 applies centering via the standalone CSS `translate` property (not inside `transform`). Keyframe `transform` values must therefore contain only scale/Y-offset; never embed `-50% -50%` centering offsets inside a `@keyframes` block — doing so fights the framework and breaks dialog positioning.
