import { useState, useEffect } from 'preact/hooks';
import type { SpeedTier, TierData, TierHistory, ComparisonsData, CookedResult, UserPlan } from '../lib/types';
import { SPEED_TIERS } from '../lib/types';
import { calculateCooked } from '../lib/cooked';
import { getUserPlan, getUserPlans, getUserState, getTierVisit, saveTierVisit } from '../lib/storage';
import CookedRating from './CookedRating';
import SavingsComparison from './SavingsComparison';
import PlanTable from './PlanTable';
import PriceChart from './PriceChart';

interface Props {
  speed: SpeedTier;
  label: string;
  tierData: TierData;
  history: TierHistory | null;
  comparisons: ComparisonsData | null;
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

export default function TierDashboard({ speed, label, tierData, history, comparisons }: Props) {
  const [cookedResult, setCookedResult] = useState<CookedResult | null>(null);
  const [otherTierPlan, setOtherTierPlan] = useState<{ speed: SpeedTier; plan: UserPlan } | null>(null);
  const [priceChange, setPriceChange] = useState<{ dropped: boolean; amount: number; since: string } | null>(null);

  const cheapestEffective = tierData.plans.length
    ? Math.min(...tierData.plans.map(p => p.effectiveMonthly))
    : tierData.cheapest;
  const baseline = cheapestEffective < tierData.cheapest ? cheapestEffective : tierData.cheapest;

  useEffect(() => {
    // Check for existing user plan on this tier
    const existing = getUserPlan(speed);
    if (existing) {
      setCookedResult(calculateCooked(existing.price, baseline));
    } else {
      // Check for plans on other tiers (for cross-tier context)
      setOtherTierPlan(findOtherTierPlan(speed));
    }

    // Price change detection
    const lastVisit = getTierVisit(speed);
    if (lastVisit) {
      const diff = lastVisit.cheapest - tierData.cheapest;
      if (Math.abs(diff) >= 1) {
        setPriceChange({
          dropped: diff > 0,
          amount: Math.abs(diff),
          since: new Date(lastVisit.visitedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
        });
      }
    }
    // Save this visit
    saveTierVisit(speed, tierData.cheapest);
  }, [speed, baseline]);

  function handleCookedChange(result: CookedResult | null) {
    setCookedResult(result);
  }

  const cheapest = tierData.cheapest;
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
      {cookedResult && cookedResult.monthlySavings > 0 && comparisons && (() => {
        // Compute promo breakdown if user is on a promo
        let promoInfo: { promoSavings: number; fullPriceSavings: number; promoMonthsLeft: number } | undefined;
        if (userPlan?.fullPrice && userPlan?.promoMonthsLeft) {
          const monthsSince = Math.floor((Date.now() - new Date(userPlan.savedAt).getTime()) / (30 * 24 * 60 * 60 * 1000));
          const remaining = Math.max(0, userPlan.promoMonthsLeft - monthsSince);
          if (remaining > 0) {
            promoInfo = {
              promoSavings: Math.max(0, userPlan.price - baseline),
              fullPriceSavings: Math.max(0, userPlan.fullPrice - baseline),
              promoMonthsLeft: remaining,
            };
          }
        }
        return (
          <SavingsComparison
            monthlySavings={cookedResult.monthlySavings}
            units={comparisons.units}
            userState={getUserState()}
            promo={promoInfo}
          />
        );
      })()}

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
