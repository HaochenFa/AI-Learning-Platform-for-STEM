# DESIGN

**Vision**
Build a production ready STEM learning platform where teachers transform class materials into a structured Course Blueprint that powers student centered activities such as AI chat, quizzes, flashcards, homework assistance, and exam review.

**Target Users**

- Teachers: create and curate course content, assign activities, review outcomes.
- Students: learn through guided tools grounded in class materials.
- Admin: optional. Can be merged into teacher for simplicity.
- Identity model: each account has one immutable global account type (`teacher` or `student`).
  Users who need both personas must use separate accounts.

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

**AI Chat Vertical Slice (Implemented)**

- Open Practice Chat: available to class members when a published blueprint exists. Conversations are session-only and not persisted.
- Chat Assignment Flow:
  - Teacher creates a chat activity + assignment (whole class targeting).
  - Student completes assignment chat and submits transcript + reflection.
  - Teacher reviews submission, records manual score, and adds feedback highlights/comments.
- Context policy: chat responses are grounded in published blueprint + retrieved material chunks.
- Chat model responses are normalized to deterministic JSON and logged in `ai_requests`.

**Quiz Vertical Slice (Implemented)**

- Teacher Quiz Studio:
  - Generate quiz drafts from published blueprint + retrieved materials.
  - Edit MCQ questions (4 choices), answers, and explanations.
  - Publish quiz before assignment (required curation gate).
- Quiz Assignment Flow:
  - Teacher creates whole-class quiz assignments from published quiz activities.
  - Student takes up to 2 attempts (best score policy) with hard due-date lock.
  - Auto-grading computes per-attempt score; answers/explanations reveal after final attempt or lock.
  - Teacher review supports score override and feedback comments/highlights.
- Shared activity infrastructure powers both chat and quiz assignment access/submission workflows.

**Enrollment Modes**

- Primary: join code. Students self enroll using a class code.
- Optional later: admin enrollment if needed.

**Auth And Identity Constraints**

- Email/password is the only authentication method.
- Email verification is required before protected routes and actions.
- Phone auth is disabled and out of scope unless explicitly added later.
- `profiles.account_type` is required and immutable.
- Enrollment roles are constrained by account type:
  - Teacher account: `teacher` or `ta`
  - Student account: `student`

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
- Reject prompt-injection attempts that request hidden instructions, external context, or unrelated class data.

**Material Ingestion + Retrieval**

- Materials are extracted into structured segments (pages, slides, paragraphs).
- Background processing runs OCR and generates embeddings for chunked retrieval.
- Blueprint generation retrieves top-ranked chunks with source metadata instead of raw concatenation.
- Prompt quality and grounding behavior are environment-tunable (`AI_PROMPT_QUALITY_PROFILE`,
  `AI_GROUNDING_MODE`) for safe rollout.

**Blueprint Lifecycle**

- Draft: editable working version.
- Overview (Approved): compiled preview for final review.
- Published: read-only, student-facing blueprint snapshot.
- Canonical Blueprint Snapshot (v2): each blueprint row stores a normalized JSON snapshot
  (`blueprints.content_json`, `blueprints.content_schema_version`) used by downstream AI features.
- Existing relational tables (`topics`, `objectives`) remain the current editor/publish surface and
  are kept in sync for backward compatibility.

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
