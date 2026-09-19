import type { APIRoute } from 'astro';
import { loadTrends } from '../../lib/trends';
import { OG, frame, renderPng, row, col, text, money } from '../../lib/og';

const NBN_MAIN = ['nbn-25-5', 'nbn-50-20', 'nbn-100-20', 'nbn-100-40', 'nbn-250-25', 'nbn-500-50', 'nbn-1000-50', 'nbn-2000-200'];
const OPTICOMM_MAIN = ['opticomm-25-10', 'opticomm-50-20', 'opticomm-100-20', 'opticomm-250-25', 'opticomm-500-50', 'opticomm-750-50', 'opticomm-1000-100', 'opticomm-1000-400'];

/** "Every tier at a glance" as a shareable table: mini line, price at first tracking, price now, change. */
export const GET: APIRoute = async ({ locals, url }) => {
  const network = url.searchParams.get('network') === 'opticomm' ? 'opticomm' : 'nbn';
  const { series, firstDate, lastDate } = await loadTrends(locals);
  const keys = network === 'opticomm' ? OPTICOMM_MAIN : NBN_MAIN;
  const rows = keys.map(k => series.find(s => s.key === k)).filter((s): s is NonNullable<typeof s> => !!s && s.points.length > 1);
  if (rows.length === 0) return new Response('Not found', { status: 404 });

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const sparkW = 220, sparkH = 34;
  const spark = (s: typeof rows[number]) => {
    const pts = s.points;
    const t0 = new Date(pts[0].date).getTime(), t1 = new Date(pts[pts.length - 1].date).getTime() || t0 + 1;
    const vals = pts.map(p => p.cheapest);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const x = (d: string) => ((new Date(d).getTime() - t0) / (t1 - t0 || 1)) * (sparkW - 4) + 2;
    const y = (v: number) => sparkH - 3 - ((v - lo) / (hi - lo || 1)) * (sparkH - 6);
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.cheapest).toFixed(1)}`).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sparkW}" height="${sparkH}" viewBox="0 0 ${sparkW} ${sparkH}"><path d="${d}" fill="none" stroke="${OG.accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  };

  const cell = (value: string, width: string, style: Record<string, string | number> = {}) =>
    text(value, { width, fontSize: '22px', color: OG.text, ...style });

  const header = row({ borderBottom: `1px solid ${OG.border}`, paddingBottom: '8px', marginBottom: '4px' }, [
    cell('Tier', '190px', { color: OG.muted, fontSize: '17px' }),
    cell('Cheapest plan since March', `${sparkW + 20}px`, { color: OG.muted, fontSize: '17px' }),
    cell(fmt(firstDate), '150px', { color: OG.muted, fontSize: '17px', justifyContent: 'flex-end' }),
    cell(fmt(lastDate), '150px', { color: OG.muted, fontSize: '17px', justifyContent: 'flex-end' }),
    cell('Change', '190px', { color: OG.muted, fontSize: '17px', justifyContent: 'flex-end' }),
  ]);

  const body = [
    text(`${network === 'opticomm' ? 'Opticomm' : 'NBN'} prices at a glance, ${new Date(lastDate).getFullYear()}`, { color: OG.text, fontSize: '40px', fontWeight: 700, lineHeight: 1.1, marginBottom: '14px' }),
    header,
    ...rows.map(s => {
      const first = s.points[0].cheapest, last = s.points[s.points.length - 1].cheapest;
      const delta = last - first;
      const pct = first > 0 ? (delta / first) * 100 : 0;
      const changeText = delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${money(Math.abs(delta))} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)`;
      return row({ alignItems: 'center', height: '44px', borderBottom: `1px solid ${OG.border}` }, [
        cell(s.label, '190px', { color: OG.secondary }),
        row({ width: `${sparkW + 20}px` }, [{ type: 'img', props: { src: spark(s), width: sparkW, height: sparkH } }]),
        cell(money(first), '150px', { color: OG.muted, justifyContent: 'flex-end' }),
        cell(money(last), '150px', { fontWeight: 700, justifyContent: 'flex-end' }),
        cell(changeText, '190px', { color: delta > 0 ? OG.rise : delta < 0 ? OG.drop : OG.muted, justifyContent: 'flex-end' }),
      ]);
    }),
  ];

  return renderPng(frame('Every tier at a glance', body, 'amigettingrorted.au/trends'));
};
