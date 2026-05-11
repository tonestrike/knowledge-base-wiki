import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the live-deployment smoke tests.
 *
 * The suite hits the production Workers URL directly — no local server,
 * no test fixtures. That keeps it true to the user-visible product and
 * means a CI pass really does mean "the deployed wiki path works".
 *
 * Override the target with PLAYWRIGHT_BASE_URL when running against a
 * preview deploy (e.g. a Worker preview URL on a PR).
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://tenex-api.tonyvantur.workers.dev';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
