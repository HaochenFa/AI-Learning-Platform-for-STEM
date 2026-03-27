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
