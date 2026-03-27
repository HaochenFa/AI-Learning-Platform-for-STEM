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
