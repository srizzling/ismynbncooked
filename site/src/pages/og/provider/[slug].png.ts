import type { APIRoute } from 'astro';
import type { ProviderData } from '../../../lib/types';
import { loadData } from '../../../lib/load';
import { displayProviderName, slugifyProvider } from '../../../lib/providers';
import { LEVELS, LEVEL_ORDER, summariseRort } from '../../../lib/cooked';
import { OG, frame, renderPng, row, col, text, money } from '../../../lib/og';

export const GET: APIRoute = async ({ params, locals }) => {
  const slug = params.slug ?? '';
  if (!slug || slug !== slugifyProvider(slug)) return new Response('Not found', { status: 404 });
  const provider = await loadData<ProviderData>(locals, `providers/${slug}.json`);
  if (!provider) return new Response('Not found', { status: 404 });

  const name = displayProviderName(provider.name);
  const overpays = provider.tiers.map(t => t.tierCheapest > 0 ? (t.plan.monthlyPrice - t.tierCheapest) / t.tierCheapest : 0);
  const rort = summariseRort(overpays);
  const cheapestIn = provider.tiers.filter(t => t.rank === 1).length;
  const rortIn = provider.tiers.filter(t => t.tierCheapest > 0 && (t.plan.monthlyPrice - t.tierCheapest) / t.tierCheapest >= 0.15).length;
  const cheapest = Math.min(...provider.tiers.map(t => t.plan.monthlyPrice));
  const levelColor = Object.fromEntries(LEVELS.map(l => [l.level, l.color])) as Record<string, string>;
  const levelLabel = Object.fromEntries(LEVELS.map(l => [l.level, l.label])) as Record<string, string>;

  const stat = (value: string, label: string, color = OG.text) => col({ width: '210px' }, [
    text(value, { color, fontSize: '52px', fontWeight: 700, lineHeight: 1 }),
    text(label, { color: OG.muted, fontSize: '20px', marginTop: '6px' }),
  ]);

  const segments = rort ? LEVEL_ORDER.map(l => ({ l, n: rort.counts[l] })).filter(s => s.n > 0) : [];

  const body = [
    text(name, { color: OG.text, fontSize: '60px', fontWeight: 700, lineHeight: 1.05 }),
    rort
      ? row({ alignItems: 'baseline', gap: '16px', marginTop: '10px', marginBottom: '30px' }, [
          text('Rort Scale:', { color: OG.secondary, fontSize: '28px' }),
          text(rort.label, { color: rort.color, fontSize: '40px', fontWeight: 700 }),
          text(rort.medianOverpay <= 0 ? 'typically the cheapest in its tier' : `typically ${Math.round(rort.medianOverpay * 100)}% above the cheapest in its tier`, { color: OG.muted, fontSize: '22px' }),
        ])
      : text('', { marginBottom: '30px' }),
    row({ gap: '20px', marginBottom: '30px' }, [
      stat(money(cheapest), 'cheapest plan / mo'),
      stat(String(provider.tiers.length), 'speed tiers'),
      stat(String(cheapestIn), 'tiers where cheapest', '#4ade80'),
      stat(String(rortIn), 'tiers where a rort', OG.rise),
    ]),
    ...(rort ? [
      row({ height: '22px', gap: '3px', borderRadius: '11px', overflow: 'hidden', width: '1080px' }, segments.map(s =>
        ({ type: 'div', props: { style: { display: 'flex', width: `${Math.round((s.n / rort.tierCount) * 1080)}px`, height: '22px', backgroundColor: levelColor[s.l] } } }))),
      row({ gap: '26px', marginTop: '12px' }, segments.map(s => row({ alignItems: 'center', gap: '8px' }, [
        { type: 'div', props: { style: { display: 'flex', width: '14px', height: '14px', borderRadius: '7px', backgroundColor: levelColor[s.l] } } },
        text(`${levelLabel[s.l]} ${s.n}`, { color: OG.secondary, fontSize: '20px' }),
      ]))),
    ] : []),
  ];

  return renderPng(frame('Provider report card', body, `amigettingrorted.au/provider/${slug}`));
};
