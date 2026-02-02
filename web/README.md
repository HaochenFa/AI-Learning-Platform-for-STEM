# STEM Learning Platform (Web)

This is the Next.js application for the STEM Learning Platform.

## Requirements
- Node.js 20+
- pnpm

## Setup
1. Copy `web/.env.example` to `web/.env.local` and fill in keys.
2. Run the dev server:

```bash
pnpm dev
```

## Core Features (WIP)
- Auth with Supabase
- Class creation and join code enrollment
- Course blueprint generation (AI powered)
- AI powered learning activities

## Notes
- Database migrations live in `supabase/` at the repo root.
- Run Supabase migrations before testing class creation.
- Configure at least one AI provider and model (OpenRouter recommended).
