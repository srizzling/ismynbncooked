import { useState, useMemo } from 'preact/hooks';
import type { TierInfo, GroupedTier } from '../lib/types';
import { getGroupTiers, saveGroupTiers } from '../lib/storage';

interface TierCardData {
  key: string;
  label: string;
  speedDesc: string;
  downloadSpeed: number;
  uploadSpeed: number;
  network: string;
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
    downloadSpeed: g.downloadSpeed,
    uploadSpeed: 0,
    network: g.network,
    cheapest: g.cheapest ?? 0,
    cheapestEffective: g.cheapestEffective,
    cheapestProvider: g.cheapestProvider,
    average: g.average ?? 0,
    planCount: g.planCount,
  }));
}

function buildUngroupedCards(tiers: TierInfo[]): TierCardData[] {
  return tiers
    .sort((a, b) => a.downloadSpeed - b.downloadSpeed || a.uploadSpeed - b.uploadSpeed)
    .map(t => ({
      key: t.key,
      label: t.label,
      speedDesc: `${t.downloadSpeed}/${t.uploadSpeed} Mbps`,
      downloadSpeed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      network: t.network,
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
        Compare plans &rarr;
      </div>
    </a>
  );
}

const pillClass = (active: boolean) =>
  `text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
    active
      ? 'bg-accent/10 border-accent text-accent'
      : 'bg-surface border-surface-border text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
  }`;

interface Props {
  nbnGrouped: GroupedTier[];
  opticommGrouped: GroupedTier[];
  nbnTiers: TierInfo[];
  opticommTiers: TierInfo[];
}

export default function TierGrid({ nbnGrouped, opticommGrouped, nbnTiers, opticommTiers }: Props) {
  const [grouped, setGrouped] = useState(() => getGroupTiers());
  const [showNbn, setShowNbn] = useState(true);
  const [showOpticomm, setShowOpticomm] = useState(true);
  const [hiddenDownloads, setHiddenDownloads] = useState<Set<number>>(new Set());
  const [hiddenUploads, setHiddenUploads] = useState<Set<number>>(new Set());

  function toggleGroup() {
    const next = !grouped;
    setGrouped(next);
    saveGroupTiers(next);
  }

  function toggleDownload(speed: number) {
    setHiddenDownloads(prev => {
      const next = new Set(prev);
      if (next.has(speed)) next.delete(speed);
      else next.add(speed);
      return next;
    });
  }

  function toggleUpload(speed: number) {
    setHiddenUploads(prev => {
      const next = new Set(prev);
      if (next.has(speed)) next.delete(speed);
      else next.add(speed);
      return next;
    });
  }

  const nbnCards = grouped ? buildGroupedCards(nbnGrouped) : buildUngroupedCards(nbnTiers);
  const opticommCards = grouped ? buildGroupedCards(opticommGrouped) : buildUngroupedCards(opticommTiers);

  const allDownloads = useMemo(() => {
    const speeds = new Set<number>();
    nbnGrouped.forEach(g => speeds.add(g.downloadSpeed));
    opticommGrouped.forEach(g => speeds.add(g.downloadSpeed));
    nbnTiers.forEach(t => speeds.add(t.downloadSpeed));
    opticommTiers.forEach(t => speeds.add(t.downloadSpeed));
    return [...speeds].sort((a, b) => a - b);
  }, [nbnGrouped, opticommGrouped, nbnTiers, opticommTiers]);

  const allUploads = useMemo(() => {
    const speeds = new Set<number>();
    nbnTiers.forEach(t => speeds.add(t.uploadSpeed));
    opticommTiers.forEach(t => speeds.add(t.uploadSpeed));
    return [...speeds].sort((a, b) => a - b);
  }, [nbnTiers, opticommTiers]);

  const filteredNbn = nbnCards.filter(c =>
    !hiddenDownloads.has(c.downloadSpeed) &&
    (grouped || !hiddenUploads.has(c.uploadSpeed))
  );
  const filteredOpticomm = opticommCards.filter(c =>
    !hiddenDownloads.has(c.downloadSpeed) &&
    (grouped || !hiddenUploads.has(c.uploadSpeed))
  );

  const hasOpticomm = opticommCards.length > 0;

  return (
    <>
      {/* Filters */}
      <div class="mb-6 space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-neutral-500 mr-1">Network:</span>
          <button onClick={() => setShowNbn(!showNbn)} class={pillClass(showNbn)}>NBN</button>
          {hasOpticomm && (
            <button onClick={() => setShowOpticomm(!showOpticomm)} class={pillClass(showOpticomm)}>Opticomm</button>
          )}
          <span class="text-neutral-700 mx-1">|</span>
          <button
            onClick={toggleGroup}
            class={pillClass(grouped)}
            title={grouped ? 'Show individual upload speed tiers' : 'Group upload speed variants together'}
          >
            {grouped ? 'Grouped' : 'Group uploads'}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-neutral-500 mr-1">Download:</span>
          {allDownloads.map(speed => (
            <button
              key={speed}
              onClick={() => toggleDownload(speed)}
              class={pillClass(!hiddenDownloads.has(speed))}
            >
              {speed}
            </button>
          ))}
        </div>
        {!grouped && allUploads.length > 1 && (
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-neutral-500 mr-1">Upload:</span>
            {allUploads.map(speed => (
              <button
                key={speed}
                onClick={() => toggleUpload(speed)}
                class={pillClass(!hiddenUploads.has(speed))}
              >
                {speed}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* NBN tiers */}
      {showNbn && filteredNbn.length > 0 && (
        <section>
          <h2 class="font-display font-bold text-2xl mb-4">NBN plans by speed tier</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredNbn.map(card => <CardUI key={card.key} card={card} />)}
          </div>
        </section>
      )}

      {/* Opticomm tiers */}
      {showOpticomm && hasOpticomm && filteredOpticomm.length > 0 && (
        <section class={showNbn && filteredNbn.length > 0 ? 'mt-12' : ''}>
          <h2 class="font-display font-bold text-2xl mb-4">Opticomm plans</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredOpticomm.map(card => <CardUI key={card.key} card={card} />)}
          </div>
        </section>
      )}

      {/* Empty state */}
      {(!showNbn || filteredNbn.length === 0) && (!showOpticomm || filteredOpticomm.length === 0) && (
        <div class="text-center py-12 text-neutral-500">
          No tiers match your filters. Try enabling more speed tiers or networks above.
        </div>
      )}
    </>
  );
}
