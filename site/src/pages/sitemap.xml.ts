import type { APIRoute } from 'astro';
import type { TierManifest, ProviderIndex, ReportIndex } from '../lib/types';
import { loadData } from '../lib/load';
import { getFixtureManifest, groupTiersByDownload } from '../lib/data';
import { readLocalJson } from '../lib/local-data';

const STATIC_PAGES = ['/', '/how-it-works', '/submit', '/privacy', '/providers', '/reports'];

export const GET: APIRoute = async ({ locals, site, url }) => {
  const origin = (site ?? url).origin;

  let manifest: TierManifest | null = null;
  try {
    const obj = await locals.runtime.env.DATA_BUCKET.get('data/manifest.json');
    if (obj) manifest = await obj.json() as TierManifest;
  } catch {}
  if (!manifest) manifest = await readLocalJson<TierManifest>('data/manifest.json') ?? getFixtureManifest();

  const lastmod = manifest.updatedAt.split('T')[0];
  const entries: { loc: string; lastmod?: string; priority: string }[] = STATIC_PAGES.map(p => ({
    loc: p, priority: p === '/' ? '1.0' : '0.6',
  }));

  for (const tier of manifest.tiers) {
    entries.push({ loc: `/${tier.key}`, lastmod, priority: '0.8' });
  }
  // Grouped pages only exist when a download speed has more than one upload variant
  for (const group of groupTiersByDownload(manifest.tiers)) {
    if (group.tierKeys.length > 1) entries.push({ loc: `/${group.groupKey}`, lastmod, priority: '0.9' });
  }

  const providers = await loadData<ProviderIndex>(locals, 'providers/index.json');
  for (const p of providers?.providers ?? []) {
    entries.push({ loc: `/provider/${p.slug}`, lastmod: providers!.updatedAt.split('T')[0], priority: '0.7' });
  }
  const reports = await loadData<ReportIndex>(locals, 'reports/index.json');
  for (const r of reports?.reports ?? []) {
    entries.push({ loc: `/reports/${r.month}`, lastmod: r.generatedAt.split('T')[0], priority: r.final ? '0.6' : '0.8' });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `  <url>
    <loc>${origin}${e.loc}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ''}
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
