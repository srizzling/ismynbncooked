import { useState, useEffect, useMemo } from 'preact/hooks';
import { AU_STATES, STATE_LABELS, buildTierKey, buildGroupedTierKey, parseTierKey, parseGroupedTierKey, type AUState, type UserPlan, type TierManifest, type NetworkType } from '../lib/types';
import { saveUserPlan, getUserPlans, saveUserState, getUserState } from '../lib/storage';

interface Props {
  manifest: TierManifest;
}

export default function PlanChecker({ manifest }: Props) {
  const [selectedNetworks, setSelectedNetworks] = useState<Set<NetworkType>>(new Set(['nbn']));
  const [downloadSpeed, setDownloadSpeed] = useState<number | 'all'>(100);
  const [selectedUploads, setSelectedUploads] = useState<Set<number>>(new Set([20]));
  const [price, setPrice] = useState('');
  const [provider, setProvider] = useState('');
  const [state, setState] = useState<AUState>('nsw');
  const [hasExisting, setHasExisting] = useState(false);
  const [onPromo, setOnPromo] = useState(false);
  const [fullPrice, setFullPrice] = useState('');
  const [promoMonthsLeft, setPromoMonthsLeft] = useState('');

  // Derive available options from manifest
  const networks = useMemo(() => {
    const set = new Set(manifest.tiers.map(t => t.network));
    return ['nbn' as NetworkType, 'opticomm' as NetworkType].filter(n => set.has(n));
  }, [manifest]);

  // Derived: primary network for tier key building
  const network: NetworkType = selectedNetworks.size === 1 ? [...selectedNetworks][0] : 'nbn';
  const allNetworksSelected = selectedNetworks.size === networks.length && networks.length > 1;
  const allDownloadsSelected = downloadSpeed === 'all';

  const downloads = useMemo(() => {
    return [...new Set(manifest.tiers
      .filter(t => selectedNetworks.has(t.network))
      .map(t => t.downloadSpeed)
    )].sort((a, b) => a - b);
  }, [manifest, selectedNetworks]);

  const uploads = useMemo(() => {
    if (downloadSpeed === 'all') return [];
    return [...new Set(manifest.tiers
      .filter(t => selectedNetworks.has(t.network) && t.downloadSpeed === downloadSpeed)
      .map(t => t.uploadSpeed)
    )].sort((a, b) => a - b);
  }, [manifest, selectedNetworks, downloadSpeed]);

  const hasMultipleUploads = uploads.length > 1;
  const allUploadsSelected = uploads.length > 0 && selectedUploads.size === uploads.length;

  // Reset download when network changes
  useEffect(() => {
    if (downloadSpeed !== 'all' && !downloads.includes(downloadSpeed)) {
      setDownloadSpeed(downloads.includes(100) ? 100 : downloads[0] ?? 100);
    }
  }, [downloads]);

  // Reset upload when download changes
  useEffect(() => {
    const validUploads = uploads.filter(u => selectedUploads.has(u));
    if (validUploads.length === 0) {
      // Default to all uploads when there are multiple, or the first one
      setSelectedUploads(new Set(hasMultipleUploads ? uploads : [uploads[0] ?? 20]));
    }
  }, [uploads, hasMultipleUploads]);

  function toggleUpload(speed: number) {
    setSelectedUploads(prev => {
      const next = new Set(prev);
      if (next.has(speed)) {
        // Don't allow deselecting all
        if (next.size > 1) next.delete(speed);
      } else {
        next.add(speed);
      }
      return next;
    });
  }

  function toggleNetwork(n: NetworkType) {
    setSelectedNetworks(prev => {
      const next = new Set(prev);
      if (next.has(n)) {
        if (next.size > 1) next.delete(n);
      } else {
        next.add(n);
      }
      return next;
    });
  }

  function toggleAllUploads() {
    if (allUploadsSelected) {
      // Select just the first one
      setSelectedUploads(new Set([uploads[0]]));
    } else {
      setSelectedUploads(new Set(uploads));
    }
  }

  // Load existing plan
  useEffect(() => {
    const plans = getUserPlans();
    const entries = Object.entries(plans).filter(([_, v]) => v) as [string, UserPlan][];
    if (entries.length > 0) {
      setHasExisting(true);
      entries.sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt));
      const [key, plan] = entries[0];
      const parsed = parseTierKey(key);
      const parsedGrouped = !parsed ? parseGroupedTierKey(key) : null;
      if (parsed && manifest.tiers.some(t => t.key === key)) {
        setSelectedNetworks(new Set([parsed.network]));
        setDownloadSpeed(parsed.download);
        setSelectedUploads(new Set([parsed.upload]));
      } else if (parsedGrouped) {
        setSelectedNetworks(new Set([parsedGrouped.network]));
        setDownloadSpeed(parsedGrouped.download);
        const allUploads = manifest.tiers
          .filter(t => t.network === parsedGrouped.network && t.downloadSpeed === parsedGrouped.download)
          .map(t => t.uploadSpeed);
        setSelectedUploads(new Set(allUploads));
      }
      setPrice(plan.price.toString());
      setProvider(plan.provider);
      if (plan.fullPrice && plan.promoMonthsLeft) {
        setOnPromo(true);
        setFullPrice(plan.fullPrice.toString());
        const monthsSinceSaved = Math.floor(
          (Date.now() - new Date(plan.savedAt).getTime()) / (30 * 24 * 60 * 60 * 1000)
        );
        const remaining = Math.max(0, plan.promoMonthsLeft - monthsSinceSaved);
        setPromoMonthsLeft(remaining.toString());
      }
    }
    const savedState = getUserState();
    if (savedState) setState(savedState);
  }, []);

  const isCompareMode = allDownloadsSelected || allNetworksSelected;
  const tierKey = allDownloadsSelected
    ? 'compare'
    : allUploadsSelected || selectedUploads.size > 1
      ? buildGroupedTierKey(network, typeof downloadSpeed === 'number' ? downloadSpeed : 100)
      : buildTierKey(network, typeof downloadSpeed === 'number' ? downloadSpeed : 100, [...selectedUploads][0]);

  function handleSubmit(e: Event) {
    e.preventDefault();
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) return;

    const promoOpts = onPromo ? {
      fullPrice: parseFloat(fullPrice) || undefined,
      promoMonthsLeft: parseInt(promoMonthsLeft) || undefined,
    } : undefined;

    saveUserPlan(tierKey, p, provider, promoOpts);
    saveUserState(state);

    if (allDownloadsSelected) {
      // Compare across all download speeds
      const networksParam = [...selectedNetworks].join(',');
      const params = new URLSearchParams({
        networks: networksParam,
        download: 'all',
        upload: 'all',
      });
      window.location.href = `/compare?${params}`;
    } else if (!allUploadsSelected && selectedUploads.size > 1) {
      const uploadsParam = [...selectedUploads].sort((a, b) => a - b).join(',');
      const dl = typeof downloadSpeed === 'number' ? downloadSpeed : 100;
      const groupKey = buildGroupedTierKey(network, dl);
      window.location.href = `/${groupKey}?uploads=${uploadsParam}`;
    } else {
      window.location.href = `/${tierKey}`;
    }
  }

  const selectClass = "w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-accent appearance-none";
  const inputClass = "w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-accent";
  const pillClass = (active: boolean) =>
    `text-xs px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
      active
        ? 'bg-accent/10 border-accent text-accent'
        : 'bg-surface border-surface-border text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
    }`;

  return (
    <div class="bg-surface-raised border border-surface-border rounded-2xl p-5 sm:p-6 max-w-3xl">
      <h2 class="font-display font-bold text-xl mb-1">
        {hasExisting ? 'Update your plan' : 'Enter your plan'}
      </h2>
      <p class="text-neutral-400 text-sm mb-4">
        {hasExisting
          ? 'Your details are saved below. Update them or check a different speed tier.'
          : "Tell us what you're paying and we'll tell you if you're getting rorted"}
      </p>

      <form onSubmit={handleSubmit}>
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-4 sm:gap-6">
          {/* Left column — Speed tier */}
          <div class="space-y-3">
            <h3 class="text-xs font-medium text-neutral-400 uppercase tracking-wider">Speed tier</h3>
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-xs text-neutral-500 w-14 shrink-0">Network</span>
                {networks.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggleNetwork(n)}
                    class={pillClass(selectedNetworks.has(n))}
                  >
                    {n === 'nbn' ? 'NBN' : 'Opticomm'}
                  </button>
                ))}
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-xs text-neutral-500 w-14 shrink-0">Down</span>
                <button
                  type="button"
                  onClick={() => setDownloadSpeed(downloadSpeed === 'all' ? (downloads[0] ?? 100) : 'all')}
                  class={pillClass(allDownloadsSelected)}
                >
                  All
                </button>
                {!allDownloadsSelected && downloads.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDownloadSpeed(d)}
                    class={pillClass(downloadSpeed === d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {!allDownloadsSelected && uploads.length > 0 && (
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-xs text-neutral-500 w-14 shrink-0">Up</span>
                  {hasMultipleUploads && (
                    <button
                      type="button"
                      onClick={toggleAllUploads}
                      class={pillClass(allUploadsSelected)}
                    >
                      All
                    </button>
                  )}
                  {uploads.map(u => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => toggleUpload(u)}
                      class={pillClass(selectedUploads.has(u))}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Divider */}
          <div class="hidden sm:block w-px bg-surface-border" />

          {/* Right column — Your plan */}
          <div class="space-y-3">
            <h3 class="text-xs font-medium text-neutral-400 uppercase tracking-wider">Your plan</h3>
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="$/mo"
                  value={price}
                  onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
                  required
                  class="w-24 bg-surface border border-surface-border rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
                />
                <input
                  type="text"
                  placeholder="Provider"
                  value={provider}
                  onInput={(e) => setProvider((e.target as HTMLInputElement).value)}
                  class="w-32 bg-surface border border-surface-border rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
                />
                <select
                  value={state}
                  onChange={(e) => setState((e.target as HTMLSelectElement).value as AUState)}
                  class="w-20 bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-accent appearance-none"
                >
                  {AU_STATES.map((s) => (
                    <option key={s} value={s}>{STATE_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div class="mt-2 p-3 bg-surface border border-surface-border rounded-lg space-y-2">
                <h4 class="text-xs font-medium text-neutral-400 uppercase tracking-wider">On a promo or intro rate?</h4>
                <div class="flex flex-wrap items-center gap-2">
                  <div>
                    <label class="block text-xs text-neutral-500 mb-1">Price after promo</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="$99.00"
                      value={fullPrice}
                      onInput={(e) => {
                        setFullPrice((e.target as HTMLInputElement).value);
                        if ((e.target as HTMLInputElement).value) setOnPromo(true);
                      }}
                      class="w-28 bg-surface border border-surface-border rounded-lg px-2.5 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label class="block text-xs text-neutral-500 mb-1">Months left</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="36"
                      placeholder="e.g. 4"
                      value={promoMonthsLeft}
                      onInput={(e) => {
                        setPromoMonthsLeft((e.target as HTMLInputElement).value);
                        if ((e.target as HTMLInputElement).value) setOnPromo(true);
                      }}
                      class="w-24 bg-surface border border-surface-border rounded-lg px-2.5 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
                {onPromo && fullPrice && promoMonthsLeft && price && (
                  <div class="text-sm text-neutral-300">
                    ${parseFloat(price).toFixed(2)}/mo for {promoMonthsLeft}mo, then ${parseFloat(fullPrice).toFixed(2)}/mo
                    {(() => {
                      const promoLeft = parseInt(promoMonthsLeft) || 0;
                      const promoP = parseFloat(price) || 0;
                      const fullP = parseFloat(fullPrice) || 0;
                      if (promoLeft > 0 && promoP > 0 && fullP > 0) {
                        const totalCost12 = promoLeft <= 12
                          ? promoLeft * promoP + (12 - promoLeft) * fullP
                          : 12 * promoP;
                        const effective12 = totalCost12 / 12;
                        return <> — effective <span class="text-accent font-bold">${effective12.toFixed(2)}/mo</span> over 1yr</>;
                      }
                      return null;
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div class="mt-4">
          <button
            type="submit"
            class="w-full sm:w-auto bg-accent hover:bg-accent/90 text-white font-display font-bold rounded-lg px-8 py-3 text-lg transition-colors"
          >
            {isCompareMode ? 'Compare plans' : 'Am I getting rorted?'}
          </button>
        </div>
      </form>
    </div>
  );
}
