import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import type { CookedResult, TierManifest } from '../lib/types';
import { parseTierKey, parseGroupedTierKey, buildTierLabel } from '../lib/types';
import { calculateCooked } from '../lib/cooked';
import { LEVELS } from '../lib/cooked';
import { resolveUserPlan, saveUserPlan, clearUserPlan } from '../lib/storage';
import { buildShareUrl, type ShareData, type ShareManifests } from '../lib/share';
import RortTimeline from './RortTimeline';

interface Props {
  tierKey: string;
  /** Exact tier the saved plan belongs to when it differs from tierKey (grouped pages), e.g. nbn-1000-50 on /nbn-1000 */
  planKey?: string;
  cheapestPrice: number;
  cheapestEffective?: number;
  cheapestProviderName?: string;
  /** What the verdict is measured against, e.g. "NBN 1000/50". sameSpeed is false when the user is comparing another speed than their own plan's. */
  scope?: { label: string; sameSpeed: boolean; yourLabel: string };
  horizon?: number;
  manifest?: TierManifest;
  onCookedChange?: (result: CookedResult | null) => void;
}

/** Compute remaining promo months from saved data */
function getPromoRemaining(plan: { promoMonthsLeft?: number; savedAt: string }): number {
  if (!plan.promoMonthsLeft) return 0;
  const monthsSince = Math.floor((Date.now() - new Date(plan.savedAt).getTime()) / (30 * 24 * 60 * 60 * 1000));
  return Math.max(0, plan.promoMonthsLeft - monthsSince);
}

/** Compute the user's effective rate considering remaining promo months over a given horizon */
function computeEffectiveRate(price: number, fullPrice: number | undefined, promoMonthsLeft: number, months: number = 12): number {
  if (!fullPrice || promoMonthsLeft <= 0) return fullPrice ?? price;
  const promoMonths = Math.min(promoMonthsLeft, months);
  const fullMonths = months - promoMonths;
  return (promoMonths * price + fullMonths * fullPrice) / months;
}

function RortScale({ currentLevel }: { currentLevel: string }) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    popupRef.current?.scrollIntoView({ block: 'nearest' });
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reverse so we display from best to worst (Sweet As first)
  const ordered = [...LEVELS].reverse();

  return (
    <div class="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        class="text-sm text-neutral-500 hover:text-neutral-300 underline decoration-dashed underline-offset-2 transition-colors"
      >
        What does this mean?
      </button>
      {open && (
        <>
          <div class="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div ref={popupRef} class="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-40 bg-surface border border-surface-border rounded-xl shadow-2xl p-4 w-72 sm:w-80">
            <div class="font-display font-bold text-sm text-white mb-3">The Rort Scale</div>
            <div class="space-y-2">
              {ordered.map((level) => {
                const isCurrent = level.level === currentLevel;
                return (
                  <div
                    key={level.level}
                    class={`flex items-start gap-3 rounded-lg px-3 py-2 transition-colors ${
                      isCurrent ? 'bg-white/5 ring-1 ring-white/10' : 'opacity-50'
                    }`}
                  >
                    <div
                      class="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                      style={{ backgroundColor: level.color }}
                    />
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span
                          class="font-bold text-sm"
                          style={{ color: isCurrent ? level.color : undefined }}
                        >
                          {level.label}
                        </span>
                        {isCurrent && (
                          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-neutral-300">
                            YOU
                          </span>
                        )}
                      </div>
                      <div class="text-xs text-neutral-400 mt-0.5">
                        {level.level === 'winning'
                          ? 'Cheaper than the cheapest'
                          : level.threshold > 0
                            ? `${(level.threshold * 100).toFixed(0)}%+ overpaying`
                            : '0–5% overpaying'}
                      </div>
                      {isCurrent && (
                        <div class="text-xs text-neutral-300 mt-1">{level.description}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function CookedRating({ tierKey, planKey, cheapestPrice, cheapestEffective, cheapestProviderName, scope, horizon = 12, manifest, onCookedChange }: Props) {
  const ratedKey = planKey ?? tierKey;
  const parsed = parseTierKey(ratedKey);
  const grouped = !parsed ? parseGroupedTierKey(ratedKey) : null;
  const tierLabel = parsed
    ? buildTierLabel(parsed.network, parsed.download, parsed.upload)
    : grouped
      ? `${grouped.network === 'nbn' ? 'NBN' : 'Opticomm'} ${grouped.download}`
      : ratedKey;
  const [price, setPrice] = useState('');
  const [provider, setProvider] = useState('');
  const [result, setResult] = useState<CookedResult | null>(null);
  const [hasExisting, setHasExisting] = useState(false);
  const [userFullPrice, setUserFullPrice] = useState<number | null>(null);
  const [userPromoLeft, setUserPromoLeft] = useState<number>(0);
  const [shareLabel, setShareLabel] = useState('Share');

  const baseline = cheapestEffective && cheapestEffective < cheapestPrice
    ? cheapestEffective : cheapestPrice;

  const handleShare = useCallback(async (currentPrice: number) => {
    if (!result) return;
    const data: ShareData = {
      s: ratedKey,
      p: Math.round(currentPrice * 100),
      v: provider,
      c: Math.round(baseline * 100),
      l: result.level,
      cp: cheapestProviderName ?? '',
      h: horizon,
      fp: userFullPrice ? Math.round(userFullPrice * 100) : 0,
      pd: userPromoLeft,
    };
    const shareManifests: ShareManifests | undefined = manifest ? {
      tiers: manifest,
      providers: manifest.providers ?? [],
    } : undefined;
    const url = buildShareUrl(window.location.origin, data, shareManifests);

    if (navigator.share) {
      try {
        await navigator.share({ title: `My ${tierLabel} is ${result.label}`, url });
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(url);
    setShareLabel('Copied!');
    setTimeout(() => setShareLabel('Share'), 2000);
  }, [result, ratedKey, provider, baseline, cheapestProviderName, manifest]);

  useEffect(() => {
    const existing = resolveUserPlan(tierKey)?.plan;
    if (existing) {
      setPrice(existing.price.toString());
      setProvider(existing.provider);
      setHasExisting(true);

      if (existing.fullPrice && existing.promoMonthsLeft) {
        const remaining = getPromoRemaining(existing);
        setUserFullPrice(existing.fullPrice);
        setUserPromoLeft(remaining);
        // Rate on current promo price, not blended effective — the user cares about what they're paying NOW
        const r = remaining > 0
          ? calculateCooked(existing.price, baseline)
          : calculateCooked(existing.fullPrice, baseline);
        setResult(r);
        onCookedChange?.(r);
      } else {
        const r = calculateCooked(existing.price, baseline);
        setResult(r);
        onCookedChange?.(r);
      }
    }
  }, [tierKey, planKey, cheapestPrice, baseline, horizon]);

  function handleSubmit(e: Event) {
    e.preventDefault();
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) return;
    saveUserPlan(tierKey, p, provider);
    const r = calculateCooked(p, baseline);
    setResult(r);
    onCookedChange?.(r);
    setHasExisting(true);
  }

  function handleClear() {
    clearUserPlan(tierKey);
    // Keep price and provider in the form so "Change" means edit, not start over
    setResult(null);
    onCookedChange?.(null);
    setHasExisting(false);
    setUserFullPrice(null);
    setUserPromoLeft(0);
  }

  const periodLabel = horizon === 12 ? '1 year' : horizon === 24 ? '2 years' : `${horizon} months`;

  if (result) {
    const currentPrice = parseFloat(price);
    const isOnPromo = userFullPrice && userPromoLeft > 0;

    return (
      <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 sm:p-8 text-center">
        <div class="text-sm text-neutral-400 mb-1">
          {scope ? (
            <>
              {isOnPromo ? 'At your current promo price, over ' : 'Over '}{periodLabel}, against {scope.label} plans
              {scope.sameSpeed ? '' : ` (not the speed of your ${scope.yourLabel} plan)`}, your plan is...
            </>
          ) : (
            <>{isOnPromo ? 'At your current promo price, your ' : 'Your '}{tierLabel} is...</>
          )}
        </div>
        <div class="text-4xl sm:text-5xl font-display font-bold" style={{ color: result.color }}>
          {result.label}
        </div>
        {isOnPromo && (
          <div class="text-xs text-neutral-500 mt-1">
            Based on what you're paying now (${currentPrice.toFixed(2)}/mo) vs cheapest (${baseline.toFixed(2)}/mo)
          </div>
        )}

        <div class="mt-2 flex items-center justify-center gap-3">
          <RortScale currentLevel={result.level} />
          <span class="text-neutral-700">·</span>
          <a href="/how-it-works" aria-label="How the Rort Scale rating system works" class="text-sm text-neutral-500 hover:text-neutral-300 underline decoration-dashed underline-offset-2 transition-colors">
            How it works
          </a>
        </div>

        {result.monthlySavings > 0 ? (
          <div class="mt-4 space-y-1">
            <p class="text-lg text-neutral-300">
              You're paying <span class="font-bold text-white">{(result.overpayPercent * 100).toFixed(0)}% more</span> than the cheapest plan in this comparison
            </p>
            <p class="text-neutral-400">
              That's <span class="font-medium text-white">${result.monthlySavings.toFixed(2)}/mo</span> or{' '}
              <span class="font-medium text-white">${result.yearlySavings.toFixed(0)}/yr</span> you could save
            </p>
          </div>
        ) : result.level === 'winning' ? (
          <div class="mt-4 space-y-1">
            <p class="text-lg text-neutral-300">
              You're paying <span class="font-bold" style={{ color: result.color }}>${Math.abs(currentPrice - baseline).toFixed(2)}/mo less</span> than the cheapest plan in this comparison
            </p>
            <p class="text-neutral-400">
              Whatever you did, don't change a thing.            </p>
          </div>
        ) : (
          <p class="mt-4 text-lg text-neutral-300">
            You're on the cheapest plan. Sweet as.          </p>
        )}

        <p class="mt-4 text-sm text-neutral-400">
          The cheapest {scope ? `${scope.label} ` : ''}deal over {periodLabel} is{' '}
          ${baseline.toFixed(2)}/mo{cheapestProviderName ? ` (${cheapestProviderName})` : ''}.
          {baseline < cheapestPrice - 0.005
            ? ` That averages in intro discounts. The cheapest list price is $${cheapestPrice.toFixed(2)}/mo.`
            : ''}
          {' '}Change the period above to compare a different term.
        </p>

        {/* Post-promo rort rating — toggle reveal */}
        {isOnPromo && (() => {
          const postPromoResult = calculateCooked(userFullPrice, baseline);
          const postPromoLevel = LEVELS.find(l => l.level === postPromoResult.level);
          return (
            <details class="mt-4 bg-surface border border-surface-border rounded-lg text-left">
              <summary class="px-4 py-3 cursor-pointer text-sm text-accent hover:text-white transition-colors">
                What happens after your promo ends in {userPromoLeft} month{userPromoLeft !== 1 ? 's' : ''}?
              </summary>
              <div class="px-4 pb-4 pt-1">
                <div class="text-xs text-neutral-500 mb-1">
                  At ${userFullPrice.toFixed(2)}/mo, your rating becomes...
                </div>
                <div class="text-2xl sm:text-3xl font-display font-bold" style={{ color: postPromoLevel?.color }}>
                  {postPromoResult.label}
                </div>
                {postPromoResult.monthlySavings > 0 ? (
                  <div class="mt-2 text-sm text-neutral-400">
                    You'll be paying <span class="text-white font-medium">{(postPromoResult.overpayPercent * 100).toFixed(0)}% more</span> than the cheapest plan
                    — <span class="text-white font-medium">${postPromoResult.monthlySavings.toFixed(2)}/mo</span> you could save by churning.
                  </div>
                ) : postPromoResult.level === 'winning' ? (
                  <div class="mt-2 text-sm text-neutral-400">
                    Even at full price you're still beating the cheapest. Nice.
                  </div>
                ) : (
                  <div class="mt-2 text-sm text-neutral-400">
                    Still a fair price after promo. No need to churn.
                  </div>
                )}
              </div>
            </details>
          );
        })()}

        {/* Rort Timeline — visual month-by-month rating */}
        {isOnPromo && (
          <div class="mt-4">
            <RortTimeline
              promoPrice={currentPrice}
              fullPrice={userFullPrice}
              promoMonthsLeft={userPromoLeft}
              cheapest={baseline}
            />
          </div>
        )}

        {/* Promo expired warning */}
        {userFullPrice && userPromoLeft === 0 && (
          <div class="mt-4 bg-cooked-red/10 border border-cooked-red/30 rounded-lg p-3 text-sm text-left">
            <div class="text-cooked-red font-medium">
              Your promo has ended
            </div>
            <div class="text-neutral-400 mt-1">
              You're now paying the full price of <span class="text-white">${userFullPrice.toFixed(2)}/mo</span>.
              {userFullPrice > baseline && (
                <span> The cheapest available plan is <span class="text-accent">${baseline.toFixed(2)}/mo</span>. Definitely time to churn.</span>
              )}
            </div>
          </div>
        )}

        <div class="mt-4 flex gap-3 justify-center items-center">
          <span class="text-sm text-neutral-500">
            {provider ? `${provider} @ ` : ''}${currentPrice.toFixed(2)}/mo
          </span>
          <button
            onClick={handleClear}
            class="text-sm text-neutral-500 hover:text-white underline"
          >
            Change
          </button>
          <span class="text-neutral-700">|</span>
          <button
            onClick={() => handleShare(currentPrice)}
            class="text-sm text-neutral-500 hover:text-accent underline decoration-dashed underline-offset-2"
          >
            {shareLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 sm:p-8">
      <h3 class="font-display font-bold text-xl mb-1">Are you getting rorted?</h3>
      <p class="text-neutral-400 text-sm mb-4">
        Enter what you pay for {tierLabel} and we'll tell you the truth
      </p>
      <form onSubmit={handleSubmit} class="flex flex-wrap gap-3">
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Monthly price ($)"
          value={price}
          onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
          required
          class="bg-surface border border-surface-border rounded-lg px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-accent w-40"
        />
        <input
          type="text"
          placeholder="Provider (optional)"
          value={provider}
          onInput={(e) => setProvider((e.target as HTMLInputElement).value)}
          class="bg-surface border border-surface-border rounded-lg px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-accent w-48"
        />
        <button
          type="submit"
          class="bg-accent hover:bg-accent/90 text-white font-medium rounded-lg px-5 py-2 transition-colors"
        >
          Am I getting rorted?
        </button>
      </form>
    </div>
  );
}
