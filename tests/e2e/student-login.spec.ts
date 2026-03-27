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
