import { defineConfig } from '@playwright/test';

/**
 * End-to-end and visual capture tests run against a production build served with `astro preview`,
 * backed by the fixture data in tests/fixtures (see tests/serve.mjs).
 *
 * SITE_DIR  site checkout to build and serve (default: this one). CI points it at a checkout of the base branch.
 * PORT      port for the preview server (default 4321).
 * BASE_URL  test an already running site instead, such as a deployed PR preview. Nothing is built or served,
 *           and no fixtures are loaded, so use the `live` and `visual` projects only. The `e2e` project
 *           expects the fixture data.
 */
const port = process.env.PORT ?? '4321';
const remote = process.env.BASE_URL?.replace(/\/$/, '');

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: remote ?? `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'e2e', testDir: './tests/e2e', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    // Generic checks that hold for any data, so they can run against a deployed preview
    { name: 'live', testDir: './tests/live', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    // Captures screenshots for the visual diff. It asserts nothing about pixels: tests/visual/compare.mjs does that.
    { name: 'visual', testDir: './tests/visual', use: { browserName: 'chromium' } },
  ],
  webServer: remote ? undefined : {
    command: 'node tests/serve.mjs',
    url: `http://127.0.0.1:${port}/`,
    env: { PORT: port, ...(process.env.SITE_DIR ? { SITE_DIR: process.env.SITE_DIR } : {}) },
    reuseExistingServer: !process.env.CI && process.env.REUSE_SERVER === '1',
    timeout: 180_000,
    stdout: process.env.DEBUG_SERVER ? 'pipe' : 'ignore',
  },
});
