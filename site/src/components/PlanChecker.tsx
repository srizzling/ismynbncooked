import { useState, useEffect, useMemo } from 'preact/hooks';
import { AU_STATES, STATE_LABELS, buildTierKey, buildGroupedTierKey, parseTierKey, parseGroupedTierKey, type AUState, type UserPlan, type TierManifest, type NetworkType } from '../lib/types';
import { saveUserPlan, getUserPlans, saveUserState, getUserState } from '../lib/storage';

interface Props {
  manifest: TierManifest;
}

export default function PlanChecker({ manifest }: Props) {
  const [network, setNetwork] = useState<NetworkType>('nbn');
  const [downloadSpeed, setDownloadSpeed] = useState(100);
  const [uploadSpeed, setUploadSpeed] = useState<number | 'all'>(20);
  const [price, setPrice] = useState('');
  const [provider, setProvider] = useState('');
  const [state, setState] = useState<AUState>('nsw');
  const [hasExisting, setHasExisting] = useState(false);
  const [onPromo, setOnPromo] = useState(false);
  const [fullPrice, setFullPrice] = useState('');
  const [promoMonthsLeft, setPromoMonthsLeft] = useState('');

  // Cross-tier comparison checkboxes
  const [acrossDownload, setAcrossDownload] = useState(false);
  const [acrossUpload, setAcrossUpload] = useState(false);
  const [includeOpticomm, setIncludeOpticomm] = useState(false);

  // Derive available options from manifest
  const networks = useMemo(() => {
    const set = new Set(manifest.tiers.map(t => t.network));
    return ['nbn' as NetworkType, 'opticomm' as NetworkType].filter(n => set.has(n));
  }, [manifest]);

  const downloads = useMemo(() => {
    return [...new Set(manifest.tiers
      .filter(t => t.network === network)
      .map(t => t.downloadSpeed)
    )].sort((a, b) => a - b);
  }, [manifest, network]);

  const uploads = useMemo(() => {
    return [...new Set(manifest.tiers
      .filter(t => t.network === network && t.downloadSpeed === downloadSpeed)
      .map(t => t.uploadSpeed)
    )].sort((a, b) => a - b);
  }, [manifest, network, downloadSpeed]);

  const hasMultipleUploads = uploads.length > 1;

  // Has Opticomm tiers for the current download speed?
  const hasOpticomm = useMemo(() => {
    return manifest.tiers.some(t => t.network === 'opticomm' && t.downloadSpeed === downloadSpeed);
  }, [manifest, downloadSpeed]);

  // Reset download when network changes
  useEffect(() => {
    if (!downloads.includes(downloadSpeed)) {
      setDownloadSpeed(downloads.includes(100) ? 100 : downloads[0] ?? 100);
    }
  }, [downloads]);

  // Reset upload when download changes
  useEffect(() => {
    if (uploadSpeed !== 'all' && !uploads.includes(uploadSpeed)) {
      // Default to "all" when there are multiple upload variants
      setUploadSpeed(hasMultipleUploads ? 'all' : (uploads[0] ?? 20));
    }
  }, [uploads, hasMultipleUploads]);

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
        setNetwork(parsed.network);
        setDownloadSpeed(parsed.download);
        setUploadSpeed(parsed.upload);
      } else if (parsedGrouped) {
        setNetwork(parsedGrouped.network);
        setDownloadSpeed(parsedGrouped.download);
        setUploadSpeed('all');
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

  const tierKey = uploadSpeed === 'all'
    ? buildGroupedTierKey(network, downloadSpeed)
    : buildTierKey(network, downloadSpeed, uploadSpeed);
  const isCompareMode = acrossDownload || acrossUpload || includeOpticomm;

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

    if (isCompareMode) {
      const across: string[] = [];
      if (acrossDownload) across.push('download');
      if (acrossUpload) across.push('upload');
      if (includeOpticomm) across.push('opticomm');
      const params = new URLSearchParams({
        network,
        download: downloadSpeed.toString(),
        upload: uploadSpeed === 'all' ? 'all' : uploadSpeed.toString(),
        across: across.join(','),
      });
      window.location.href = `/compare?${params}`;
    } else {
      window.location.href = `/${tierKey}`;
    }
  }

  const selectClass = "w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-accent appearance-none";
  const inputClass = "w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-accent";

  return (
    <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 sm:p-8">
      <h2 class="font-display font-bold text-2xl mb-1">
        {hasExisting ? 'Update your plan' : 'Enter your plan'}
      </h2>
      <p class="text-neutral-400 text-sm mb-6">
        {hasExisting
          ? 'Your details are saved below. Update them or check a different speed tier.'
          : "Tell us what you're paying and we'll tell you if you're getting rorted"}
      </p>

      <form onSubmit={handleSubmit} class="space-y-4">
        {/* Speed tier — cascading selectors */}
        <div>
          <label class="block text-sm text-neutral-400 mb-2">Speed tier</label>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Network */}
            <div>
              <label class="block text-xs text-neutral-500 mb-1">Network</label>
              <select
                value={network}
                onChange={(e) => setNetwork((e.target as HTMLSelectElement).value as NetworkType)}
                class={selectClass}
              >
                {networks.map(n => (
                  <option key={n} value={n}>{n === 'nbn' ? 'NBN' : 'Opticomm'}</option>
                ))}
              </select>
            </div>

            {/* Download */}
            <div>
              <label class="block text-xs text-neutral-500 mb-1">Download</label>
              <select
                value={downloadSpeed}
                onChange={(e) => setDownloadSpeed(parseInt((e.target as HTMLSelectElement).value))}
                class={selectClass}
              >
                {downloads.map(d => (
                  <option key={d} value={d}>{d} Mbps</option>
                ))}
              </select>
            </div>

            {/* Upload */}
            <div>
              <label class="block text-xs text-neutral-500 mb-1">Upload</label>
              <select
                value={uploadSpeed}
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  setUploadSpeed(val === 'all' ? 'all' : parseInt(val));
                }}
                class={selectClass}
              >
                {hasMultipleUploads && (
                  <option value="all">All uploads</option>
                )}
                {uploads.map(u => (
                  <option key={u} value={u}>{u} Mbps</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tier confirmation */}
          <div class="mt-2 text-xs text-neutral-500">
            Selected: <span class="text-white font-medium">
              {network === 'nbn' ? 'NBN' : 'Opticomm'} {downloadSpeed}{uploadSpeed === 'all' ? '' : `/${uploadSpeed}`} Mbps
              {uploadSpeed === 'all' && <span class="text-neutral-400"> (all upload speeds)</span>}
            </span>
          </div>
        </div>

        {/* Price + Provider + State */}
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Monthly price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="$89.00"
              value={price}
              onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
              required
              class={inputClass}
            />
          </div>
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Provider (optional)</label>
            <input
              type="text"
              placeholder="e.g. Telstra"
              value={provider}
              onInput={(e) => setProvider((e.target as HTMLInputElement).value)}
              class={inputClass}
            />
          </div>
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Your state</label>
            <select
              value={state}
              onChange={(e) => setState((e.target as HTMLSelectElement).value as AUState)}
              class={selectClass}
            >
              {AU_STATES.map((s) => (
                <option key={s} value={s}>{STATE_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Promo toggle */}
        <div>
          <label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={onPromo}
              onChange={() => setOnPromo(!onPromo)}
              class="accent-accent"
            />
            I'm on a promo/introductory rate
          </label>
        </div>

        {/* Promo details */}
        {onPromo && (
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4 border-l-2 border-accent/30">
            <div>
              <label class="block text-sm text-neutral-400 mb-1">Price after promo ends</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="$99.00"
                value={fullPrice}
                onInput={(e) => setFullPrice((e.target as HTMLInputElement).value)}
                class={inputClass}
              />
            </div>
            <div>
              <label class="block text-sm text-neutral-400 mb-1">Months left on promo</label>
              <input
                type="number"
                step="1"
                min="0"
                max="36"
                placeholder="e.g. 4"
                value={promoMonthsLeft}
                onInput={(e) => setPromoMonthsLeft((e.target as HTMLInputElement).value)}
                class={inputClass}
              />
            </div>
            {fullPrice && promoMonthsLeft && price && (
              <div class="sm:col-span-2 text-sm text-neutral-400 bg-surface border border-surface-border rounded-lg p-3">
                Paying <span class="text-white font-medium">${parseFloat(price).toFixed(2)}/mo</span> for{' '}
                <span class="text-white font-medium">{promoMonthsLeft} more months</span>, then{' '}
                <span class="text-white font-medium">${parseFloat(fullPrice).toFixed(2)}/mo</span> ongoing.
                {(() => {
                  const promoLeft = parseInt(promoMonthsLeft) || 0;
                  const promoP = parseFloat(price) || 0;
                  const fullP = parseFloat(fullPrice) || 0;
                  if (promoLeft > 0 && promoP > 0 && fullP > 0) {
                    const totalCost12 = promoLeft <= 12
                      ? promoLeft * promoP + (12 - promoLeft) * fullP
                      : 12 * promoP;
                    const effective12 = totalCost12 / 12;
                    return (
                      <span class="block mt-1">
                        Your effective monthly over 12 months: <span class="text-accent font-medium">${effective12.toFixed(2)}/mo</span>
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </div>
        )}

        {/* Cross-tier comparison options */}
        <div class="space-y-2">
          <div class="text-sm text-neutral-400">Compare across</div>
          <div class="flex flex-wrap gap-x-6 gap-y-2">
            <label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={acrossDownload}
                onChange={() => setAcrossDownload(!acrossDownload)}
                class="accent-accent"
              />
              All download speeds
            </label>
            <label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={acrossUpload}
                onChange={() => setAcrossUpload(!acrossUpload)}
                class="accent-accent"
              />
              All upload speeds
            </label>
            {network === 'nbn' && hasOpticomm && (
              <label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeOpticomm}
                  onChange={() => setIncludeOpticomm(!includeOpticomm)}
                  class="accent-accent"
                />
                Include Opticomm
              </label>
            )}
          </div>
        </div>

        <button
          type="submit"
          class="w-full sm:w-auto bg-accent hover:bg-accent/90 text-white font-display font-bold rounded-lg px-8 py-3 text-lg transition-colors"
        >
          {isCompareMode ? 'Compare plans' : 'Am I getting rorted?'}
        </button>
      </form>
    </div>
  );
}
