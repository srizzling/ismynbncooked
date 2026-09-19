import type { APIRoute } from 'astro';
import type { MonthlyReport } from '../../../lib/types';
import { loadData } from '../../../lib/load';
import { displayProviderName } from '../../../lib/providers';
import { OG, frame, renderPng, row, col, text, money } from '../../../lib/og';

export const GET: APIRoute = async ({ params, locals }) => {
  const month = params.month ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response('Not found', { status: 404 });
  const report = await loadData<MonthlyReport>(locals, `reports/${month}.json`);
  if (!report) return new Response('Not found', { status: 404 });

  const [y, m] = month.split('-').map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const s = report.summary;

  // Top movers by cheapest-price delta, drawn as a diverging bar list
  const movers = report.tiers
    .map(t => ({ label: t.label, delta: Math.round((t.cheapestEnd - t.cheapestStart) * 100) / 100 }))
    .filter(t => t.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);
  const maxAbs = Math.max(1, ...movers.map(t => Math.abs(t.delta)));

  const stat = (value: string, label: string, color = OG.text) => col({ width: '230px' }, [
    text(value, { color, fontSize: '48px', fontWeight: 700, lineHeight: 1 }),
    text(label, { color: OG.muted, fontSize: '20px', marginTop: '6px' }),
  ]);

  const body = [
    text(`${label} NBN price report${report.final ? '' : ' (so far)'}`, { color: OG.text, fontSize: '42px', fontWeight: 700, lineHeight: 1.1, marginBottom: '28px' }),
    row({ gap: '16px', marginBottom: '24px' }, [
      stat(String(s.rises), 'price rises', OG.rise),
      stat(String(s.drops), 'price drops', OG.drop),
      stat(`${s.tiersDearer} / ${s.tiersCheaper}`, 'tiers dearer / cheaper'),
      stat(String(s.newProviders.length), 'new providers'),
    ]),
    movers.length > 0
      ? col({ gap: '7px' }, [
          text('Biggest moves in the cheapest plan', { color: OG.secondary, fontSize: '20px', marginBottom: '2px' }),
          ...movers.map(t => row({ alignItems: 'center', gap: '12px' }, [
            text(t.label, { color: OG.secondary, fontSize: '19px', width: '200px', justifyContent: 'flex-end', whiteSpace: 'nowrap' }),
            row({ width: '520px', height: '18px', alignItems: 'center' }, [
              row({ width: '260px', justifyContent: 'flex-end' }, t.delta < 0 ? [el(Math.abs(t.delta) / maxAbs, OG.drop)] : []),
              row({ width: '260px', justifyContent: 'flex-start' }, t.delta > 0 ? [el(t.delta / maxAbs, OG.rise)] : []),
            ]),
            text(`${t.delta > 0 ? '+' : '−'}${money(Math.abs(t.delta))}`, { color: OG.text, fontSize: '20px', fontWeight: 700 }),
          ])),
        ])
      : text(s.biggestRise
          ? `Biggest rise: ${displayProviderName(s.biggestRise.provider)} on ${s.biggestRise.label}, ${money(s.biggestRise.from)} → ${money(s.biggestRise.to)}`
          : 'No provider changed an ongoing price this month.', { color: OG.secondary, fontSize: '24px' }),
  ];

  return renderPng(frame('Monthly price report', body, `amigettingrorted.au/reports/${month}`));
};

function el(fraction: number, color: string) {
  return { type: 'div', props: { style: { display: 'flex', width: `${Math.max(6, Math.round(fraction * 256))}px`, height: '14px', borderRadius: '4px', backgroundColor: color } } };
}
