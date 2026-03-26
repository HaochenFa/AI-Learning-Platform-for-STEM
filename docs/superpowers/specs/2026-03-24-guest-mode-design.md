# Guest Mode Design

Date: 2026-03-24
Topic: Guest mode for graders and first-time touring
Status: Approved design

## Goal

Add a guest mode that lets graders and first-time visitors explore the product without signup or login.

Guest mode should:
- start from a homepage CTA
- open into a curated sample experience
- allow switching between teacher and student roles
- let guests use live product features
- allow full teacher-side permissions within guest mode
- preserve changes temporarily for the current guest session
- discard guest work on signup instead of migrating it

## Product Intent

This is not a read-only demo mode. It is a guest mode for touring the actual product experience with realistic, curated starter content.

The experience should feel like the real app, but all guest activity must remain isolated from real user-owned data and from other guest sessions.

## Chosen Approach

Use a first-class guest session with a disposable sandbox workspace seeded from curated sample data.

Why this approach:
- supports full exploration without requiring signup
- keeps guest writes separate from production user data
- supports role switching in one session
- matches the existing auth-first architecture better than broad anonymous route exceptions

## Implementation Decisions

These decisions were resolved during design review and are binding for the implementation plan.

### Guest identity mechanism: Supabase Anonymous Auth

Use `supabase.auth.signInAnonymously()` to create a real `auth.users` row with `is_anonymous=true`. The guest receives a real Supabase JWT, so existing middleware, RLS policies, and server actions work with incremental changes rather than a parallel auth path.

- The anonymous user’s profile row is created via the existing `sync_profile_from_auth_user` trigger
- Sandbox ID is stored in a `guest_sandboxes` table linked to the anonymous user’s ID
- The `getAuthContext()` helper is extended to detect anonymous users and attach sandbox context
- A cleanup job deletes expired anonymous users and their sandbox data

### Sandbox isolation strategy: Full clone on session start

When a guest session starts, clone all canonical seed rows into the same production tables with a new `sandbox_id` and remapped UUIDs. No overlay resolution logic — guest queries simply filter by `sandbox_id`.

- Estimated ~50–200 rows cloned per sandbox
- All foreign keys are remapped to new UUIDs during cloning
- Storage assets (materials) reference the same immutable seed files (no copy unless guest modifies)
- Cleanup: `DELETE WHERE sandbox_id = :expired_sandbox` cascades through FK relationships

### Seed data: SQL migration with canonical rows

A dedicated migration inserts the canonical seed dataset into regular tables with a well-known seed sandbox ID (`00000000-0000-0000-0000-000000000000`). The clone function copies from these rows.

- Seed data is versioned in git alongside schema migrations
- Content is synthetic and demo-safe (no real PII)
- Seed includes: class, materials (with pre-embedded chunks), published blueprint + topics + objectives, activities (quiz, flashcards, chat), assignments, sample submissions, and analytics snapshots

### Session lifecycle: 1 hour inactive / 8 hour max

- Inactivity timeout: 1 hour (no requests from any tab)
- Maximum sandbox lifetime: 8 hours from creation
- Cleanup job runs every 15 minutes
- Browser restart within lifetime: restore the same sandbox (anonymous session persists in cookie)

### AI rate limits per guest session

| Feature | Limit |
|---------|-------|
| Chat messages | 50 |
| Quiz generations | 5 |
| Flashcard generations | 10 |
| Blueprint regenerations | 3 |
| Embedding operations | 0 (use pre-embedded seed) |

Global safety:
- Max 20 concurrent guest AI operations across all guests
- IP-level: max 5 guest sessions per hour
- Friendly limit-reached messages with signup CTA

## Core Design

### 1. Session model

Introduce guest mode as a first-class session type rather than treating guests as unauthenticated visitors.

The app should be able to distinguish between:
- authenticated teacher
- authenticated student
- guest teacher view
- guest student view

A guest session should be tied to a sandbox id. The sandbox id represents that guest’s temporary workspace.

#### Guest identity and trust boundary

The sandbox id must never be treated as a user-controlled identifier.

Requirements:
- guest session creation must issue a server-generated sandbox id
- the guest cookie or token must be signed or otherwise tamper-evident (satisfied by Supabase Anonymous Auth JWT)
- every server-side guest request must validate both the guest session and the sandbox id before data access
- sandbox ids must be unguessable and rotate only through server-controlled flows such as reset
- requests from expired or invalid guest sessions must fail closed and redirect back to guest entry

This keeps guest mode safe from sandbox hopping or forged guest identity claims.

### 2. Entry and UX

Guest mode starts from a visible homepage CTA such as `Continue as guest`.

On entry:
- create a guest session
- create or initialize a sandbox for that session
- redirect into the guest workspace

The UI should make guest mode explicit:
- persistent guest mode badge or banner
- explanation that work is temporary
- role switcher between teacher and student views
- create account CTA always available
- optional reset guest session action

### 3. Role switching

Guests should be able to switch between teacher and student roles during the same guest session.

Role switching should:
- preserve the same sandbox id
- swap the active perspective in the UI
- expose the same sandbox class from each role’s viewpoint

This should feel like moving between two sides of the same classroom experience rather than entering separate demos.

### 4. Seed data

Prepare a curated sample dataset that includes:
- a sample class
- uploaded course materials
- a published blueprint
- assigned activities
- sample student submissions
- enough historical data to power teacher analytics features

This dataset acts as the ideal starting point for each guest session.

Seed data requirements:
- all guest-mode seed content must be synthetic, anonymized, or otherwise explicitly approved as non-sensitive
- no real student, teacher, or classroom PII should appear in guest materials, submissions, analytics fixtures, or generated examples
- guest-visible storage assets and seeded records must be reviewed as demo-safe content before launch

### 5. Sandbox isolation

Guest data is separated into two layers:

#### Stable seed layer
A canonical curated dataset stored in regular tables with the well-known seed sandbox ID (`00000000-0000-0000-0000-000000000000`). This data is inserted via SQL migration, never modified at runtime, and acts as the template for every guest session.

#### Session-scoped sandbox layer
A full clone of the seed dataset created when a guest session starts. Each sandbox gets a unique `sandbox_id` (UUID). All seed rows are copied with remapped primary keys and foreign keys so the cloned dataset is relationally self-consistent.

Guest-created or guest-modified artifacts live in the sandbox layer. The canonical seed layer is never mutated by guest activity.

There is no overlay resolution logic. Guest queries filter by `sandbox_id` — the same query patterns used by real users, plus one additional filter.

Relational integrity requirements:
- every sandbox-owned row carries its `sandbox_id`
- cross-table reads filter within the same sandbox boundary
- foreign-key relationships between sandbox records are internally consistent (remapped during clone)
- all entity groups use the full-clone strategy (no mixed overlay/clone)
- analytics, submissions, activities, chat, and blueprint-related joins must never combine guest rows with production user-owned rows

Storage isolation requirements:
- seed materials stored in object storage must be read through guest-safe access paths
- any guest-created or guest-modified file artifacts must be written to sandbox-scoped storage paths
- signed URL generation for guest mode must only expose sandbox-safe or immutable seed assets
- if materials can be edited or replaced in guest mode, storage behavior must use copy-on-write semantics rather than mutating canonical seed files

At minimum, sandbox scope must cover:
- class edits
- blueprint edits and regenerated outputs
- created or edited activities
- assignment attempts and quiz answers
- chat interactions
- analytics inputs derived from guest activity
- all teacher-side mutations performed in guest mode

### 6. Permissions

Guests should have full permissions inside guest mode, but only within their sandbox.

Guest mode should allow:
- viewing and editing the curated class within sandbox scope
- using live AI-backed features inside sandbox scope
- creating and editing activities inside sandbox scope
- triggering and viewing analytics inside sandbox scope
- using student-side assignment, quiz, flashcard, and chat flows inside sandbox scope

Guest mode should block access to:
- real account settings and profile management
- real class join and enrollment flows
- production data outside the guest sandbox
- any feature that depends on a permanent user identity rather than a sandbox actor

#### Guest abuse and cost controls

Because guest mode exposes live AI-backed functionality without signup, implementation must include explicit safety and spend guardrails.

Requirements:
- apply rate limits to guest sessions and enforce them server-side
- bound concurrent guest AI operations so one guest cannot monopolize generation capacity
- define spend-aware limits for guest activity volume, regeneration frequency, or session-level AI usage
- fail gracefully when limits are reached, with guest-facing messaging instead of silent failure
- ensure abuse controls are tied to guest session identity and at least one secondary signal such as IP or device-level heuristics, subject to project privacy constraints

#### Database enforcement

Application-layer capability checks are required but are not sufficient on their own.

The implementation must also enforce guest sandbox boundaries at the data layer:
- Supabase queries and policies must constrain guest access to sandbox-owned records only
- guest actors must never receive broad access to production tables without sandbox filtering
- any route or server action that reads or writes guest data must preserve the same sandbox boundary used by the page-level actor context
- RLS and query constraints must fail closed when guest session context is missing or invalid

### 7. Auth and enforcement direction

The existing auth helpers should be extended so the application can return a normalized actor context for either:
- a verified real user
- a guest sandbox actor

Authorization should be capability-based rather than implemented as route-by-route guest exceptions.

Pages and actions should be able to ask for things like:
- teacher-capable actor
- student-capable actor
- sandbox-bound class access
- real-account-only access

This keeps guest mode centralized and reduces scattered `if guest` logic.

### 8. Temporary persistence and disposal

Guest changes should persist temporarily for the current guest session.

Lifecycle rules:
- sandbox is created at guest entry
- sandbox persists across role switching for that session
- sandbox expires automatically after inactivity or max age
- sandbox can be manually reset by the guest
- sandbox is discarded on signup rather than migrated

Concrete lifecycle requirements:
- inactivity timeout: 1 hour (no requests from any tab)
- maximum sandbox lifetime: 8 hours from creation
- cleanup job runs every 15 minutes to expire stale sandboxes
- opening multiple tabs in the same browser session must continue to target the same sandbox until reset or expiry
- browser restart within sandbox lifetime restores the same sandbox (anonymous session persists in Supabase cookie)
- reset must provision a new sandbox id and prevent further writes to the old sandbox
- expired sandboxes must reject further requests even if a stale tab is still open

Signup discard requirements:
- signup must sever the guest session from its sandbox before the new real account becomes active
- once signup succeeds, old guest tabs must no longer be able to write into the discarded sandbox
- discard and transition behavior must fail closed if any step is invalid or incomplete

This preserves realism during exploration while keeping the baseline sample experience clean for future guests.

## Testing Strategy

Prioritize tests for:

1. Guest session creation
- homepage CTA creates a guest session and sandbox
- guest lands in the expected seeded workspace

2. Role switching
- teacher and student switching preserves the same sandbox
- both roles see consistent sandbox state

3. Isolation
- guest writes never mutate the canonical seed dataset
- one guest sandbox never leaks into another sandbox
- guest cannot access real account-only areas or non-sandbox classes

4. Live feature behavior
- teacher-side editing and generation work inside sandbox scope
- student-side submissions and chat flows generate sandbox-scoped outputs
- analytics update from sandbox-scoped inputs

5. Disposal
- reset returns the sandbox to the baseline state
- signup discards guest work instead of migrating it

## Rollout Strategy

### Phase 1
- homepage guest CTA
- guest session creation
- seeded sandbox landing experience

### Phase 2
- role switching
- core teacher and student navigation through the guest sandbox

### Phase 3
- full editing permissions
- live AI flows
- analytics support in sandbox scope

### Phase 4
- reset and cleanup polish
- messaging and UX improvements
- operational cleanup for sandbox expiry

## Key Invariants

These should remain true throughout implementation:
- guest mode is not broad anonymous access to the app
- guest mode is a first-class temporary session type
- all guest writes are sandbox-scoped
- seed data remains canonical and unchanged by guests
- guests may switch roles, but stay within one sandbox
- guest work is temporary and discarded on signup

## Out of Scope for V1

- migrating guest work into a newly created account
- exposing real user classes or production records to guests
- shared persistent guest state across visitors

## Recommendation Summary

Build guest mode as a sandbox-backed guest session entered from the homepage. Seed it with a curated class and analytics-ready sample activity data. Let guests switch between teacher and student roles and use live features with full permissions inside the sandbox, while keeping all writes temporary and isolated from production data.
