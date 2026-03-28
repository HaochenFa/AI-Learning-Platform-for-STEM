# Resend confirmation and reset emails design

Date: 2026-03-28

## Goal

Add a resend-email experience to the existing auth flows so users can resend:
- account confirmation emails after sign-up
- password reset emails after requesting recovery

The experience should keep users inside the existing shared auth surface, preserve the entered email, allow the email to be edited before resend, and use a visible 60-second resend cooldown.

## Scope

This design covers:
- sign-up verification success and resend flow
- forgot-password success and resend flow
- redirect behavior for invalid or expired confirmation links
- redirect behavior for invalid or expired recovery links
- client/server state contract needed to drive the UI
- test coverage needed to keep the flow stable

This design does not cover:
- broader auth redesign
- rate limiting beyond the visible resend cooldown
- changing the sign-in success flow
- changing the actual email templates except where expiry configuration must be verified

## Existing context

Relevant existing code:
- `web/src/app/actions.ts`
  - `signUp(formData)` sends the original confirmation email and redirects with `verify=1`
  - `requestPasswordReset(formData)` sends the original recovery email and redirects with `sent=1`
- `web/src/components/auth/AuthSurface.tsx`
  - renders auth success/error states from query params
  - hosts the sign-in, sign-up, and forgot-password forms
- `web/src/app/auth/confirm/route.ts`
  - verifies confirmation and recovery links
  - currently redirects invalid confirmation links to `/login`
  - currently redirects invalid recovery links to `/forgot-password`
- `web/src/lib/auth/ui.ts`
  - defines auth query-param types and allowed modal keys

The current codebase already uses URL query params as the server-to-UI contract for auth states. This feature should extend that pattern rather than introducing a separate state store.

## User requirements captured

- Show a resend email action after the user has already sent the original email.
- The resend action replaces the original send button.
- The resend action stays disabled for 60 seconds with a visible countdown.
- The email is prefilled and reused, but remains editable before resend.
- This behavior should exist for both:
  - sign-up confirmation emails
  - forgot-password reset emails
- Invalid or expired confirmation links should redirect back to sign-up with resend ready.
- Invalid or expired reset links should redirect back to forgot-password with resend ready.
- Confirmation links should expire after 5 minutes.
- Password reset links should expire after 5 minutes.
- The 5-minute link expiry is separate from the 60-second resend cooldown.

## Recommended approach

Use a shared resend-capable auth form inside the existing `AuthSurface` component.

### Why this approach

- It fits the recent shared home-first auth flow instead of adding new standalone pages.
- It reuses the current query-param redirect model already used by sign-up and forgot-password.
- It keeps sign-up and recovery UX visually and structurally consistent.
- It avoids introducing server-side session state solely for the cooldown timer.

## Alternative approaches considered

### Option 1 — Shared resend-capable auth form (recommended)

Extend `AuthSurface` so sign-up and forgot-password can both render a sent/resend state, with the countdown handled client-side and the source-of-truth flow state coming from query params.

**Pros**
- Least disruptive to current architecture
- Consistent UX across auth flows
- Reuses existing auth surfaces, routes, and tests

**Cons**
- Requires careful URL-state design so sign-up and reset resend states remain easy to reason about

### Option 2 — Dedicated resend pages

Redirect users to separate resend pages after sign-up or forgot-password submission.

**Pros**
- Strong visual separation between flows
- Less branching inside `AuthSurface`

**Cons**
- Adds route and UI duplication
- Pushes against the repo’s recent auth consolidation work

### Option 3 — Server-stored cooldown state

Track resend cooldown on the server and render availability from persisted state.

**Pros**
- Stronger enforcement model
- Less reliance on client timer logic

**Cons**
- Adds more moving parts than necessary for this feature
- Poorer fit with the current redirect/query-param auth model

## UX design

### Sign-up flow

1. User submits sign-up form.
2. Server sends confirmation email through Supabase.
3. User is redirected back to the auth UI in a verification-sent state.
4. In that state:
   - the email field remains visible
   - the email field is prefilled with the just-used address
   - the email can be edited
   - the primary action is no longer “Create account”
   - the primary action becomes a resend-focused action
   - the action is disabled for 60 seconds and displays the remaining countdown
5. Once the countdown reaches zero, the action becomes clickable and resends the confirmation email.
6. After resend, the countdown restarts at 60 seconds and success feedback remains visible.

### Forgot-password flow

1. User submits forgot-password form.
2. Server sends recovery email through Supabase.
3. User remains on the forgot-password auth surface in an email-sent state.
4. In that state:
   - the email field remains visible
   - the email field is prefilled with the just-used address
   - the email can be edited
   - the primary action becomes resend-focused
   - the action is disabled for 60 seconds with visible countdown
5. Once countdown reaches zero, the user can click resend.
6. After resend, the countdown restarts at 60 seconds.

### Link expiry behavior

Both confirmation links and recovery links should be treated as expiring after 5 minutes.

This 5-minute link lifetime is distinct from the 60-second resend cooldown:
- **5 minutes** controls whether the email link remains valid
- **60 seconds** controls when the resend action can be used again

The UI and copy should not imply that the link expires when the resend cooldown reaches zero.

## Redirect behavior

### Successful confirmation link

Keep the existing success behavior:
- confirmation success redirects to sign-in with `confirmed=1`
- recovery success redirects to reset-password with `recovery=1`

### Invalid or expired confirmation link

Change the invalid/expired confirmation path so it redirects to sign-up instead of sign-in.

The redirect should include enough state to:
- return the user to sign-up
- show an invalid/expired confirmation message
- prefill the email when available
- render the resend-ready confirmation state

### Invalid or expired recovery link

Keep redirecting to forgot-password, but enrich the redirect state so it:
- shows an invalid/expired reset message
- prefills the email when available when possible
- renders the resend-ready reset state

## State contract

The server should continue to drive auth UI state through query params.

### Required state concepts

The exact names can be finalized during planning, but the contract must support:
- auth mode / destination route
- email value
- success/error state
- resend flow type:
  - confirmation resend
  - password-reset resend
- resend cooldown start or resend-ready marker

### Important rule

- Server actions and routes define the navigable auth state.
- The client-side countdown only decorates that state for presentation.
- The client timer should not be the only representation of which flow is active.

## Component design

### `AuthSurface`

Extend `AuthSurface` to render a shared “email sent / resend available” experience for:
- sign-up confirmation state
- forgot-password reset state

The UI should support:
- email prefill from query state
- editable email input
- resend button replacing original send/create button in resend state
- countdown label while disabled
- enabled resend CTA when countdown reaches zero
- existing success and error alerts preserved or normalized for the resend case

The component should stay visually aligned with the current auth system rather than introducing a separate status card or page.

### Resend button behavior

The resend CTA should:
- replace the original submission button once an email has already been sent
- render a disabled countdown state for 60 seconds
- become clickable when the countdown reaches zero
- submit the currently visible email value, even if the user edited it

## Server actions design

Add two focused server actions in `web/src/app/actions.ts`.

### `resendConfirmationEmail(formData)`

Responsibilities:
- read the submitted email and return path fields
- validate required input
- send a new sign-up confirmation email via Supabase
- redirect back to the correct auth surface with:
  - confirmation resend state
  - preserved email
  - refreshed cooldown start
  - appropriate success/error messaging

### `resendPasswordReset(formData)`

Responsibilities:
- read the submitted email and return path fields
- validate required input
- call `supabase.auth.resetPasswordForEmail(...)`
- redirect back to the correct auth surface with:
  - password-reset resend state
  - preserved email
  - refreshed cooldown start
  - appropriate success/error messaging

### Input handling

Both resend actions should reuse the same safety rules already present in auth actions:
- sanitize internal redirect destinations
- normalize email casing for auth calls
- redirect back into the same auth surface on failure rather than throwing

## Confirm route changes

Update `web/src/app/auth/confirm/route.ts` so invalid/expired link handling becomes recoverable.

### Required changes

- invalid/expired confirmation links redirect to sign-up with resend-ready confirmation state
- invalid/expired recovery links redirect to forgot-password with resend-ready reset state
- success behavior remains unchanged

If the incoming request contains enough information to preserve the target email, include it in the redirect. If not, the UI should still render the resend-ready state and allow the user to type the email manually.

## Copy expectations

The implementation should keep messaging explicit about the two timers.

Examples of the intended distinction:
- “You can resend another email in 60 seconds.”
- “Your confirmation link has expired. Request a new email.”

Avoid copy that implies:
- the original link expires in 60 seconds
- resend availability means the original email is no longer valid

Forgot-password copy should continue to preserve account privacy with neutral messaging such as:
- “If an account exists for that email, we’ve sent a password reset link.”

## Error handling

- Unknown resend failures return the user to the same auth surface with an inline error.
- Invalid/expired links always return the user to a recoverable form state.
- If a user edits the email to an invalid or unusable value before resend, show the auth error inline on the same surface.
- No dead-end error page should be introduced for these flows.

## Testing design

Add or update tests for the following:

### Server action tests

- sign-up success redirect includes resend-capable verification state
- forgot-password success redirect includes resend-capable reset state
- resend confirmation action preserves email and restarts cooldown state
- resend password reset action preserves email and restarts cooldown state
- resend actions route errors back to the correct auth surface

### Confirm route tests

- invalid/expired confirmation links redirect to sign-up resend-ready state
- invalid/expired recovery links redirect to forgot-password resend-ready state
- successful confirmation and recovery behavior remain unchanged

### Component tests

- `AuthSurface` renders resend UI in sign-up sent state
- `AuthSurface` renders resend UI in forgot-password sent state
- resend button replaces original button when email-sent state is active
- countdown text transitions from disabled to enabled state
- edited prefilled email is submitted when resend is triggered
- existing verify/confirmed/reset/sent success messages remain correct

### Behavioral assertions

Tests should explicitly protect the difference between:
- **60-second resend cooldown**
- **5-minute email-link expiry**

## Dependencies and open verification

Before implementation, verify how Supabase currently enforces or configures email-link expiry so the intended 5-minute lifetime is actually true for:
- confirmation emails
- password reset emails

This is a verification task, not a blocker to the overall design. The design assumes the product requirement is 5 minutes, but implementation must confirm where that is configured and whether code, dashboard settings, or email templates need adjustment.

## Implementation boundaries

Keep the implementation focused on:
- auth actions
- auth route redirect behavior
- `AuthSurface` rendering/state handling
- targeted tests

Do not expand the work into:
- global auth architecture changes
- unrelated form rewrites
- new standalone auth pages unless planning reveals a concrete blocker
