# E2E Test Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 Playwright E2E specs covering student flows, auth sign-out, settings, and guest mode entry.

**Architecture:** Each spec is independent and follows the existing `teacher-*.spec.ts` pattern — one `test.describe` block per file, shared login via `helpers.ts`, env-configurable credentials. One config change adds `JOIN_CODE` export.

**Tech Stack:** Playwright, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-27-e2e-test-expansion-design.md`

---

### Task 1: Add JOIN_CODE to config

**Files:**
- Modify: `tests/config.ts`

- [ ] **Step 1: Add the JOIN_CODE export**

Append after the student password line in `tests/config.ts`:

```ts
/** Join code for an existing class (used by student-join-class test) */
export const JOIN_CODE = process.env.E2E_JOIN_CODE || '';
```

- [ ] **Step 2: Commit**

```bash
git add tests/config.ts
git commit -m "test: add E2E_JOIN_CODE to test config"
```

---

### Task 2: Student login spec

**Files:**
- Create: `tests/e2e/student-login.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { loginAsStudent } from './helpers';

test.describe('Student login and dashboard', () => {
  test('logs in and shows the student dashboard', async ({ page }) => {
    await loginAsStudent(page);

    // Dashboard heading contains "Welcome"
    const heading = page.locator('.editorial-title');
    await expect(heading).toContainText('Welcome', { timeout: 10_000 });

    // "Join class" CTA is visible
    await expect(page.getByRole('link', { name: 'Join class' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify the spec is picked up by Playwright**

Run: `npx playwright test --config tests/playwright.config.ts --list`

Expected: `student-login.spec.ts` appears in the list alongside the existing teacher specs.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/student-login.spec.ts
git commit -m "test: add student login E2E spec"
```

---

### Task 3: Student navigation spec

**Files:**
- Create: `tests/e2e/student-nav.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { loginAsStudent } from './helpers';

test.describe('Student sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
  });

  test('navigates to My Classes', async ({ page }) => {
    await page.getByRole('link', { name: 'My Classes' }).click();
    await expect(page).toHaveURL(/student\/classes/);
  });

  test('navigates to Dashboard', async ({ page }) => {
    // Leave dashboard first, then navigate back
    await page.getByRole('link', { name: 'My Classes' }).click();
    await expect(page).toHaveURL(/student\/classes/);

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/student\/dashboard/);
  });

  test('navigates to Settings', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/settings/);
  });

  test('navigates to Help', async ({ page }) => {
    await page.getByRole('link', { name: 'Help' }).click();
    await expect(page).toHaveURL(/help/);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/student-nav.spec.ts
git commit -m "test: add student sidebar navigation E2E spec"
```

---

### Task 4: Student join class spec

**Files:**
- Create: `tests/e2e/student-join-class.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { loginAsStudent } from './helpers';
import { JOIN_CODE } from '../config';

test.describe('Student join class', () => {
  test('joins a class with a valid code', async ({ page }) => {
    if (!JOIN_CODE) {
      test.skip(true, 'E2E_JOIN_CODE not set — skipping join class test');
    }

    await loginAsStudent(page);

    // Navigate to join page
    await page.getByRole('link', { name: 'Join class' }).click();
    await expect(page).toHaveURL(/\/join/);

    // Fill in the join code and submit
    await page.fill('input[name="join_code"]', JOIN_CODE);
    await page.getByRole('button', { name: 'Join class' }).click();

    // Should redirect to the class detail page
    await expect(page).toHaveURL(/\/classes\/[a-f0-9-]+/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/join/);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/student-join-class.spec.ts
git commit -m "test: add student join class E2E spec"
```

---

### Task 5: Settings spec

**Files:**
- Create: `tests/e2e/settings.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { loginAsTeacher } from './helpers';

test.describe('Settings page', () => {
  test('updates display name and shows success alert', async ({ page }) => {
    await loginAsTeacher(page);

    // Navigate to settings
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/settings/);

    // Read the current display name so we can restore it later
    const nameInput = page.locator('input[name="display_name"]');
    await expect(nameInput).toBeVisible();
    const originalName = await nameInput.inputValue();

    // Set a temporary name
    const tempName = `E2E-Test-${Date.now()}`;
    await nameInput.fill(tempName);
    await page.getByRole('button', { name: 'Save display name' }).click();

    // Assert success feedback
    await expect(page.getByText('Display name updated.')).toBeVisible({ timeout: 10_000 });

    // Restore original name
    const restoredInput = page.locator('input[name="display_name"]');
    await restoredInput.fill(originalName);
    await page.getByRole('button', { name: 'Save display name' }).click();
    await expect(page.getByText('Display name updated.')).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/settings.spec.ts
git commit -m "test: add settings display name E2E spec"
```

---

### Task 6: Auth sign-out spec

**Files:**
- Create: `tests/e2e/auth-signout.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { loginAsTeacher, loginAsStudent } from './helpers';

test.describe('Sign out', () => {
  test('teacher can sign out and is redirected to login', async ({ page }) => {
    await loginAsTeacher(page);

    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('student can sign out and is redirected to login', async ({ page }) => {
    await loginAsStudent(page);

    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/auth-signout.spec.ts
git commit -m "test: add auth sign-out E2E spec"
```

---

### Task 7: Guest entry spec

**Files:**
- Create: `tests/e2e/guest-entry.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { BASE_URL } from '../config';

test.describe('Guest mode entry', () => {
  test('enters guest mode from homepage and sees sandbox class', async ({ page }) => {
    // Visit the homepage (not logged in)
    await page.goto(BASE_URL);

    // Click guest entry link
    const guestLink = page.getByRole('link', { name: 'Continue as guest' });
    await expect(guestLink).toBeVisible({ timeout: 10_000 });
    await guestLink.click();

    // Should redirect to a class page (guest sandbox)
    await expect(page).toHaveURL(/\/classes\//, { timeout: 20_000 });

    // Sidebar shows guest identity
    await expect(page.getByText('Guest Explorer')).toBeVisible({ timeout: 10_000 });

    // "Create Account" button visible instead of "Sign Out"
    await expect(page.getByRole('link', { name: 'Create Account' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/guest-entry.spec.ts
git commit -m "test: add guest mode entry E2E spec"
```

---

### Task 8: Update test documentation

**Files:**
- Modify: `tests/test.md`

- [ ] **Step 1: Update the env var table and test list**

Add `E2E_JOIN_CODE` to the env var table and update the "Running Tests" section to mention the new specs. Add a section listing all spec files:

Append before the "## 5. Troubleshooting" section in `tests/test.md`:

```markdown
### Available Specs

| Spec | Covers |
|------|--------|
| `teacher-nav.spec.ts` | Teacher sidebar navigation |
| `teacher-classes.spec.ts` | Teacher class creation |
| `teacher-class-detail.spec.ts` | Teacher class detail + student preview |
| `student-login.spec.ts` | Student login + dashboard |
| `student-nav.spec.ts` | Student sidebar navigation |
| `student-join-class.spec.ts` | Student join class with code |
| `settings.spec.ts` | Display name update |
| `auth-signout.spec.ts` | Sign out for both roles |
| `guest-entry.spec.ts` | Guest mode entry + sandbox |
```

Also add `E2E_JOIN_CODE` row to the env var table:

```
| `E2E_JOIN_CODE` | Valid class join code (for student-join-class test) |
```

- [ ] **Step 2: Commit**

```bash
git add tests/test.md
git commit -m "docs: update test guide with new E2E specs"
```

---

### Task 9: Final verification

- [ ] **Step 1: List all specs and verify count**

Run: `npx playwright test --config tests/playwright.config.ts --list`

Expected: 9 spec files listed (3 existing + 6 new).

- [ ] **Step 2: Dry-run one lightweight spec to verify config works**

Run: `npx playwright test --config tests/playwright.config.ts tests/e2e/student-login.spec.ts --reporter=list`

Expected: Test either passes (if credentials are set) or skips/fails with a clear credential error (not a config or import error).

- [ ] **Step 3: Final commit if any adjustments were needed**

Only if the dry-run revealed issues that required code fixes.
