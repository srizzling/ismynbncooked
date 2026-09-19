import type { APIRoute } from 'astro';
import type { ReportIndex } from '../../lib/types';
import { loadData } from '../../lib/load';

function esc(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
}

export const GET: APIRoute = async ({ locals, site, url }) => {
  const origin = (site ?? url).origin;
  const index = await loadData<ReportIndex>(locals, 'reports/index.json');
  const reports = index?.reports ?? [];

  const items = reports.map(r => {
    const [y, m] = r.month.split('-').map(Number);
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const title = `${label} NBN price report: ${r.rises} rises, ${r.drops} drops, ${r.newProviders} new providers${r.final ? '' : ' (in progress)'}`;
    return `    <item>
      <title>${esc(title)}</title>
      <link>${origin}/reports/${r.month}</link>
      <guid isPermaLink="true">${origin}/reports/${r.month}</guid>
      <pubDate>${new Date(r.generatedAt).toUTCString()}</pubDate>
      <description>${esc(`Every NBN and Opticomm price change tracked in ${label}.`)}</description>
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>NBN price reports — Am I Getting Rorted?</title>
    <link>${origin}/reports</link>
    <atom:link href="${origin}/reports/feed.xml" rel="self" type="application/rss+xml" />
    <description>Monthly summary of Australian NBN and Opticomm price changes.</description>
    <language>en-au</language>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
