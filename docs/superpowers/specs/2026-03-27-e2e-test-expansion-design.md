# E2E Test Expansion — Core Happy Paths

**Date**: 2026-03-27
**Branch**: `feat/more-e2e-test`
**Scope**: 6 new Playwright specs covering student flows, auth lifecycle, settings, and guest mode entry

---

## Context

PR #12 introduced Playwright E2E tests covering 3 teacher-side flows (sidebar nav, class creation, class detail). After merging and cleanup, an audit revealed zero coverage for student flows, sign-out, settings forms, and the recently-shipped guest mode. This spec defines the next batch of tests to close those gaps.

## Approach

**Per-feature spec files** — one spec per page/feature, consistent with the existing `teacher-*.spec.ts` pattern. Each spec is fully independent; no spec depends on another's side effects.

**Environment**: All tests are env-configurable via `E2E_BASE_URL`. Default targets the Vercel deployment but works with local dev server.

---

## New Specs

### 1. `student-login.spec.ts`

**Purpose**: Verify student authentication and dashboard rendering.

- Login with `E2E_STUDENT_EMAIL` / `E2E_STUDENT_PASSWORD` via `loginAsStudent()` helper
- Assert URL matches `/student/dashboard`
- Assert `.editorial-title` heading contains "Welcome"
- Assert "Join class" link is visible (dashboard CTA)

### 2. `student-nav.spec.ts`

**Purpose**: Verify student sidebar navigation links. Mirrors `teacher-nav.spec.ts`.

- `beforeEach`: call `loginAsStudent()`
- 4 tests:
  - "My Classes" → `/student/classes`
  - "Dashboard" → `/student/dashboard` (navigate away first, then back)
  - "Settings" → `/settings`
  - "Help" → `/help`
- Selectors: `getByRole('link', { name: '...' })`

### 3. `student-join-class.spec.ts`

**Purpose**: Verify the student join-class flow end to end.

- Login as student
- Click "Join class" link → assert URL `/join`
- Fill `input[name="join_code"]` with value from `E2E_JOIN_CODE` env var
- Click `getByRole('button', { name: 'Join class' })`
- Assert redirect to `/classes/[uuid]` (not still on `/join`)

**Prerequisite**: `E2E_JOIN_CODE` must be set to a valid class join code. This decouples the test from the teacher class-creation flow. If the student has already joined this class, the server action should still redirect to the class page (idempotent join) — the test asserts the redirect, not the join being "new".

### 4. `settings.spec.ts`

**Purpose**: Verify display name update on the settings page.

- Login as teacher → navigate to Settings via sidebar
- Read current display name value from the input
- Fill `input[name="display_name"]` with `E2E-Test-{timestamp}`
- Click `getByRole('button', { name: 'Save display name' })`
- Assert success alert text "Display name updated." is visible
- Restore original display name to avoid polluting the account

### 5. `auth-signout.spec.ts`

**Purpose**: Verify sign-out redirects to login page for both roles.

- Test 1 — Teacher: `loginAsTeacher()` → click `getByRole('button', { name: 'Sign Out' })` → assert URL `/login`
- Test 2 — Student: `loginAsStudent()` → click `getByRole('button', { name: 'Sign Out' })` → assert URL `/login`

### 6. `guest-entry.spec.ts`

**Purpose**: Verify guest mode entry and sandbox rendering.

- Navigate to homepage (`/`)
- Click `getByRole('link', { name: 'Continue as guest' })`
- Assert redirect to `/classes/` (guest sandbox class)
- Assert sidebar text "Guest Explorer" is visible
- Assert "Create Account" button is visible (replaces Sign Out for guests)

---

## Infrastructure Changes

### `tests/config.ts`

Add one new env var export:

```ts
export const JOIN_CODE = process.env.E2E_JOIN_CODE || '';
```

### No changes to:

- `tests/e2e/helpers.ts` — `loginAsTeacher` and `loginAsStudent` already exist
- `tests/playwright.config.ts` — timeouts, screenshot/trace config already set

---

## Environment Variables (complete list)

| Variable | Required by | Notes |
|----------|-------------|-------|
| `E2E_BASE_URL` | All tests | Defaults to Vercel deployment |
| `E2E_TEACHER_EMAIL` | Teacher tests | Must be a teacher account |
| `E2E_TEACHER_PASSWORD` | Teacher tests | |
| `E2E_STUDENT_EMAIL` | Student tests | Must be a student account |
| `E2E_STUDENT_PASSWORD` | Student tests | |
| `E2E_JOIN_CODE` | `student-join-class` | Valid join code for an existing class |

---

## Test Isolation

- Each spec runs independently — no ordering dependency between files
- Tests that create data (existing teacher specs) use timestamped names to avoid collision
- `settings.spec.ts` restores original display name after modification
- Guest entry test creates a temporary anonymous session — no cleanup needed

---

## Out of Scope

These are explicitly deferred to a future round:
- Material upload tests
- Blueprint creation/editing/publishing
- Activity assignment creation (quiz, flashcards, chat)
- Student assignment completion
- Class analytics / teaching brief
- Error/edge-case scenarios
- Mobile responsive / sidebar collapse
