import { useState, useEffect, useMemo } from 'preact/hooks';
import type { TierData, TierHistory, ComparisonsData, CookedResult, UserPlan, TierManifest } from '../lib/types';
import { parseTierKey, buildTierLabel } from '../lib/types';
import { calculateCooked } from '../lib/cooked';
import { getUserPlan, getUserPlans, getUserState, getTierVisit, saveTierVisit, getDefaultHorizon, saveDefaultHorizon, type HorizonPreference } from '../lib/storage';
import { calcCosts, cheapestEffectiveForHorizon, cheapestPlanForHorizon, bestHorizon, HORIZONS, type Horizon } from '../lib/costs';
import CookedRating from './CookedRating';
import SavingsComparison from './SavingsComparison';
import PlanTable from './PlanTable';
import PriceChart from './PriceChart';

interface Props {
  tierKey: string;
  label: string;
  tierData: TierData;
  history: TierHistory | null;
  comparisons: ComparisonsData | null;
  manifest?: TierManifest;
  isGrouped?: boolean;
}

// Find the user's most recently saved plan from another tier
function findOtherTierPlan(currentTierKey: string): { tierKey: string; label: string; plan: UserPlan } | null {
  const plans = getUserPlans();
  let best: { tierKey: string; label: string; plan: UserPlan } | null = null;
  for (const [key, plan] of Object.entries(plans)) {
    if (key === currentTierKey || !plan) continue;
    const parsed = parseTierKey(key);
    if (parsed && (!best || plan.savedAt > best.plan.savedAt)) {
      best = { tierKey: key, label: buildTierLabel(parsed.network, parsed.download, parsed.upload), plan };
    }
  }
  return best;
}

export default function TierDashboard({ tierKey, label, tierData, history, comparisons, manifest, isGrouped }: Props) {
  const [cookedResult, setCookedResult] = useState<CookedResult | null>(null);
  const [otherTierPlan, setOtherTierPlan] = useState<{ tierKey: string; label: string; plan: UserPlan } | null>(null);
  const [priceChange, setPriceChange] = useState<{ dropped: boolean; amount: number; since: string } | null>(null);
  const [horizonPref, setHorizonPref] = useState<HorizonPreference>(() => getDefaultHorizon());

  // Find the best horizon (cheapest effective, tie-break by longest commitment)
  const best = useMemo(() => bestHorizon(tierData.plans), [tierData.plans]);

  // Resolve preference to an actual horizon
  const horizon: Horizon = horizonPref === 'cheapest' ? best.horizon : horizonPref;

  function handleHorizonChange(h: HorizonPreference) {
    setHorizonPref(h);
    saveDefaultHorizon(h);
  }

  // Compute cheapest effective at the current horizon
  const cheapestEffective = useMemo(
    () => cheapestEffectiveForHorizon(tierData.plans, horizon),
    [tierData.plans, horizon]
  );
  const baseline = cheapestEffective < tierData.cheapest ? cheapestEffective : tierData.cheapest;

  const showBestHorizonNudge = horizonPref !== 'cheapest' && best.horizon !== horizon && best.effectiveCost < cheapestEffective - 0.5;

  useEffect(() => {
    // Check for existing user plan on this tier
    const existing = getUserPlan(tierKey);
    if (existing) {
      setCookedResult(calculateCooked(existing.price, baseline));
    } else {
      // Check for plans on other tiers (for cross-tier context)
      setOtherTierPlan(findOtherTierPlan(tierKey));
    }

    // Price change detection
    const lastVisit = getTierVisit(tierKey);
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
    saveTierVisit(tierKey, tierData.cheapest);
  }, [tierKey, baseline]);

  function handleCookedChange(result: CookedResult | null) {
    setCookedResult(result);
  }

  const cheapest = tierData.cheapest;
  const userPlan = getUserPlan(tierKey);
  const horizonLabel = horizon === 12 ? '1yr' : horizon === 24 ? '2yr' : `${horizon}mo`;

  // Find the plan with the cheapest monthly price (no promo consideration)
  const cheapestMonthlyPlan = useMemo(() => {
    if (tierData.plans.length === 0) return null;
    return tierData.plans.reduce((best, plan) =>
      plan.monthlyPrice < best.monthlyPrice ? plan : best
    );
  }, [tierData.plans]);

  const cheapestAtHorizon = useMemo(
    () => cheapestPlanForHorizon(tierData.plans, horizon),
    [tierData.plans, horizon]
  );

  return (
    <div class="space-y-8">
      {/* Stats */}
      <div class="flex gap-6 flex-wrap">
        <div>
          <div class="text-3xl font-display font-bold tabular-nums">${cheapest.toFixed(0)}</div>
          <div class="text-sm text-neutral-500">cheapest/mo</div>
          {cheapestMonthlyPlan && (
            <div class="text-xs text-neutral-500 mt-0.5">{cheapestMonthlyPlan.providerName}</div>
          )}
        </div>
        <div>
          <div class="text-3xl font-display font-bold tabular-nums text-neutral-300">${tierData.average.toFixed(0)}</div>
          <div class="text-sm text-neutral-500">average/mo</div>
        </div>
      </div>

      {/* Global horizon selector — shows cheapest effective at each period */}
      <div>
        <div class="flex items-start justify-between mb-2">
          <div>
            <div class="text-sm text-neutral-400">Cheapest effective monthly by commitment period</div>
            <div class="text-xs text-neutral-600 mt-0.5">
              Effective price = total cost (promos + full price + fees) ÷ months
            </div>
          </div>
          <button
            onClick={() => handleHorizonChange(horizonPref === 'cheapest' ? horizon : 'cheapest')}
            class={`text-xs px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap ${
              horizonPref === 'cheapest'
                ? 'bg-cooked-green/10 border-cooked-green/30 text-cooked-green'
                : 'bg-surface border-surface-border text-neutral-500 hover:border-neutral-600'
            }`}
            title={horizonPref === 'cheapest'
              ? 'Auto-selecting cheapest period. Click to pin current period.'
              : 'Click to auto-select the cheapest commitment period'}
          >
            {horizonPref === 'cheapest' ? '✓ Auto: cheapest' : 'Auto: cheapest'}
          </button>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {HORIZONS.map((h) => {
            const result = cheapestPlanForHorizon(tierData.plans, h);
            if (!result) return null;
            const { plan: cheapPlan, effectiveCost: effPrice, totalCost } = result;
            const isBest = h === best.horizon;
            const isActive = h === horizon;
            const hLabel = h === 12 ? '1 year' : h === 24 ? '2 years' : `${h} months`;
            const hasPromo = cheapPlan.promoValue && cheapPlan.promoValue > 0 && cheapPlan.promoDuration;
            const promoMonths = hasPromo ? Math.min(cheapPlan.promoDuration!, h) : 0;
            const promoPrice = hasPromo ? cheapPlan.monthlyPrice - cheapPlan.promoValue! : 0;
            return (
              <button
                key={h}
                onClick={() => handleHorizonChange(h)}
                class={`relative text-left rounded-xl px-4 py-3 transition-colors border ${
                  isActive
                    ? 'bg-accent/10 border-accent'
                    : 'bg-surface border-surface-border hover:border-neutral-600'
                }`}
              >
                {isBest && (
                  <span class="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-cooked-green/20 text-cooked-green">
                    CHEAPEST
                  </span>
                )}
                <div class={`text-xs ${isActive ? 'text-accent' : 'text-neutral-500'}`}>
                  {hLabel}
                </div>
                <div class={`text-lg font-display font-bold tabular-nums ${isActive ? 'text-white' : 'text-neutral-300'}`}>
                  ${effPrice.toFixed(0)}<span class="text-xs font-normal text-neutral-500">/mo</span>
                </div>
                <div class={`text-[11px] mt-1 ${isActive ? 'text-neutral-400' : 'text-neutral-600'}`}>
                  {cheapPlan.providerName}
                </div>
                <div class={`text-[10px] mt-0.5 tabular-nums ${isActive ? 'text-neutral-500' : 'text-neutral-700'}`}>
                  {hasPromo && promoMonths > 0 ? (
                    promoMonths >= h ? (
                      <>${promoPrice.toFixed(0)} × {h}mo = ${totalCost.toFixed(0)}</>
                    ) : (
                      <>${promoPrice.toFixed(0)} × {promoMonths}mo + ${cheapPlan.monthlyPrice.toFixed(0)} × {h - promoMonths}mo</>
                    )
                  ) : (
                    <>${cheapPlan.monthlyPrice.toFixed(0)} × {h}mo = ${totalCost.toFixed(0)}</>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {horizonPref === 'cheapest' && (
          <div class="text-xs text-neutral-600 mt-2">
            Auto-selecting the cheapest commitment period. Your preference is saved for next time.
          </div>
        )}
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
              <span class="font-bold text-white">{otherTierPlan.label}</span> at{' '}
              <span class="font-bold text-white">${otherTierPlan.plan.price.toFixed(2)}/mo</span>
              {otherTierPlan.plan.provider ? ` with ${otherTierPlan.plan.provider}` : ''}.
            </p>
            <p class="text-neutral-400 text-sm mt-1">
              {diff > 0 ? (
                <>The cheapest {label} plan starts at <span class="text-white font-medium">${cheapest.toFixed(2)}/mo</span> — that's <span class="text-white font-medium">${absDiff}/mo more</span> than you're paying now.</>
              ) : diff < 0 ? (
                <>The cheapest {label} plan starts at <span class="text-white font-medium">${cheapest.toFixed(2)}/mo</span> — you could save <span class="text-accent font-medium">${absDiff}/mo</span>.</>
              ) : (
                <>The cheapest {label} plan starts at <span class="text-white font-medium">${cheapest.toFixed(2)}/mo</span> — same as what you're paying now.</>
              )}
            </p>
          </div>
        );
      })()}

      {/* Cooked Rating */}
      <CookedRating
        tierKey={tierKey}
        cheapestPrice={cheapest}
        cheapestEffective={cheapestEffective < cheapest ? cheapestEffective : undefined}
        cheapestProviderName={cheapestAtHorizon?.plan.providerName}
        horizon={horizon}
        manifest={manifest}
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
          horizon={horizon}
          onHorizonChange={(h: Horizon) => { handleHorizonChange(h); saveDefaultHorizon(h); }}
          showUploadSpeed={isGrouped}
        />
      </div>

      {/* Price History Chart */}
      {history && history.daily.length > 0 && (
        <PriceChart history={history.daily} />
      )}
    </div>
  );
}
