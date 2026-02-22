# ROADMAP

This roadmap focuses on production ready delivery with subject agnostic functionality. Scope is layered by core services first, then feature modules.

**Phase 0 - Project Setup**

- Confirm stack and hosting.
- Create repo structure and base configuration.
- Define environment variables for AI providers and Supabase.
- Establish CI for lint, typecheck, and tests.

**Phase 1 - Core Services**

- Auth and RBAC with teacher and student roles.
- Class creation and enrollment via join code.
- Material upload, parsing, and storage.
- Course Blueprint generation and versioning.
- Blueprint editor with draft -> overview (approved) -> published workflow.
- Status update: Auth hardening complete with verified-email gates, immutable global account
  types (`teacher`/`student`), split teacher/student dashboards, and enrollment escalation
  protections at the database layer.

**Phase 2 - Activity Engine**

- Topic graph and activity generation pipeline.
- Unified schema for activities and assignments.
- Student submission storage and retrieval.
- Teacher review and feedback workflow.
- Status update: AI Chat assignment workflow implemented with whole-class targeting,
  transcript + reflection submissions, and teacher manual review/score flow.

**Phase 3 - Feature Modules**

- AI conversation grounded in blueprint and materials.
- Quizzes generated from blueprint topics with explanations.
- Flashcards generated from key concepts and formulas.
- Homework assistance with scaffolded hints.
- Exam review plan based on topic mastery.
- Status update: Always-on AI Chat is implemented with persistent sessions,
  student chat-focused workspace transformation, and teacher chat monitoring.
- Status update: Always-on AI Chat now uses recency-first message retrieval with pagination and
  hybrid context compaction (recent turns + persisted memory summary) for long-running sessions.
- Status update: Quiz vertical slice is implemented with draft generation, teacher curation + publish,
  whole-class assignment, 2-attempt best-score policy, auto-grading, and teacher override review.
- Flashcards, homework assistance, and exam review remain next.

**Phase 4 - Product Quality**

- Comprehensive error handling and UI states.
- Rate limiting and quota controls per class.
- Observability for AI usage, latency, and errors.
- Basic analytics for progress and engagement.
- Accessibility and responsive design.

**Phase 5 - Final Delivery**

- Deployment to Vercel and Supabase.
- Production readiness review.
- Final documentation and user manual.
- Video walkthrough and slides.

**Acceptance Criteria For Production Ready**

- All role based permissions enforced by RLS.
- All AI outputs are saved and editable before student access.
- No feature depends on hardcoded subject content.
- Critical flows have automated tests.
- System remains usable under partial failures with clear recovery paths.
