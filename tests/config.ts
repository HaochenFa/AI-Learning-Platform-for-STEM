// Playwright E2E test configuration
// Override via environment variables, or edit defaults below for local use.

/** Base URL of the system under test */
export const BASE_URL =
  process.env.E2E_BASE_URL || 'https://ai-stem-learning-platform-group-8.vercel.app';

/** Teacher account credentials for login */
export const TEACHER_EMAIL = process.env.E2E_TEACHER_EMAIL || '';
export const TEACHER_PASSWORD = process.env.E2E_TEACHER_PASSWORD || '';

/** Student account credentials for login */
export const STUDENT_EMAIL = process.env.E2E_STUDENT_EMAIL || '';
export const STUDENT_PASSWORD = process.env.E2E_STUDENT_PASSWORD || '';

/** Join code for an existing class (used by student-join-class test) */
export const JOIN_CODE = process.env.E2E_JOIN_CODE || '';
