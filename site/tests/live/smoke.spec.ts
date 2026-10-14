/**
 * Checks that hold for real data, so they can run against a deployed preview:
 *
 *   BASE_URL=https://pr-12-ismynbncooked.example.workers.dev pnpm exec playwright test --project=live
 *
 * Pages come from the sitemap of the site under test. Nothing here depends on specific prices or providers.
 */
import { expect, test } from '@playwright/test';
import { IMAGES } from '../pages';
import { prepare, waitForHydration } from '../e2e/helpers';
import { discoverPages } from './discover';

const origin = process.env.BASE_URL?.replace(/\/$/, '');
test.skip(!origin, 'Set BASE_URL to the site to test');

const pages = origin ? await discoverPages(origin) : [];

for (const spec of pages) {
  test(`${spec.path} renders`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) problems.push(`console: ${msg.text()}`);
    });
    page.on('response', (res) => {
      const url = new URL(res.url());
      if (url.origin === origin && res.status() >= 500) problems.push(`${res.status()} ${url.pathname}`);
    });
    await prepare(page);

    const res = await page.goto(spec.path);
    expect(res?.status()).toBe(spec.status ?? 200);
    await waitForHydration(page);

    await expect(page).toHaveTitle(/\S/);
    if ((spec.status ?? 200) === 200 && !spec.bare) {
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
    }
    // A page that rendered but has no numbers is a data problem, which is the point of testing against real data
    if ((spec.status ?? 200) === 200 && /^\/(nbn|opticomm)-\d+-\d+$/.test(spec.path)) await expect(page.locator('body')).toContainText(/\$\d/);
    expect(problems).toEqual([]);
  });
}

test.describe('image endpoints', () => {
  for (const img of IMAGES) {
    test(`${img.path} is a PNG`, async ({ request }) => {
      const res = await request.get(img.path);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
      expect([...(await res.body()).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    });
  }
});

test('sitemap and feed are served', async ({ request }) => {
  expect((await request.get('/sitemap.xml')).status()).toBe(200);
  const feed = await request.get('/reports/feed.xml');
  expect(feed.status()).toBe(200);
  expect(await feed.text()).toContain('<rss');
});

test('plan submissions are switched off on a preview', async ({ page }) => {
  test.skip(!process.env.EXPECT_READ_ONLY, 'Only checked when EXPECT_READ_ONLY is set (preview deployments)');
  // The preview shares production's bindings, so the workflow deploys it with SUBMISSIONS_ENABLED=false
  await page.goto('/submit');
  await expect(page.locator('astro-island[component-url*="PlanSubmission"]')).toHaveCount(0);
});
