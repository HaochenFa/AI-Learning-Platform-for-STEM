import { defineConfig } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load tests/.env if it exists (copy from .env.example to get started)
const envPath = resolve(__dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

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
