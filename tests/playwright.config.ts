import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Paths are relative to this config file (i.e. tests/)
  testDir: './e2e',
  outputDir: './results/test-artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: './results/html-report', open: 'never' }],
  ],

  use: {
    // Default timeout for actions and navigation
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    // Capture screenshot on failure for debugging
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  // Global test timeout
  timeout: 60_000,
});
