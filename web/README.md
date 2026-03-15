# STEM Learning Platform (Web)

This is the Next.js 16 (App Router) application for the STEM Learning Platform.

## Requirements

- Node.js 20+
- pnpm

## Setup

1. Copy `web/.env.example` to `web/.env.local` and fill in keys.
2. From the repo root, install dependencies:

```bash
pnpm install
```

3. Run the dev server:

```bash
pnpm dev
```

## Core Features

- Auth with Supabase (email/password; immutable `teacher` or `student` account type)
- Class creation and join code enrollment
- Materials upload with PDF/DOCX/PPTX extraction
- Course Blueprint generation and curation (AI powered; Draft → Overview → Published lifecycle)
- AI powered learning activities: quiz, flashcards, homework help, exam review
- AI chat grounded in blueprint and approved materials (with long-session memory)
- Class chat workspace with teacher monitoring and session management
- Tests written with Vitest

## Notes

- Database migrations live in `supabase/` at the repo root.
- Run Supabase migrations before testing class creation.
- New accounts must choose an immutable account type at signup (`teacher` or `student`).
- Enable Supabase Auth email confirmation so users must verify email before protected access.
- Set `NEXT_PUBLIC_SITE_URL` to the canonical app origin for the active environment.
- In hosted Supabase, configure `Auth -> URL Configuration` with the same Site URL plus localhost and preview redirect URLs.
- Update Supabase email templates to use the SSR auth callback:
  - Confirm signup: `{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
  - Recovery: `{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
- Disable Supabase phone auth provider (phone-based auth is intentionally out of scope).
- Ensure the `materials` storage bucket exists for uploads.
- Configure at least one AI provider with both a chat model and an embedding model.
- Python backend is required for all AI generation, class create/join, class chat workspace,
  and material dispatch. Set `PYTHON_BACKEND_URL` (default: `http://localhost:8001` for local dev)
  and `PYTHON_BACKEND_API_KEY`.
- Configure `PYTHON_BACKEND_CHAT_ENGINE`, `PYTHON_BACKEND_CHAT_TOOL_MODE`,
  and `PYTHON_BACKEND_CHAT_TOOL_CATALOG` for chat behaviour.
- Copy `web/.env.example` to `web/.env.local` — required variables include
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`.
- Supabase Cron dispatches the `material-worker` Edge Function (configured by migration and Vault secrets).
- `POST /api/materials/process` proxies to Python `/v1/materials/process`.
- For full staging + production rollout steps, see `../DEPLOYMENT.md`.
