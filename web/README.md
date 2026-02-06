# STEM Learning Platform (Web)

This is the Next.js application for the STEM Learning Platform.

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

## Core Features (WIP)

- Auth with Supabase
- Class creation and join code enrollment
- Materials upload with PDF/DOCX/PPTX extraction (images require vision)
- Course blueprint generation (AI powered)
- AI powered learning activities

## Notes

- Database migrations live in `supabase/` at the repo root.
- Run Supabase migrations before testing class creation.
- Ensure the `materials` storage bucket exists for uploads.
- Configure at least one AI provider with both a chat model and an embedding model.
- Configure a vision model when processing images or low quality scans (OCR fallback).
- Set `CRON_SECRET` to protect `POST /api/materials/process` (requires `x-cron-secret` header). If unset, restrict access at the infrastructure layer (e.g., IP allowlist).
- Schedule `POST /api/materials/process` (for example with Vercel Cron) so queued material jobs are actually processed.
- Tune `VISION_PAGE_CONCURRENCY` to control parallel Vision calls for low-quality PDF pages.
