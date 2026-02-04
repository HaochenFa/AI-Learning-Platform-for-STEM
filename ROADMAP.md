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

**Phase 2 - Activity Engine**

- Topic graph and activity generation pipeline.
- Unified schema for activities and assignments.
- Student submission storage and retrieval.
- Teacher review and feedback workflow.

**Phase 3 - Feature Modules**

- AI conversation grounded in blueprint and materials.
- Quizzes generated from blueprint topics with explanations.
- Flashcards generated from key concepts and formulas.
- Homework assistance with scaffolded hints.
- Exam review plan based on topic mastery.

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
