import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeShareWords } from '../src/lib/share';
import type { TierManifest } from '../src/lib/types';

/** The moment the tests pretend it is. Matches the dates in tests/fixtures/generate.mjs. */
export const NOW = '2026-10-01T02:00:00Z';

const manifest: TierManifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'data', 'manifest.json'), 'utf-8'),
);

const shareWords = encodeShareWords(
  { s: 'nbn-100-20', p: 8990, v: 'Telstra', c: 6890, l: 'absolute-rort', cp: 'Tangerine', h: 12, fp: 0, pd: 0 },
  { tiers: manifest, providers: manifest.providers },
);

export interface PageSpec {
  /** File-safe name used for the screenshot */
  name: string;
  path: string;
  /** Status the page should answer with (default 200) */
  status?: number;
  /** Text the page must contain, so a blank or error page cannot pass */
  expect: string;
  /** Embeds and share cards have no h1 or meta description by design */
  bare?: boolean;
  /** localStorage to seed before the page loads, for states that depend on a saved plan */
  storage?: Record<string, string>;
  /** Leave out of the visual diff. For pages that differ between deployments by design. */
  skipVisual?: boolean;
}

const SAVED_PLAN = {
  ismynbncooked_plans: JSON.stringify({
    'nbn-100-20': { price: 89.9, provider: 'Telstra', savedAt: '2026-09-01T00:00:00.000Z' },
  }),
  ismynbncooked_state: 'vic',
};

export const PAGES: PageSpec[] = [
  { name: 'home', path: '/', expect: 'NBN' },
  { name: 'tier-nbn-100-20', path: '/nbn-100-20', expect: 'Tangerine' },
  { name: 'tier-nbn-1000-50', path: '/nbn-1000-50', expect: 'Superloop' },
  { name: 'tier-nbn-100-20-saved-plan', path: '/nbn-100-20', expect: 'Telstra', storage: SAVED_PLAN },
  { name: 'home-saved-plan', path: '/', expect: 'Update your plan', storage: SAVED_PLAN },
  { name: 'compare', path: '/compare?networks=nbn&download=all&upload=all', expect: 'NBN' },
  { name: 'providers', path: '/providers', expect: 'Telstra' },
  { name: 'provider-telstra', path: '/provider/telstra', expect: 'Telstra' },
  { name: 'provider-tangerine', path: '/provider/tangerine', expect: 'Tangerine' },
  { name: 'trends', path: '/trends', expect: 'Trends' },
  { name: 'embed-trends', path: '/embed/trends', expect: 'NBN', bare: true },
  { name: 'reports', path: '/reports', expect: 'Aug' },
  { name: 'report-2026-08', path: '/reports/2026-08', expect: 'August' },
  { name: 'report-2026-09', path: '/reports/2026-09', expect: 'September' },
  { name: 'share', path: `/share/${shareWords}`, expect: 'Telstra', bare: true },
  { name: 'how-it-works', path: '/how-it-works', expect: 'How' },
  { name: 'submit', path: '/submit', expect: 'plan' },
  { name: 'privacy', path: '/privacy', expect: 'privacy' },
  { name: 'not-found', path: '/nbn-999-1', status: 404, expect: 'cooked' },
];

/** Image endpoints rendered with satori + resvg. Compared as images, not screenshots of pages. */
export const IMAGES = [
  { name: 'og-cheapest', path: '/og/cheapest.png' },
  { name: 'og-tiers', path: '/og/tiers.png' },
  { name: 'og-trends', path: '/og/trends.png' },
  { name: 'og-provider-telstra', path: '/og/provider/telstra.png' },
  { name: 'og-report-2026-08', path: '/og/report/2026-08.png' },
];

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;
