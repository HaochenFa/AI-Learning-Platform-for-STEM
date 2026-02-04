# DESIGN

**Vision**
Build a production ready STEM learning platform where teachers transform class materials into a structured Course Blueprint that powers student centered activities such as AI chat, quizzes, flashcards, homework assistance, and exam review.

**Target Users**

- Teachers: create and curate course content, assign activities, review outcomes.
- Students: learn through guided tools grounded in class materials.
- Admin: optional. Can be merged into teacher for simplicity.

**Key Product Ideas**

- Subject agnostic by design. All features derive from uploaded materials.
- Course Blueprint is the source of truth for all activity generation.
- Teacher control is explicit. AI outputs are editable and auditable.

**Primary Flows**
Teacher Flow

- Create class and configure settings.
- Upload materials and generate blueprint.
- Edit draft, approve for overview, and publish blueprint.
- Generate and assign activities.
- Review submissions and AI feedback.

Student Flow

- Join class and view assigned activities.
- Use AI chat grounded in blueprint.
- Complete quizzes and flashcards.
- Request scaffolded homework help.
- View exam review plan and submit reflections.

**Enrollment Modes**

- Primary: join code. Students self enroll using a class code.
- Optional later: admin enrollment if needed.

**System Architecture**

- Next.js App: UI, routing, and role based layouts.
- API Layer: server actions or API routes for all data writes.
- AI Orchestrator: provider adapters, prompt templates, safety checks.
- Supabase: Auth, Postgres, Storage, Row Level Security.

**AI Provider Support**

- OpenAI, Google Gemini, OpenRouter via a provider adapter interface.
- Provider selection stored per class or per request.
- All prompts and outputs are logged with metadata.

**AI Safety And Guardrails**

- Restrict AI context to approved materials and blueprint.
- Normalize prompts into structured JSON outputs.
- Apply refusal rules for unsafe or irrelevant requests.

**Blueprint Lifecycle**

- Draft: editable working version.
- Overview (Approved): compiled preview for final review.
- Published: read-only, student-facing blueprint snapshot.

**Data Model**
Core Entities

- User, Role, Class, Enrollment
- Material, Blueprint, Topic, Objective
- Activity, Assignment, Submission
- QuizQuestion, Flashcard, Feedback, Reflection

Relationship Rules

- A Class owns Materials and Blueprints.
- A Blueprint owns Topics and Objectives.
- Activities are generated from Topics.
- Assignments connect Activities to Students.

**Non Functional Requirements**

- Performance: sub 2 second response for common actions.
- Reliability: safe retries for AI generation and file parsing.
- Security: RLS enforced for all tables.
- Observability: log AI usage, errors, and generation failures.

**UX Principles**

- Teacher Studio and Student Hub are distinct and intentional.
- AI output is presented as structured modules, not raw text.
- All actions have visible status and error states.
