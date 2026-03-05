import { useState, useEffect } from 'preact/hooks';
import type { SpeedTier, CookedResult } from '../lib/types';
import { calculateCooked } from '../lib/cooked';
import { LEVELS } from '../lib/cooked';
import { getUserPlan, saveUserPlan, clearUserPlan } from '../lib/storage';

interface Props {
  speed: SpeedTier;
  cheapestPrice: number;
  cheapestEffective?: number;
  cheapestProviderName?: string;
  onCookedChange?: (result: CookedResult | null) => void;
}

/** Compute remaining promo months from saved data */
function getPromoRemaining(plan: { promoMonthsLeft?: number; savedAt: string }): number {
  if (!plan.promoMonthsLeft) return 0;
  const monthsSince = Math.floor((Date.now() - new Date(plan.savedAt).getTime()) / (30 * 24 * 60 * 60 * 1000));
  return Math.max(0, plan.promoMonthsLeft - monthsSince);
}

/** Compute the user's effective annual rate considering remaining promo months */
function computeEffectiveRate(price: number, fullPrice: number | undefined, promoMonthsLeft: number): number {
  if (!fullPrice || promoMonthsLeft <= 0) return fullPrice ?? price;
  const promoMonths = Math.min(promoMonthsLeft, 12);
  const fullMonths = 12 - promoMonths;
  return (promoMonths * price + fullMonths * fullPrice) / 12;
}

function RortScale({ currentLevel }: { currentLevel: string }) {
  const [open, setOpen] = useState(false);

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
          <div class="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-40 bg-surface border border-surface-border rounded-xl shadow-2xl p-4 w-72 sm:w-80">
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

export default function CookedRating({ speed, cheapestPrice, cheapestEffective, cheapestProviderName, onCookedChange }: Props) {
  const [price, setPrice] = useState('');
  const [provider, setProvider] = useState('');
  const [result, setResult] = useState<CookedResult | null>(null);
  const [hasExisting, setHasExisting] = useState(false);
  const [userFullPrice, setUserFullPrice] = useState<number | null>(null);
  const [userPromoLeft, setUserPromoLeft] = useState<number>(0);

  const baseline = cheapestEffective && cheapestEffective < cheapestPrice
    ? cheapestEffective : cheapestPrice;

  useEffect(() => {
    const existing = getUserPlan(speed);
    if (existing) {
      setPrice(existing.price.toString());
      setProvider(existing.provider);
      setHasExisting(true);

      if (existing.fullPrice && existing.promoMonthsLeft) {
        const remaining = getPromoRemaining(existing);
        setUserFullPrice(existing.fullPrice);
        setUserPromoLeft(remaining);
        const userEffective = computeEffectiveRate(existing.price, existing.fullPrice, remaining);
        const r = calculateCooked(userEffective, baseline);
        setResult(r);
        onCookedChange?.(r);
      } else {
        const r = calculateCooked(existing.price, baseline);
        setResult(r);
        onCookedChange?.(r);
      }
    }
  }, [speed, cheapestPrice, baseline]);

  function handleSubmit(e: Event) {
    e.preventDefault();
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) return;
    saveUserPlan(speed, p, provider);
    const r = calculateCooked(p, baseline);
    setResult(r);
    onCookedChange?.(r);
    setHasExisting(true);
  }

  function handleClear() {
    clearUserPlan(speed);
    setPrice('');
    setProvider('');
    setResult(null);
    onCookedChange?.(null);
    setHasExisting(false);
    setUserFullPrice(null);
    setUserPromoLeft(0);
  }

  if (result) {
    const currentPrice = parseFloat(price);
    const isOnPromo = userFullPrice && userPromoLeft > 0;

    return (
      <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 sm:p-8 text-center">
        <div class="text-sm text-neutral-400 mb-2">Your NBN {speed} is...</div>
        <div class="text-4xl sm:text-5xl font-display font-bold" style={{ color: result.color }}>
          {result.label}
        </div>

        <div class="mt-2">
          <RortScale currentLevel={result.level} />
        </div>

        {result.monthlySavings > 0 ? (
          <div class="mt-4 space-y-1">
            <p class="text-lg text-neutral-300">
              You're paying <span class="font-bold text-white">{(result.overpayPercent * 100).toFixed(0)}% more</span> than the cheapest available plan
            </p>
            <p class="text-neutral-400">
              That's <span class="font-medium text-white">${result.monthlySavings.toFixed(2)}/mo</span> or{' '}
              <span class="font-medium text-white">${result.yearlySavings.toFixed(0)}/yr</span> you could save
            </p>
          </div>
        ) : result.level === 'winning' ? (
          <div class="mt-4 space-y-1">
            <p class="text-lg text-neutral-300">
              You're paying <span class="font-bold" style={{ color: result.color }}>${Math.abs(currentPrice - baseline).toFixed(2)}/mo less</span> than the cheapest plan we track
            </p>
            <p class="text-neutral-400">
              Whatever you did, don't change a thing.
            </p>
          </div>
        ) : (
          <p class="mt-4 text-lg text-neutral-300">
            You're on the cheapest plan. Sweet as.
          </p>
        )}

        {/* Promo warning */}
        {isOnPromo && (
          <div class="mt-4 bg-accent/10 border border-accent/30 rounded-lg p-3 text-sm text-left">
            <div class="text-accent font-medium">
              Promo ending in {userPromoLeft} month{userPromoLeft !== 1 ? 's' : ''}
            </div>
            <div class="text-neutral-400 mt-1">
              You're paying <span class="text-white">${currentPrice.toFixed(2)}/mo</span> now, but it jumps to{' '}
              <span class="text-white">${userFullPrice.toFixed(2)}/mo</span> after.
              {userFullPrice > baseline && (
                <span class="block mt-1">
                  At full price, you'd be paying{' '}
                  <span class="text-cooked-red font-medium">${(userFullPrice - baseline).toFixed(2)}/mo more</span> than the cheapest available plan.
                  Time to churn?
                </span>
              )}
            </div>
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

        <div class="mt-4 flex gap-3 justify-center">
          <span class="text-sm text-neutral-500">
            {provider ? `${provider} @ ` : ''}${currentPrice.toFixed(2)}/mo
          </span>
          <button
            onClick={handleClear}
            class="text-sm text-neutral-500 hover:text-white underline"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 sm:p-8">
      <h3 class="font-display font-bold text-xl mb-1">Are you getting rorted?</h3>
      <p class="text-neutral-400 text-sm mb-4">
        Enter what you pay for NBN {speed} and we'll tell you the truth
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
