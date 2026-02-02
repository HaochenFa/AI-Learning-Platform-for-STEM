# AGENTS.md

Project: STEM Learning Platform with GenAI (Teacher + Student workflows)

This document is the operating guideline for all contributors and agents. It defines product intent, non negotiables, and engineering standards so the codebase stays production ready.

**Product Goals**

- Support high school and college STEM subjects without hardcoded subject content.
- Provide full teacher and student workflows that are both usable and production ready.
- Use AI to generate a Course Blueprint from uploaded materials and drive all downstream features.
- Maintain teacher control and transparency for all AI outputs.

**Roles And Scope**

- Teacher: create classes, upload materials, curate blueprint, assign activities, review outcomes.
- Student: use AI chat, quizzes, flashcards, homework assistance, exam review, submit reflections.
- Admin: optional, can be merged into teacher if needed.

**Core Principles**

- Production quality over demo shortcuts.
- Subject agnostic by design. No hardcoded topics or sample content in core logic.
- AI outputs must be editable and auditable.
- Minimal duplication. All activities derive from the same Course Blueprint.

**Stack**

- Frontend and backend: Next.js with TypeScript.
- Data and auth: Supabase Postgres, Supabase Auth, Supabase Storage.
- Deployment: Vercel for the app, Supabase for data and storage.

**Repo Layout**

- `web/` contains the Next.js application.
- `supabase/` contains database migrations and setup notes.

**Architecture Boundaries**

- Web App: UI, role based routing, and client side workflows.
- API Layer: Next.js server actions or API routes. All data writes flow through this layer.
- AI Orchestrator: provider adapters, prompt templates, and safety checks.
- Data Layer: Supabase with row level security and migrations.

**AI Provider Policy**

- Support OpenAI, Google Gemini, and OpenRouter via a provider adapter interface.
- Configuration must be environment driven. No keys in code or committed files.
- A provider can be swapped without changing feature logic.
- Log model name, latency, and token usage for observability.

**Security And Privacy**

- Enforce RBAC in the data layer using Supabase RLS policies.
- Validate inputs on every API route and server action.
- File uploads must be size limited and content type checked.
- Prevent prompt injection by restricting AI context to approved materials and blueprint.
- Do not expose raw student data to other classes or roles.

**Quality Gates**

- Lint and typecheck must pass before merge.
- Critical flows must have tests: auth, blueprint generation, assignments, and student submissions.
- All AI outputs must have deterministic structure and be saved before use.
- Error states and loading states must be first class UI.

**Data Model Essentials**

- User, Role, Class, Enrollment
- Material, Blueprint, Topic, Objective
- Activity, Assignment, Submission
- QuizQuestion, Flashcard, Feedback, Reflection

**Documentation Expectations**

- Update DESIGN.md when architecture or flows change.
- Update ROADMAP.md when milestones shift.
- Keep environment setup in a README if created later.

**Branching And Commits**

- Use small, reviewable changes.
- Commit messages should be descriptive and consistent.
