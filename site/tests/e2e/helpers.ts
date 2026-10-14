import type { Page } from '@playwright/test';
import { NOW } from '../pages';

// The site under test is local, or BASE_URL when testing a deployment
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', ...(process.env.BASE_URL ? [new URL(process.env.BASE_URL).hostname] : [])]);

/**
 * Freeze the clock, optionally seed localStorage, and drop anything the preview server does not serve
 * (ads, analytics, CDNs).
 */
export async function prepare(page: Page, storage?: Record<string, string>) {
  // Against a live site the data is dated now, so FREEZE_TIME is the moment the run started rather than the fixture date
  await page.clock.setFixedTime(process.env.FREEZE_TIME ?? NOW);
  if (storage) {
    await page.addInitScript((items) => {
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    }, storage);
  }
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (ALLOWED_HOSTS.has(url.hostname) || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    return route.abort();
  });
}

/**
 * Scroll through the page so client:visible islands hydrate, then wait for every island and for web fonts.
 * The wait is best effort: an island that never hydrates is a bug for the screenshot to show, not for a timeout.
 */
export async function waitForHydration(page: Page) {
  await scrollThrough(page);
  await page
    .waitForFunction(() => document.querySelectorAll('astro-island[ssr]').length === 0, undefined, { timeout: 5_000 })
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

/** Scroll to the bottom and back so lazy (client:visible) islands and images load. */
export async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight / 2);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 100));
    window.scrollTo(0, 0);
  });
}
