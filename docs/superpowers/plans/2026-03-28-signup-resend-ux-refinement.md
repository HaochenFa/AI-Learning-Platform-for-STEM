# Sign-up Resend UX Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `signUpResendActive` is true, replace the full registration form with only `AuthResendForm` (locked email + resend button + cooldown), eliminating the extra resend card that was stacked below the form and inflating the modal height.

**Architecture:** Single conditional swap in `AuthSurface.tsx` — when `signUpResendActive`, render `<AuthResendForm emailMode="locked" …>` instead of `<form action={signUp}>`. The extra resend card (the `div.mt-4 rounded-[1.5rem]…` block) is deleted entirely. One test update required to reflect the new rendering.

**Tech Stack:** Next.js App Router server component (TSX), `@testing-library/react`, Vitest, `react-dom/server` for RSC test rendering.

---

## File map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `web/src/app/(auth)/register/page.test.tsx` | Update resend-state assertions to match new rendering |
| Modify | `web/src/components/auth/AuthSurface.tsx` | Swap sign-up form for `AuthResendForm` when resend active |

---

### Task 1: Update the register page test

**Files:**
- Modify: `web/src/app/(auth)/register/page.test.tsx`

The existing `"shows the confirmation resend state after sign up"` test (lines 33–51) asserts that the full form is visible in the resend state (`"Account type"`, `PASSWORD_POLICY_HINT`, `"If the email address or role is wrong"`). Those elements are intentionally being removed.

- [ ] **Step 1: Open and read the current test**

  File: `web/src/app/(auth)/register/page.test.tsx`

  Locate the `"shows the confirmation resend state after sign up"` describe block.

- [ ] **Step 2: Replace the resend-state test assertions**

  Replace the body of `"shows the confirmation resend state after sign up"` (lines 33–51) with the following. The `import` for `PASSWORD_POLICY_HINT` at line 4 may now be unused — remove it.

  ```tsx
  it("shows the confirmation resend state after sign up", async () => {
    const html = renderToStaticMarkup(
      await RegisterPage({
        searchParams: Promise.resolve({
          account_type: "teacher",
          email: "teacher@example.com",
          resend: "confirmation",
          resend_started_at: "1710000000000",
          verify: "1",
        }),
      }),
    );

    // success alert remains
    expect(html).toContain("Check your email to verify your account");

    // resend button replaces the registration button
    expect(html).toContain("Resend confirmation email");
    expect(html).not.toContain("Create account");

    // locked email is displayed
    expect(html).toContain("teacher@example.com");

    // full registration form is gone
    expect(html).not.toContain("Account type");

    // extra resend card is gone
    expect(html).not.toContain("If the email address or role is wrong");
  });
  ```

  Also remove the `PASSWORD_POLICY_HINT` import if it is no longer used elsewhere in the file:

  ```tsx
  // Remove this line if PASSWORD_POLICY_HINT is not used in other tests:
  // import { PASSWORD_POLICY_HINT } from "@/lib/auth/password-policy";
  ```

- [ ] **Step 3: Run the test to verify it fails**

  ```bash
  cd /path/to/repo && pnpm vitest run web/src/app/\\(auth\\)/register/page.test.tsx
  ```

  Expected: The `"shows the confirmation resend state after sign up"` case FAILS because `AuthSurface` still renders the old layout. The other two cases (`"renders the registration form"`, `"shows error message when provided"`) should still PASS.

- [ ] **Step 4: Commit the updated test**

  ```bash
  git add web/src/app/\(auth\)/register/page.test.tsx
  git commit -m "test(auth): update register resend assertions for collapsed form"
  ```

---

### Task 2: Implement the conditional rendering in AuthSurface

**Files:**
- Modify: `web/src/components/auth/AuthSurface.tsx:286-357`

- [ ] **Step 1: Locate the sign-up section**

  Open `web/src/components/auth/AuthSurface.tsx`. The sign-up block starts at approximately line 286:

  ```tsx
  {mode === "sign-up" ? (
    <>
      <form className="space-y-4" action={signUp}>
  ```

  It ends around line 357 with:

  ```tsx
      ) : null}
    </>
  ) : null}
  ```

- [ ] **Step 2: Replace the entire sign-up section**

  Replace everything from `{mode === "sign-up" ? (` through the matching closing `} : null}` with:

  ```tsx
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
      <form className="space-y-4" action={signUp}>
        <input type="hidden" name="auth_return_to" value={authReturnTo} />
        <input type="hidden" name="auth_success_to" value={authSuccessTo} />
        <AccountTypeSelector defaultValue={defaultAccountType} />
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={defaultEmail}
            autoComplete="email"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            name="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            pattern={PASSWORD_POLICY_PATTERN}
            title={PASSWORD_POLICY_TITLE}
            autoComplete="new-password"
          />
          <p className="text-xs leading-5 text-ui-muted">{PASSWORD_POLICY_HINT}</p>
        </div>
        <PendingSubmitButton
          label="Create account"
          pendingLabel="Creating account..."
          variant="warm"
          className="w-full"
        />
      </form>
    )
  ) : null}
  ```

  This removes:
  - The old wrapper `<>…</>` fragment
  - The extra resend card (`div.mt-4 space-y-3 rounded-[1.5rem] border border-default bg-white/72 p-4`) and everything inside it

- [ ] **Step 3: Run the failing test again to confirm it now passes**

  ```bash
  cd /path/to/repo && pnpm vitest run web/src/app/\\(auth\\)/register/page.test.tsx
  ```

  Expected: ALL 3 tests PASS.

- [ ] **Step 4: Run the full auth test suite**

  ```bash
  pnpm vitest run web/src/components/auth/ web/src/app/\\(auth\\)/
  ```

  Expected: All tests pass. No regressions.

- [ ] **Step 5: Run lint**

  ```bash
  cd /path/to/repo && pnpm lint
  ```

  Expected: No errors. If the `PASSWORD_POLICY_HINT` import was not removed from the test file, lint may warn about an unused import — fix it now.

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/components/auth/AuthSurface.tsx
  git commit -m "feat(auth): collapse sign-up form into resend button after email sent

  When signUpResendActive, replace the full registration form with
  AuthResendForm (locked email + resend button + cooldown). Removes the
  extra resend card that was stacked below the form, reducing modal height."
  ```

---

### Task 3: Visual verification

- [ ] **Step 1: Start the dev server**

  ```bash
  pnpm dev
  ```

- [ ] **Step 2: Trigger the resend state**

  Open the app, open the sign-up modal, submit the registration form with a valid email. You should be redirected back with `?verify=1&email=…` in the URL. Confirm:

  - The modal height is roughly the same as the sign-in modal
  - No "Need another confirmation email?" heading or explanatory paragraph is visible
  - The locked email display shows the submitted address
  - The "Resend confirmation email" button is visible and disabled (within 60 s)
  - After 60 s, the button becomes enabled

- [ ] **Step 3: Verify the happy path is unchanged**

  Close and reopen the sign-up modal (no `?verify=1` in URL). Confirm the full registration form (account type, email, password, "Create account" button) renders as before.
