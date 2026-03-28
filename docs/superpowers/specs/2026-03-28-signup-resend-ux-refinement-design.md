# Sign-up resend UX refinement design

Date: 2026-03-28

## Goal

After a user submits the sign-up form and receives a confirmation email, the auth modal currently renders both the full registration form and a separate resend card below it. This doubles the modal height and creates a confusing two-panel layout. The resend section should replace the registration form in-place rather than append to it.

## Scope

This design covers:
- `AuthSurface.tsx` — conditional rendering of sign-up content based on `signUpResendActive`
- Removing the extra resend card (the `div.mt-4 rounded-[1.5rem]` block) from the sign-up section

This design does not cover:
- `AuthResendForm` — no changes; it is already correctly built
- The forgot-password resend flow — it does not exhibit the same layout problem
- Any server actions, routes, or query-param contract — those remain unchanged
- The sign-in form

## Current state

When `signUpResendActive = true` (i.e. `verify=1` or `resend=confirmation` is set in the URL), `AuthSurface` renders two things inside `mode === "sign-up"`:

1. The full registration `<form>` — AccountTypeSelector, Email input, Password input, "Create account" button (`action={signUp}`)
2. Below it: a separate card (`div.mt-4 space-y-3 rounded-[1.5rem] border ...`) containing a heading, explanatory paragraph, and `AuthResendForm`

Both sections are visible simultaneously, which inflates the modal height and presents a confusing primary action (the "Create account" button is still visible even though registration is already completed).

## Recommended approach

When `signUpResendActive`, replace the entire sign-up form block with `AuthResendForm` using `emailMode="locked"`. Remove the extra card entirely. The success alert (already rendered by `renderSignUpFeedback`) provides the confirmation context above the form area.

### Why this approach

- Achieves the right height by showing only what is relevant to the user's current state
- Uses the existing `AuthResendForm` component without modification
- No new component, no new state, no new props — pure conditional rendering
- Consistent with the forgot-password resend flow, which already shows only `AuthResendForm` in its resend state (lines 360–371)

## Alternative considered

**Keep the full form visible, change only the button.** This preserves the AccountTypeSelector and Password inputs even though both are irrelevant after registration. It also keeps the sign-up `<form>` wired to `action={signUp}`, meaning the fields around the button would submit a new registration rather than a resend — confusing behavior. Rejected.

## UX design

### Before (signUpResendActive = false)

```
[Account type selector]
[Email input]
[Password input]
[Create account]
```

### After (signUpResendActive = true)

```
[Success alert: "Check your email to verify your account…"]
[Locked email display]
[Resend Confirmation Email]  ← disabled during cooldown, pending during submit
[Timer copy: "You can resend in Xs…" / "You can request a new email now."]
```

The modal height contracts to roughly the same height as the sign-in modal.

### Button state machine

| State | Button text | Button enabled |
|-------|-------------|----------------|
| Within 60s of last send | "Resend confirmation email" | No — shows countdown via `timerWaitingCopy` |
| After cooldown expires | "Resend confirmation email" | Yes |
| Submission in flight | "Resending confirmation email…" | No — `useFormStatus` pending |

Cooldown and pending protection are already implemented in `AuthResendForm` and `PendingSubmitButton`. No new debounce or disable logic is needed.

## Component design

### `AuthSurface` — sign-up section

Replace the current structure:

```tsx
// Before
{mode === "sign-up" ? (
  <>
    <form action={signUp}>…full form…</form>
    {signUpResendActive ? (
      <div className="mt-4 …extra card…">
        <h2>Need another confirmation email?</h2>
        <p>…</p>
        <AuthResendForm … />
      </div>
    ) : null}
  </>
) : null}
```

With a simple conditional:

```tsx
// After
{mode === "sign-up" ? (
  signUpResendActive ? (
    <AuthResendForm
      action={resendConfirmationEmail}
      authReturnTo={signUpResendReturnTo}
      defaultEmail={defaultEmail}
      emailMode="locked"
      pendingLabel="Resending confirmation email..."
      resendStartedAt={resendStartedAt}
      submitLabel="Resend confirmation email"
      timerReadyCopy="Confirmation links stay valid for 5 minutes. You can request a new email now."
      timerWaitingCopy="You can resend another email in {seconds}. Confirmation links stay valid for 5 minutes."
    />
  ) : (
    <form className="space-y-4" action={signUp}>…full form…</form>
  )
) : null}
```

The extra resend card (`div.mt-4 space-y-3 rounded-[1.5rem] border …`) is deleted entirely.

### `AuthResendForm` — no changes

The component is already correct. `emailMode="locked"` renders the email as a read-only display with a hidden `<input>` for form submission. The cooldown and pending states are already handled.

## Copy

Existing `timerReadyCopy` and `timerWaitingCopy` values are reused unchanged. No new copy is required. The heading and paragraph from the extra card ("Need another confirmation email?" / "We can resend it to…") are removed; the success alert above provides sufficient context.

## Error handling

No change. Errors from `resendConfirmationEmail` already redirect back to the same auth surface with `?error=…`, which `AuthSurface` renders via `TransientFeedbackAlert`. This behavior is unaffected.

## Testing design

The existing `AuthResendForm` tests cover the component in isolation. The following assertions should be checked or added for `AuthSurface` in sign-up resend state:

- When `verify=1` is set, the full registration form is NOT rendered
- When `verify=1` is set, `AuthResendForm` IS rendered in its place
- The "Create account" button is NOT present when `signUpResendActive` is true
- The "Need another confirmation email?" heading is NOT present (extra card removed)
- The success alert copy remains correct

## Implementation boundaries

Only `AuthSurface.tsx` changes. No migrations, no server actions, no new components, no new routes.
