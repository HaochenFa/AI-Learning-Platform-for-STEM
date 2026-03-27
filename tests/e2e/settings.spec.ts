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
