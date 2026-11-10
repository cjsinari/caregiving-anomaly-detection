import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end configuration.
 *
 * The dashboard is served from the production build (`preview`), not the dev
 * server. The built page is the one that carries the content security policy —
 * it is injected at build time, because the dev server needs an inline script
 * for hot reload — so testing the dev server would exercise the one version of
 * the page whose CSP is absent.
 *
 * The auth service is started by the global setup rather than by `webServer`,
 * because the test needs the login codes it prints and `webServer` offers no
 * way to read a server's output. See e2e/service.js.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // One worker. These tests sign in, act on accounts and read the audit trail
  // of a single shared database; running them in parallel would have them
  // freezing each other's accounts and reading each other's events.
  workers: 1,
  fullyParallel: false,

  // Retries hide flakiness in a suite whose whole purpose is to prove the
  // thing works. A failure here should be looked at, not re-rolled.
  retries: 0,

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // A Kenyan address, through the proxy hop the service is told to trust, so
    // sign-ins geolocate and score the way a real one would. From 127.0.0.1
    // nothing resolves and every run would be a cold-start edge case.
    extraHTTPHeaders: { 'X-Forwarded-For': '41.90.64.33' },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
