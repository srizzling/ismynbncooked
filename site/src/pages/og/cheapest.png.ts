import type { APIRoute } from 'astro';
import type { TierManifest } from '../../lib/types';
import { loadData } from '../../lib/load';
import { getFixtureManifest } from '../../lib/data';
import { displayProviderName } from '../../lib/providers';
import { OG, frame, renderPng, row, col, text, money } from '../../lib/og';

const MAIN_TIERS = ['nbn-25-5', 'nbn-50-20', 'nbn-100-20', 'nbn-100-40', 'nbn-250-25', 'nbn-500-50', 'nbn-1000-50', 'nbn-2000-200'];

/** "Cheapest NBN plan per tier right now" — the card behind the home page link preview. */
export const GET: APIRoute = async ({ locals }) => {
  const manifest = (await loadData<TierManifest>(locals, 'manifest.json')) ?? getFixtureManifest();
  const tiers = MAIN_TIERS.map(k => manifest.tiers.find(t => t.key === k)).filter((t): t is NonNullable<typeof t> => !!t && t.cheapest != null);
  const updated = new Date(manifest.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const maxPrice = Math.max(1, ...tiers.map(t => t.cheapest!));

  const body = [
    text('Cheapest NBN plan in every tier right now', { color: OG.text, fontSize: '44px', fontWeight: 700, marginBottom: '6px' }),
    text(`Ongoing monthly price across ${manifest.providers.length} providers, updated ${updated}`, { color: OG.muted, fontSize: '22px', marginBottom: '24px' }),
    col({ gap: '9px' }, tiers.map(t => row({ alignItems: 'center', gap: '14px' }, [
      text(t.label, { color: OG.secondary, fontSize: '22px', width: '170px', justifyContent: 'flex-end' }),
      { type: 'div', props: { style: { display: 'flex', width: `${Math.round((t.cheapest! / maxPrice) * 520)}px`, height: '16px', borderRadius: '4px', backgroundColor: OG.accent } } },
      text(money(t.cheapest!), { color: OG.text, fontSize: '24px', fontWeight: 700, width: '90px' }),
      text(displayProviderName(t.cheapestProvider ?? ''), { color: OG.muted, fontSize: '20px' }),
    ]))),
  ];

  return renderPng(frame('Daily snapshot', body));
};
