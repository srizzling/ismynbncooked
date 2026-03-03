import { useState, useEffect } from 'preact/hooks';
import type { SpeedTier, TierData, TierHistory, ComparisonsData, CookedResult, AUState, UserPlan } from '../lib/types';
import { SPEED_TIERS, TIER_LABELS } from '../lib/types';
import { fetchTierData, fetchTierHistory, fetchComparisons } from '../lib/data';
import { calculateCooked } from '../lib/cooked';
import { getUserPlan, getUserPlans, getUserState, getTierVisit, saveTierVisit } from '../lib/storage';
import CookedRating from './CookedRating';
import SavingsComparison from './SavingsComparison';
import PlanTable from './PlanTable';
import PriceChart from './PriceChart';

interface Props {
  speed: SpeedTier;
  label: string;
}

// Find the user's most recently saved plan from another tier
function findOtherTierPlan(currentSpeed: SpeedTier): { speed: SpeedTier; plan: UserPlan } | null {
  const plans = getUserPlans();
  let best: { speed: SpeedTier; plan: UserPlan } | null = null;
  for (const tier of SPEED_TIERS) {
    if (tier === currentSpeed) continue;
    const plan = plans[`nbn${tier}`];
    if (plan && (!best || plan.savedAt > best.plan.savedAt)) {
      best = { speed: tier, plan };
    }
  }
  return best;
}

export default function TierDashboard({ speed, label }: Props) {
  const [tierData, setTierData] = useState<TierData | null>(null);
  const [history, setHistory] = useState<TierHistory | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cookedResult, setCookedResult] = useState<CookedResult | null>(null);
  const [otherTierPlan, setOtherTierPlan] = useState<{ speed: SpeedTier; plan: UserPlan } | null>(null);
  const [priceChange, setPriceChange] = useState<{ dropped: boolean; amount: number; since: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [tier, hist, comp] = await Promise.allSettled([
          fetchTierData(speed),
          fetchTierHistory(speed),
          fetchComparisons(),
        ]);

        if (cancelled) return;

        if (tier.status === 'fulfilled') {
          setTierData(tier.value);
          // Check for existing user plan on this tier
          const existing = getUserPlan(speed);
          if (existing) {
            setCookedResult(calculateCooked(existing.price, tier.value.cheapest));
          }
          // Check for plans on other tiers (for cross-tier context)
          if (!existing) {
            setOtherTierPlan(findOtherTierPlan(speed));
          }
          // Price change detection
          const lastVisit = getTierVisit(speed);
          if (lastVisit) {
            const diff = lastVisit.cheapest - tier.value.cheapest;
            if (Math.abs(diff) >= 1) {
              setPriceChange({
                dropped: diff > 0,
                amount: Math.abs(diff),
                since: new Date(lastVisit.visitedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
              });
            }
          }
          // Save this visit
          saveTierVisit(speed, tier.value.cheapest);
        }
        if (hist.status === 'fulfilled') setHistory(hist.value);
        if (comp.status === 'fulfilled') setComparisons(comp.value);

        if (tier.status === 'rejected') {
          setError('Failed to load plan data. Try refreshing.');
        }
      } catch {
        if (!cancelled) setError('Something went wrong loading data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [speed]);

  function handleCookedChange(result: CookedResult | null) {
    setCookedResult(result);
  }

  if (loading) {
    return (
      <div class="space-y-6">
        <div class="bg-surface-raised border border-surface-border rounded-2xl p-8 text-center">
          <div class="animate-pulse space-y-4">
            <div class="h-6 bg-surface-border rounded w-48 mx-auto" />
            <div class="h-12 bg-surface-border rounded w-64 mx-auto" />
            <div class="h-4 bg-surface-border rounded w-80 mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !tierData) {
    return (
      <div class="bg-surface-raised border border-cooked-red/50 rounded-2xl p-8 text-center">
        <p class="text-cooked-red font-display font-bold text-xl mb-2">Data's cooked</p>
        <p class="text-neutral-400">{error ?? 'Failed to load plan data.'}</p>
        <button
          onClick={() => window.location.reload()}
          class="mt-4 bg-accent hover:bg-accent/90 text-white font-medium rounded-lg px-5 py-2 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  const cheapest = tierData.cheapest;
  const cheapestEffective = tierData.plans.length
    ? Math.min(...tierData.plans.map(p => p.effectiveMonthly))
    : cheapest;
  const userPlan = getUserPlan(speed);

  return (
    <div class="space-y-8">
      {/* Stats */}
      <div class="flex gap-6 flex-wrap">
        <div>
          <div class="text-3xl font-display font-bold tabular-nums">${cheapest.toFixed(0)}</div>
          <div class="text-sm text-neutral-500">cheapest/mo</div>
        </div>
        {cheapestEffective < cheapest && (
          <div>
            <div class="text-3xl font-display font-bold tabular-nums text-accent">${cheapestEffective.toFixed(0)}</div>
            <div class="text-sm text-neutral-500">with promos (1st yr)</div>
          </div>
        )}
        <div>
          <div class="text-3xl font-display font-bold tabular-nums text-neutral-300">${tierData.average.toFixed(0)}</div>
          <div class="text-sm text-neutral-500">average/mo</div>
        </div>
        <div>
          <div class="text-3xl font-display font-bold tabular-nums text-neutral-300">{tierData.planCount}</div>
          <div class="text-sm text-neutral-500">plans</div>
        </div>
      </div>

      {/* Price change since last visit */}
      {priceChange && (
        <div class={`rounded-xl px-4 py-3 text-sm ${
          priceChange.dropped
            ? 'bg-cooked-green/10 border border-cooked-green/30 text-cooked-green'
            : 'bg-cooked-red/10 border border-cooked-red/30 text-cooked-red'
        }`}>
          {priceChange.dropped ? (
            <>Cheapest plan dropped <span class="font-bold">${priceChange.amount.toFixed(0)}/mo</span> since your last visit ({priceChange.since})</>
          ) : (
            <>Cheapest plan went up <span class="font-bold">${priceChange.amount.toFixed(0)}/mo</span> since your last visit ({priceChange.since})</>
          )}
        </div>
      )}

      {/* Cross-tier context banner */}
      {otherTierPlan && !cookedResult && tierData && (() => {
        const diff = cheapest - otherTierPlan.plan.price;
        const absDiff = Math.abs(diff).toFixed(2);
        return (
          <div class="bg-surface-raised border border-accent/30 rounded-2xl p-6">
            <p class="text-neutral-300">
              You're currently on{' '}
              <span class="font-bold text-white">NBN {otherTierPlan.speed}</span> at{' '}
              <span class="font-bold text-white">${otherTierPlan.plan.price.toFixed(2)}/mo</span>
              {otherTierPlan.plan.provider ? ` with ${otherTierPlan.plan.provider}` : ''}.
            </p>
            <p class="text-neutral-400 text-sm mt-1">
              {diff > 0 ? (
                <>The cheapest NBN {speed} plan starts at <span class="text-white font-medium">${cheapest.toFixed(2)}/mo</span> — that's <span class="text-white font-medium">${absDiff}/mo more</span> than you're paying now.</>
              ) : diff < 0 ? (
                <>The cheapest NBN {speed} plan starts at <span class="text-white font-medium">${cheapest.toFixed(2)}/mo</span> — you could save <span class="text-accent font-medium">${absDiff}/mo</span>.</>
              ) : (
                <>The cheapest NBN {speed} plan starts at <span class="text-white font-medium">${cheapest.toFixed(2)}/mo</span> — same as what you're paying now.</>
              )}
            </p>
          </div>
        );
      })()}

      {/* Cooked Rating */}
      <CookedRating
        speed={speed}
        cheapestPrice={cheapest}
        cheapestEffective={cheapestEffective < cheapest ? cheapestEffective : undefined}
        onCookedChange={handleCookedChange}
      />

      {/* Savings Comparison — only shows when user has savings */}
      {cookedResult && cookedResult.monthlySavings > 0 && comparisons && (
        <SavingsComparison
          monthlySavings={cookedResult.monthlySavings}
          units={comparisons.units}
          userState={getUserState()}
        />
      )}

      {/* Plan Table */}
      <div>
        <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-4">
          <h2 class="font-display font-bold text-2xl">All Plans</h2>
          <div class="bg-accent/10 border border-accent/30 rounded-lg px-3 py-2 text-sm text-neutral-300">
            Cheapest isn't always best — support quality varies wildly.
            If support sucks, <span class="font-bold text-accent">churn again</span>. No lock-in, no excuses.
          </div>
        </div>
        <PlanTable
          plans={tierData.plans}
          highlightProvider={userPlan?.provider}
          userPrice={userPlan?.price}
          userFullPrice={userPlan?.fullPrice}
          userPromoMonthsLeft={userPlan?.promoMonthsLeft ? (() => {
            const monthsSince = Math.floor((Date.now() - new Date(userPlan.savedAt).getTime()) / (30 * 24 * 60 * 60 * 1000));
            return Math.max(0, userPlan.promoMonthsLeft - monthsSince);
          })() : undefined}
          providerHistory={history?.providers}
        />
      </div>

      {/* Price History Chart */}
      {history && history.daily.length > 0 && (
        <PriceChart history={history.daily} />
      )}
    </div>
  );
}
