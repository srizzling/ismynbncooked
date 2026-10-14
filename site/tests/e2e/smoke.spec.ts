import { expect, test } from '@playwright/test';
import { IMAGES, PAGES } from '../pages';
import { prepare, waitForHydration } from './helpers';

test.describe('pages', () => {
  for (const spec of PAGES) {
    test(`${spec.name}: ${spec.path} renders`, async ({ page }) => {
      const problems: string[] = [];
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) problems.push(`console: ${msg.text()}`);
      });
      page.on('response', (res) => {
        const url = new URL(res.url());
        if (url.hostname === '127.0.0.1' && res.status() >= 500) problems.push(`${res.status()} ${url.pathname}`);
      });
      await prepare(page, spec.storage);

      const res = await page.goto(spec.path);
      expect(res?.status()).toBe(spec.status ?? 200);
      await waitForHydration(page);

      await expect(page.locator('body')).toContainText(spec.expect, { ignoreCase: true });
      await expect(page).toHaveTitle(/\S/);
      if ((spec.status ?? 200) === 200 && !spec.bare) {
        await expect(page.locator('h1').first()).toBeVisible();
        await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
      }
      expect(problems).toEqual([]);
    });
  }
});

test.describe('image endpoints', () => {
  for (const img of IMAGES) {
    test(`${img.path} is a PNG`, async ({ request }) => {
      const res = await request.get(img.path);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
      const body = await res.body();
      expect([...body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(body.length).toBeGreaterThan(5_000);
    });
  }
});

test.describe('feeds and static files', () => {
  test('sitemap lists the tier and provider pages', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<urlset');
    expect(xml).toContain('/nbn-100-20');
    expect(xml).toContain('/provider/telstra');
  });

  test('report feed is RSS with the fixture months', async ({ request }) => {
    const res = await request.get('/reports/feed.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<rss');
    expect(xml).toContain('2026-08');
  });

  for (const path of ['/robots.txt', '/llms.txt', '/ads.txt']) {
    test(`${path} is served as text`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('text/plain');
    });
  }
});

test.describe('routing', () => {
  test('a grouped tier key redirects to the full tier key', async ({ request }) => {
    const res = await request.get('/nbn-100', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toMatch(/\/nbn-100-20$/);
  });

  for (const path of ['/nbn-999-1', '/provider/nobody', '/reports/2020-01']) {
    test(`${path} is a 404`, async ({ request }) => {
      expect((await request.get(path)).status()).toBe(404);
    });
  }
});
