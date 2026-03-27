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
