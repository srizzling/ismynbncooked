import { useState } from 'preact/hooks';
import type { TierInfo, GroupedTier } from '../lib/types';
import { getGroupTiers, saveGroupTiers } from '../lib/storage';

interface TierCardData {
  key: string;
  label: string;
  speedDesc: string;
  cheapest: number;
  cheapestEffective?: number;
  cheapestProvider?: string;
  average: number;
  planCount: number;
}

function buildGroupedCards(groups: GroupedTier[]): TierCardData[] {
  return groups.map(g => ({
    key: g.groupKey,
    label: g.label,
    speedDesc: g.tiers.length > 1
      ? `${g.downloadSpeed} Mbps down · ${g.tiers.length} upload options`
      : `${g.downloadSpeed}/${g.tiers[0]?.uploadSpeed ?? 0} Mbps`,
    cheapest: g.cheapest ?? 0,
    cheapestEffective: g.cheapestEffective,
    cheapestProvider: g.cheapestProvider,
    average: g.average ?? 0,
    planCount: g.planCount,
  }));
}

function buildUngroupedCards(tiers: TierInfo[]): TierCardData[] {
  return tiers
    .filter(t => t.planCount != null && t.planCount > 0)
    .sort((a, b) => a.downloadSpeed - b.downloadSpeed || a.uploadSpeed - b.uploadSpeed)
    .map(t => ({
      key: t.key,
      label: t.label,
      speedDesc: `${t.downloadSpeed}/${t.uploadSpeed} Mbps`,
      cheapest: t.cheapest ?? 0,
      cheapestEffective: t.cheapestEffective,
      cheapestProvider: t.cheapestProvider,
      average: t.average ?? 0,
      planCount: t.planCount ?? 0,
    }));
}

function CardUI({ card }: { card: TierCardData }) {
  const displayPrice = card.cheapestEffective && card.cheapestEffective < card.cheapest
    ? card.cheapestEffective : card.cheapest;
  const hasPromo = card.cheapestEffective != null && card.cheapestEffective < card.cheapest;

  return (
    <a
      href={`/${card.key}`}
      class="block bg-surface-raised border border-surface-border rounded-2xl p-6 hover:border-accent transition-colors group"
    >
      <h3 class="font-display font-bold text-2xl group-hover:text-accent transition-colors">
        {card.label}
      </h3>
      <p class="text-sm text-neutral-500 mt-1">{card.speedDesc}</p>

      <div class="mt-4 space-y-2">
        <div class="flex justify-between items-baseline">
          <span class="text-neutral-400 text-sm">From</span>
          <div class="text-right">
            <span class="text-2xl font-display font-bold tabular-nums">
              ${displayPrice.toFixed(0)}<span class="text-sm text-neutral-500">/mo</span>
              {hasPromo && <span class="text-xs text-accent ml-1">promo</span>}
            </span>
            {card.cheapestProvider && (
              <div class="text-xs text-neutral-500">{card.cheapestProvider}</div>
            )}
          </div>
        </div>
        <div class="flex justify-between items-baseline">
          <span class="text-neutral-400 text-sm">Average</span>
          <span class="text-lg tabular-nums text-neutral-300">
            ${card.average.toFixed(0)}<span class="text-sm text-neutral-500">/mo</span>
          </span>
        </div>
        <div class="flex justify-between items-baseline">
          <span class="text-neutral-400 text-sm">Plans</span>
          <span class="text-neutral-300 tabular-nums">{card.planCount}</span>
        </div>
      </div>

      <div class="mt-4 text-sm text-accent opacity-0 group-hover:opacity-100 transition-opacity">
        Compare plans →
      </div>
    </a>
  );
}

interface Props {
  nbnGrouped: GroupedTier[];
  opticommGrouped: GroupedTier[];
  nbnTiers: TierInfo[];
  opticommTiers: TierInfo[];
}

export default function TierGrid({ nbnGrouped, opticommGrouped, nbnTiers, opticommTiers }: Props) {
  const [grouped, setGrouped] = useState(() => getGroupTiers());

  function toggle() {
    const next = !grouped;
    setGrouped(next);
    saveGroupTiers(next);
  }

  const nbnCards = grouped ? buildGroupedCards(nbnGrouped) : buildUngroupedCards(nbnTiers);
  const opticommCards = grouped ? buildGroupedCards(opticommGrouped) : buildUngroupedCards(opticommTiers);

  return (
    <>
      <section>
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-display font-bold text-2xl">Compare NBN plans by speed tier</h2>
          <button
            onClick={toggle}
            class="text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap bg-surface border-surface-border text-neutral-400 hover:border-neutral-600 hover:text-neutral-300"
            title={grouped ? 'Show individual upload speed tiers' : 'Group upload speed variants together'}
          >
            {grouped ? 'Show all upload speeds' : 'Group by download'}
          </button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {nbnCards.map(card => <CardUI key={card.key} card={card} />)}
        </div>
      </section>

      {opticommCards.length > 0 && (
        <section class="mt-12">
          <h2 class="font-display font-bold text-2xl mb-4">Opticomm plans</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {opticommCards.map(card => <CardUI key={card.key} card={card} />)}
          </div>
        </section>
      )}
    </>
  );
}
