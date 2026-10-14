/**
 * Takes a screenshot of every page at desktop and mobile widths, and saves the OG images.
 *
 * Nothing is asserted about pixels here. CI runs this twice, once against the base branch and once against
 * the PR, with the same fixtures, then tests/visual/compare.mjs diffs the two folders. Nothing is committed
 * as a baseline, so a font or Chromium upgrade cannot cause a flood of false diffs.
 *
 * SHOTS_DIR     where to write (default: visual-output/head)
 *
 * Against a deployed site (BASE_URL) the pages are discovered from the sitemap at DISCOVER_URL, so two runs
 * against different deployments ask for the same pages. Each URL gets a cache-busting query (VD_BUST) so the
 * edge cache cannot serve one side an older render of the same data. FREEZE_TIME pins the clock for both.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { IMAGES, PAGES, VIEWPORTS } from '../pages';
import { prepare, waitForHydration } from '../e2e/helpers';
import { discoverPages } from '../live/discover';

const out = resolve(process.env.SHOTS_DIR ?? 'visual-output/head');
const remote = process.env.BASE_URL?.replace(/\/$/, '');
const pages = remote ? (await discoverPages((process.env.DISCOVER_URL ?? remote).replace(/\/$/, ''))).filter((p) => !p.skipVisual) : PAGES;

/** Cache-busting query for deployed sites, so both sides render fresh */
function withBust(path: string) {
  if (!remote) return path;
  const url = new URL(path, 'http://x');
  url.searchParams.set('_vd', process.env.VD_BUST ?? 'local');
  return url.pathname + url.search;
}

// Freezes anything that moves, so two runs of the same build produce the same pixels
const STILL = `*, *::before, *::after {
  animation: none !important; transition: none !important; caret-color: transparent !important;
  scroll-behavior: auto !important;
}
/* Ads are only built into production, and are not what the diff is about */
[data-ad-slot-container] { display: none !important; }`;

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(vpName, () => {
    test.use({ viewport });

    for (const spec of pages) {
      test(`${spec.name}`, async ({ page }) => {
        await prepare(page, spec.storage);
        const res = await page.goto(withBust(spec.path));
        expect(res?.status()).toBe(spec.status ?? 200);
        await page.addStyleTag({ content: STILL });
        await waitForHydration(page);

        const dir = join(out, vpName);
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: join(dir, `${spec.name}.png`), fullPage: true, animations: 'disabled' });
      });
    }
  });
}

test.describe('images', () => {
  for (const img of IMAGES) {
    test(img.name, async ({ request }) => {
      const res = await request.get(withBust(img.path));
      expect(res.status()).toBe(200);
      const dir = join(out, 'images');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${img.name}.png`), await res.body());
    });
  }
});
