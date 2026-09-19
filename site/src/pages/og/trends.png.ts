import type { APIRoute } from 'astro';
import { loadTrends } from '../../lib/trends';
import { OG, frame, renderPng, row, col, text, money } from '../../lib/og';

const KEYS = ['nbn-50-20', 'nbn-100-20', 'nbn-500-50', 'nbn-1000-50'];
const COLORS = ['#f97316', '#22d3ee', '#a78bfa', '#4ade80'];

/** The year's cheapest-plan lines for four mainstream tiers, drawn as an inline SVG image. */
export const GET: APIRoute = async ({ locals }) => {
  const { series, firstDate, lastDate } = await loadTrends(locals);
  const picked = KEYS.map((k, i) => ({ s: series.find(x => x.key === k), color: COLORS[i] })).filter(p => p.s && p.s.points.length > 1) as { s: NonNullable<typeof series[number]>; color: string }[];
  if (picked.length === 0) return new Response('Not found', { status: 404 });

  const w = 1080, h = 300, padL = 56, padR = 215, padT = 10, padB = 26;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const t0 = new Date(firstDate).getTime(), t1 = Math.max(new Date(lastDate).getTime(), t0 + 1);
  const vals = picked.flatMap(p => p.s.points.map(q => q.cheapest));
  const lo = Math.floor((Math.min(...vals) - 5) / 10) * 10, hi = Math.ceil((Math.max(...vals) + 5) / 10) * 10;
  const x = (d: string) => padL + ((new Date(d).getTime() - t0) / (t1 - t0)) * plotW;
  const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${ticks.map(t => `<line x1="${padL}" y1="${y(t)}" x2="${padL + plotW}" y2="${y(t)}" stroke="${OG.border}" stroke-width="1"/>`).join('')}
    ${picked.map(p => `<path d="${p.s.points.map((q, i) => `${i === 0 ? 'M' : 'L'}${x(q.date).toFixed(1)},${y(q.cheapest).toFixed(1)}`).join(' ')}" fill="none" stroke="${p.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    ${picked.map(p => { const last = p.s.points[p.s.points.length - 1]; return `<circle cx="${x(last.date).toFixed(1)}" cy="${y(last.cheapest).toFixed(1)}" r="6" fill="${p.color}" stroke="${OG.bg}" stroke-width="3"/>`; }).join('')}
  </svg>`;
  const dataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

  // Label carries the start and current price so the picture stands on its own
  const endLabels = picked.map(p => {
    const first = p.s.points[0], last = p.s.points[p.s.points.length - 1];
    const delta = last.cheapest - first.cheapest;
    const change = delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${money(Math.abs(delta))}`;
    return { y: y(last.cheapest), label: p.s.label, price: `${money(first.cheapest)} → ${money(last.cheapest)}`, change, up: delta > 0, down: delta < 0, color: p.color };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) if (endLabels[i].y - endLabels[i - 1].y < 40) endLabels[i].y = endLabels[i - 1].y + 40;

  const abs = (style: Record<string, string | number>, children: unknown) => ({ type: 'div', props: { style: { position: 'absolute', display: 'flex', ...style }, children } });

  const year = new Date(lastDate).getFullYear();
  const body = [
    text(`Cheapest NBN plan through ${year}`, { color: OG.text, fontSize: '42px', fontWeight: 700, lineHeight: 1.1, marginBottom: '4px' }),
    text(`Ongoing monthly price of the cheapest plan in each tier, ${fmt(firstDate)} to ${fmt(lastDate)}`, { color: OG.muted, fontSize: '20px', marginBottom: '14px' }),
    {
      type: 'div',
      props: {
        style: { position: 'relative', display: 'flex', width: `${w}px`, height: `${h}px` },
        children: [
          { type: 'img', props: { src: dataUri, width: w, height: h, style: { position: 'absolute', top: 0, left: 0 } } },
          ...ticks.map(t => abs({ left: '0px', top: `${y(t) - 10}px`, width: `${padL - 10}px`, justifyContent: 'flex-end', color: OG.muted, fontSize: '15px' }, `$${t}`)),
          abs({ left: `${padL}px`, top: `${h - 20}px`, color: OG.muted, fontSize: '15px' }, fmt(firstDate)),
          abs({ left: `${padL + plotW - 90}px`, top: `${h - 20}px`, width: '90px', justifyContent: 'flex-end', color: OG.muted, fontSize: '15px' }, fmt(lastDate)),
          ...endLabels.map(l => abs({ left: `${padL + plotW + 14}px`, top: `${l.y - 18}px`, flexDirection: 'column', gap: '1px' }, [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [
              { type: 'div', props: { style: { display: 'flex', width: '10px', height: '10px', borderRadius: '5px', backgroundColor: l.color } } },
              { type: 'div', props: { style: { display: 'flex', color: OG.text, fontSize: '16px', fontWeight: 700 }, children: l.label } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', color: OG.secondary, fontSize: '15px', paddingLeft: '18px' }, children: `${l.price} (${l.change})` } },
          ])),
        ],
      },
    },
  ];
  return renderPng(frame('Price trends', body, 'amigettingrorted.au/trends'));
};
