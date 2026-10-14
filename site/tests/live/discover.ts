import type { PageSpec } from '../pages';

/** Pages every deployment has, whatever the data looks like. */
const ALWAYS: PageSpec[] = [
  { name: 'home', path: '/', expect: '' },
  { name: 'providers', path: '/providers', expect: '' },
  { name: 'trends', path: '/trends', expect: '' },
  { name: 'embed-trends', path: '/embed/trends', expect: '', bare: true },
  { name: 'reports', path: '/reports', expect: '' },
  { name: 'how-it-works', path: '/how-it-works', expect: '' },
  // A preview is deployed with submissions off, so this page differs from production by design
  { name: 'submit', path: '/submit', expect: '', skipVisual: true },
  { name: 'privacy', path: '/privacy', expect: '' },
  { name: 'not-found', path: '/nbn-999-1', status: 404, expect: '' },
];

const PREFERRED_TIERS = ['nbn-100-20', 'nbn-1000-50', 'nbn-25-5'];
const PREFERRED_PROVIDERS = ['telstra', 'tangerine-telecom'];

/**
 * Pick real pages from a site's sitemap: a few tier pages, a few provider pages and the latest report.
 * Capture runs read the production sitemap for both sides (DISCOVER_URL), so the preview and production
 * are always asked for the same pages.
 */
export async function discoverPages(origin: string): Promise<PageSpec[]> {
  const res = await fetch(`${origin}/sitemap.xml`);
  if (!res.ok) throw new Error(`GET ${origin}/sitemap.xml answered ${res.status}`);
  const paths = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);

  const pick = (all: string[], preferred: string[], max: number) => {
    const chosen = preferred.filter((p) => all.includes(p));
    for (const p of all) if (chosen.length < max && !chosen.includes(p)) chosen.push(p);
    return chosen.slice(0, max);
  };

  const tiers = pick(paths.filter((p) => /^\/(nbn|opticomm)-\d+-\d+$/.test(p)), PREFERRED_TIERS.map((t) => `/${t}`), 3);
  const providers = pick(paths.filter((p) => p.startsWith('/provider/')), PREFERRED_PROVIDERS.map((p) => `/provider/${p}`), 2);
  const report = paths.find((p) => /^\/reports\/\d{4}-\d{2}$/.test(p));

  const found = [...tiers, ...providers, ...(report ? [report] : [])].map((path): PageSpec => ({
    name: path.slice(1).replace(/\//g, '-'), path, expect: '',
  }));
  return [...ALWAYS, ...found];
}
