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
