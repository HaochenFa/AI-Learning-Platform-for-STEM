# E2E Test Guide

## 1. Prerequisites

- Install project dependencies: `pnpm install`
- Install Playwright browsers: `pnpm exec playwright install`
- Set required environment variables (see below)

## 2. Configuration

Test config: `tests/config.ts`

**Quick setup:** Copy the example env file and fill in your credentials:

```sh
cp tests/.env.example tests/.env
# Edit tests/.env with your values
```

The `.env` file is auto-loaded by the Playwright config. It is gitignored.

Required environment variables:

| Variable | Description |
|----------|-------------|
| `E2E_BASE_URL` | System-under-test URL (defaults to Vercel deployment) |
| `E2E_TEACHER_EMAIL` | Teacher account email |
| `E2E_TEACHER_PASSWORD` | Teacher account password |
| `E2E_STUDENT_EMAIL` | Student account email (optional, for student tests) |
| `E2E_STUDENT_PASSWORD` | Student account password (optional, for student tests) |
| `E2E_JOIN_CODE` | Valid class join code (optional, student-join-class test skips if absent) |

## 3. Running Tests

Run a single spec:

```sh
npx playwright test --config tests/playwright.config.ts tests/e2e/teacher-nav.spec.ts
```

Run all E2E tests:

```sh
npx playwright test --config tests/playwright.config.ts
```

## 4. Available Specs

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

## 5. Results

- Screenshots and traces are saved to `tests/results/test-artifacts/` on failure
- HTML report: `tests/results/html-report/`
- Open report in browser: `npx playwright show-report tests/results/html-report`

## 6. Troubleshooting

- If login fails, verify your credentials are set correctly in env vars
- If rate-limited, wait a moment and retry
- For timeout issues, check network connectivity to the target URL
