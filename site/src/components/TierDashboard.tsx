import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import type { NBNPlan, SpeedOption, TierData, TierHistory, ComparisonsData, CookedResult, UserPlan, TierManifest } from '../lib/types';
import { parseTierKey, buildTierLabel } from '../lib/types';
import { calculateCooked } from '../lib/cooked';
import { resolveUserPlan, getUserPlans, getUserState, getTierVisit, saveTierVisit, getDefaultHorizon, saveDefaultHorizon, type HorizonPreference } from '../lib/storage';
import { calcCosts, cheapestEffectiveForHorizon, cheapestPlanForHorizon, bestHorizon, HORIZONS, type Horizon } from '../lib/costs';
import CookedRating from './CookedRating';
import AlertSignup from './AlertSignup';
import SavingsComparison from './SavingsComparison';
import SpeedComparisons, { fasterPlansCheaper } from './SpeedComparisons';
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
  speedOptions?: SpeedOption[];
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

export default function TierDashboard({ tierKey, label, tierData, history, comparisons, manifest, isGrouped, speedOptions }: Props) {
  const [cookedResult, setCookedResult] = useState<CookedResult | null>(null);
  const [otherTierPlan, setOtherTierPlan] = useState<{ tierKey: string; label: string; plan: UserPlan } | null>(null);
  const [priceChange, setPriceChange] = useState<{ dropped: boolean; amount: number; since: string } | null>(null);
  // Start with the server-rendered default and read the saved preference after mount,
  // otherwise the SSR HTML and the first client render disagree (hydration mismatch).
  const [horizonPref, setHorizonPref] = useState<HorizonPreference>(12); // matches getDefaultHorizon() on the server
  useEffect(() => {
    setHorizonPref(getDefaultHorizon());
  }, []);

  // The user's saved plan for this page. On a grouped page (nbn-1000) this also matches a plan
  // saved against one variant (nbn-1000-50).
  // Read after mount (localStorage), otherwise the first client render disagrees with the SSR HTML.
  // Re-read when the rating changes so saving or clearing a plan in CookedRating is picked up.
  const [userEntry, setUserEntry] = useState<{ key: string; plan: UserPlan } | null>(null);
  useEffect(() => {
    setUserEntry(resolveUserPlan(tierKey));
  }, [tierKey, cookedResult]);
  const userPlan = userEntry?.plan ?? null;
  const userVariant = isGrouped && userEntry && userEntry.key !== tierKey ? parseTierKey(userEntry.key) : null;

  // Grouped pages mix upload speeds (e.g. 1000/50 and 1000/400). The selected speed scopes
  // everything below (stats, commitment cards, rating, table) so the page never disagrees with itself.
  const [speedFilter, setSpeedFilter] = useState<number | 'all'>('all');
  const uploadSpeeds = useMemo(
    () => [...new Set(tierData.plans.map(p => p.uploadSpeed))].sort((a, b) => a - b),
    [tierData.plans]
  );
  const showSpeedFilter = !!isGrouped && uploadSpeeds.length > 1;
  // After clicking a chip the pointer is still over it; hide its tooltip until the pointer leaves so it doesn't cover the numbers.
  const [tipHidden, setTipHidden] = useState<number | 'all' | null>(null);
  // Default to the user's own variant once we've read their saved plan (after mount, to match SSR).
  useEffect(() => {
    if (userVariant && uploadSpeeds.includes(userVariant.upload)) setSpeedFilter(userVariant.upload);
  }, [userEntry?.key, uploadSpeeds]);

  const viewPlans = useMemo(
    () => (speedFilter === 'all' ? tierData.plans : tierData.plans.filter(p => p.uploadSpeed === speedFilter)),
    [tierData.plans, speedFilter]
  );
  const viewCheapest = useMemo(
    () => viewPlans.reduce((min, p) => Math.min(min, p.monthlyPrice), Infinity),
    [viewPlans]
  );
  const viewAverage = useMemo(
    () => (speedFilter === 'all' ? tierData.average : viewPlans.reduce((sum, p) => sum + p.monthlyPrice, 0) / viewPlans.length),
    [viewPlans, speedFilter, tierData.average]
  );

  // Find the best horizon (cheapest effective, tie-break by longest commitment)
  const best = useMemo(() => bestHorizon(viewPlans), [viewPlans]);

  // Resolve preference to an actual horizon
  const horizon: Horizon = horizonPref === 'cheapest' ? best.horizon : horizonPref;

  // Set when the user changes the period or upload speed themselves, so the page can explain what changed
  // (and does not announce the automatic default speed chosen when the saved plan loads).
  const userChoiceRef = useRef(false);

  function handleHorizonChange(h: HorizonPreference) {
    userChoiceRef.current = true;
    setHorizonPref(h);
    saveDefaultHorizon(h);
  }

  // Compute cheapest effective at the current horizon
  const cheapestEffective = useMemo(
    () => cheapestEffectiveForHorizon(viewPlans, horizon),
    [viewPlans, horizon]
  );
  const baseline = cheapestEffective < viewCheapest ? cheapestEffective : viewCheapest;

  // Per-chip summary for the hover tooltip, on the same basis as the verdict:
  // the cheaper of the average monthly cost over the chosen period and the plain monthly price.
  const speedSummaries = useMemo(() => {
    const out = new Map<number | 'all', { count: number; cost: number; plan: NBNPlan }>();
    const add = (key: number | 'all', plans: NBNPlan[]) => {
      if (plans.length === 0) return;
      const atPeriod = cheapestPlanForHorizon(plans, horizon)!;
      const monthly = plans.reduce((b, p) => (p.monthlyPrice < b.monthlyPrice ? p : b));
      const useMonthly = monthly.monthlyPrice < atPeriod.effectiveCost;
      out.set(key, { count: plans.length, cost: useMonthly ? monthly.monthlyPrice : atPeriod.effectiveCost, plan: useMonthly ? monthly : atPeriod.plan });
    };
    add('all', tierData.plans);
    for (const u of uploadSpeeds) add(u, tierData.plans.filter(p => p.uploadSpeed === u));
    return out;
  }, [tierData.plans, uploadSpeeds, horizon]);

  const showBestHorizonNudge = horizonPref !== 'cheapest' && best.horizon !== horizon && best.effectiveCost < cheapestEffective - 0.5;

  // Pre-compute cheapest plan at each horizon for the selector buttons
  const horizonResults = useMemo(
    () => HORIZONS.map(h => ({ h, result: cheapestPlanForHorizon(viewPlans, h) })),
    [viewPlans]
  );
  // When every period costs the same, a CHEAPEST badge on one of them just looks like a mistake
  const allPeriodsSame = horizonResults.every(r => r.result && Math.abs(r.result.effectiveCost - horizonResults[0].result!.effectiveCost) < 0.005);

  useEffect(() => {
    // Check for existing user plan on this tier
    if (userPlan) {
      setCookedResult(calculateCooked(userPlan.price, baseline));
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
  }, [tierKey, userEntry?.key, userEntry?.plan.price, baseline]);

  function handleCookedChange(result: CookedResult | null) {
    setCookedResult(result);
  }

  const cheapest = viewCheapest;
  const horizonLabel = horizon === 12 ? '1yr' : horizon === 24 ? '2yr' : `${horizon}mo`;

  // --- Why did my rating change? ---
  const money = (n: number) => (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2));
  const periodName = (h: number) => (h === 12 ? '1 year' : h === 24 ? '2 years' : `${h} months`);
  const speedName = (sp: number | 'all') => (sp === 'all' ? 'all upload speeds' : `${tierData.downloadSpeed}/${sp}`);
  const currentResult = useMemo(
    () => (userEntry ? calculateCooked(userEntry.plan.price, baseline) : null),
    [userEntry?.plan.price, baseline]
  );
  const prevChoice = useRef<{ speed: number | 'all'; horizon: Horizon; label: string | null }>({ speed: speedFilter, horizon, label: null });
  const [changeNote, setChangeNote] = useState<{ from: string; to: string; because: string } | null>(null);
  useEffect(() => {
    const prev = prevChoice.current;
    const changed = prev.speed !== speedFilter || prev.horizon !== horizon;
    if (changed && userChoiceRef.current && currentResult && prev.label) {
      const parts: string[] = [];
      const periodMoved = prev.horizon !== horizon;
      const speedMoved = prev.speed !== speedFilter;
      if (speedMoved) {
        parts.push(
          `the upload speed from ${speedName(prev.speed)} to ${speedName(speedFilter)}` +
          (periodMoved && horizonPref === 'cheapest'
            ? ` (the period also moved from ${periodName(prev.horizon)} to ${periodName(horizon)} by itself, because the page is auto-picking the cheapest period)`
            : '')
        );
      }
      if (periodMoved && !(speedMoved && horizonPref === 'cheapest')) {
        parts.push(`the commitment period from ${periodName(prev.horizon)} to ${periodName(horizon)}`);
      }
      setChangeNote({ from: prev.label, to: currentResult.label, because: parts.join(' and ') });
    }
    if (changed) userChoiceRef.current = false;
    prevChoice.current = { speed: speedFilter, horizon, label: currentResult?.label ?? null };
  }, [speedFilter, horizon, currentResult?.label]);
  const changeText = changeNote
    ? changeNote.from === changeNote.to
      ? `Still ${changeNote.to}, but what we compare you with changed because you changed ${changeNote.because}.`
      : `Changed from ${changeNote.from} to ${changeNote.to} because you changed ${changeNote.because}. Your price didn't change, what it's compared with did.`
    : undefined;
  const choicesText = `${periodName(horizon)}, ${tierData.downloadSpeed} Mbps down, ${
    isGrouped ? (speedFilter === 'all' ? 'any upload speed' : `${speedFilter} Mbps up`) : `${tierData.uploadSpeed} Mbps up`
  }`;
  const fasterNote = useMemo(() => {
    if (!userEntry || !speedOptions || speedOptions.length === 0) return undefined;
    const exact = parseTierKey(userEntry.key);
    const yours = userVariant
      ? { download: userVariant.download, upload: userVariant.upload }
      : exact ? { download: exact.download, upload: exact.upload } : { download: tierData.downloadSpeed };
    return fasterPlansCheaper(speedOptions, yours, userEntry.plan.price, horizon) ?? undefined;
  }, [userEntry?.key, userEntry?.plan.price, speedOptions, horizon, userVariant?.upload]);
  // The note stays in the verdict card; the sticky strip only shows it for a few seconds so the strip stays short.
  const [noteVisible, setNoteVisible] = useState(false);
  // A note about a past chip or period change is stale once the saved plan itself changes.
  useEffect(() => {
    setChangeNote(null);
    setNoteVisible(false);
  }, [userEntry?.key, userEntry?.plan.price]);
  useEffect(() => {
    if (!changeNote) return;
    setNoteVisible(true);
    const t = setTimeout(() => setNoteVisible(false), 9000);
    return () => clearTimeout(t);
  }, [changeNote]);
  const verdictStrip = userEntry && currentResult ? (
    <a
      href="#your-verdict"
      class="sticky top-2 z-20 block rounded-xl border border-surface-border bg-surface/95 backdrop-blur px-3 py-2 text-xs sm:px-4 sm:py-3 sm:text-sm shadow-lg hover:border-neutral-600 transition-colors"
    >
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span class="text-neutral-400">
          With {choicesText}, your plan is{' '}
          <span class="font-bold" style={{ color: currentResult.color }}>{currentResult.label}</span>
        </span>
        <span class="hidden sm:inline text-xs text-neutral-500 underline">See how we got this</span>
      </div>
      {changeText && noteVisible && <div class="text-xs text-neutral-300 mt-1">{changeText}</div>}
    </a>
  ) : null;

  // Find the plan with the cheapest monthly price (no promo consideration)
  const cheapestMonthlyPlan = useMemo(() => {
    if (viewPlans.length === 0) return null;
    return viewPlans.reduce((best, plan) =>
      plan.monthlyPrice < best.monthlyPrice ? plan : best
    );
  }, [viewPlans]);

  const cheapestAtHorizon = useMemo(
    () => cheapestPlanForHorizon(viewPlans, horizon),
    [viewPlans, horizon]
  );

  return (
    <div class="space-y-8">
      {/* Upload speed scope (grouped pages only) */}
      {showSpeedFilter && (
        <div>
          <div class="relative flex flex-wrap items-center gap-2">
            <span class="text-sm text-neutral-400 mr-1">Upload speed</span>
            {(['all', ...uploadSpeeds] as Array<number | 'all'>).map(u => {
              const summary = speedSummaries.get(u);
              const diff = summary && userPlan ? summary.cost - userPlan.price : null;
              return (
                <div key={u} class="group" onMouseLeave={() => setTipHidden(null)}>
                  <button
                    onClick={() => { userChoiceRef.current = true; setSpeedFilter(u); setTipHidden(u); }}
                    class={`peer text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      speedFilter === u
                        ? 'bg-accent/10 border-accent text-accent'
                        : 'bg-surface border-surface-border text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
                    }`}
                  >
                    {u === 'all' ? 'All' : `${tierData.downloadSpeed}/${u}`}
                  </button>
                  {summary && (
                    <div class={`absolute top-full left-0 pt-2 max-w-full opacity-0 transition-opacity pointer-events-none z-20 ${tipHidden === u ? '' : 'group-hover:opacity-100 peer-focus-visible:opacity-100'}`}>
                      <div class="px-3 py-2 bg-surface border border-surface-border rounded-lg text-xs text-neutral-400 w-max max-w-full shadow-lg">
                        <div class="text-white font-medium">
                          {u === 'all' ? `Every ${tierData.downloadSpeed} Mbps plan` : `${tierData.downloadSpeed} Mbps down / ${u} Mbps up`}
                        </div>
                        <div class="mt-0.5">
                          {summary.count} plan{summary.count !== 1 ? 's' : ''}, cheapest over {periodName(horizon)}:{' '}
                          <span class="text-white">${summary.cost.toFixed(2)}/mo</span> ({summary.plan.providerName}
                          {u === 'all' ? `, ${summary.plan.downloadSpeed}/${summary.plan.uploadSpeed}` : ''})
                        </div>
                        {diff !== null && userPlan && (
                          <div class="mt-0.5">
                            {Math.abs(diff) < 0.005
                              ? `Same as your $${userPlan.price.toFixed(2)}/mo`
                              : diff < 0
                                ? <>That's <span class="text-accent">${Math.abs(diff).toFixed(2)}/mo</span> less than your ${userPlan.price.toFixed(2)}/mo</>
                                : <>That's ${diff.toFixed(2)}/mo more than your ${userPlan.price.toFixed(2)}/mo</>}
                          </div>
                        )}
                        {u !== 'all' && userVariant && u !== userVariant.upload && (
                          <div class="mt-0.5 text-neutral-500">Different upload speed to your plan</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {userVariant && (
            <div class="text-xs text-neutral-500 mt-2">
              {speedFilter === userVariant.upload
                ? `Showing ${viewPlans.length} of ${tierData.plans.length} plans: only ${tierData.downloadSpeed}/${speedFilter}, the speed of your saved ${buildTierLabel(userVariant.network, userVariant.download, userVariant.upload)} plan.`
                : `Your ${buildTierLabel(userVariant.network, userVariant.download, userVariant.upload)} plan is being compared with ${speedFilter === 'all' ? 'every upload speed' : `${tierData.downloadSpeed}/${speedFilter} plans`}.`}
            </div>
          )}
        </div>
      )}

      {verdictStrip}

      {/* Stats */}
      <div class="flex gap-6 flex-wrap">
        <div>
          <div class="text-3xl font-display font-bold tabular-nums">${cheapest.toFixed(0)}</div>
          <div class="text-sm text-neutral-500">cheapest/mo (list price)</div>
          {cheapestMonthlyPlan && (
            <div class="text-xs text-neutral-500 mt-0.5">{cheapestMonthlyPlan.providerName}</div>
          )}
        </div>
        <div>
          <div class="text-3xl font-display font-bold tabular-nums text-neutral-300">${viewAverage.toFixed(0)}</div>
          <div class="text-sm text-neutral-500">average/mo</div>
        </div>
      </div>

      {/* Global horizon selector — shows cheapest effective at each period */}
      <div>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-2">
          <div>
            <div class="text-sm text-neutral-400">Cheapest effective monthly by commitment period</div>
            <div class="text-xs text-neutral-600 mt-0.5">
              Average monthly cost over that period, including intro discounts, full price after them, and fees. Pick how long you plan to stay: your rating below uses this.
            </div>
          </div>
          {!allPeriodsSame && (
          <button
            onClick={() => handleHorizonChange(horizonPref === 'cheapest' ? horizon : 'cheapest')}
            class={`text-xs px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap ${
              horizonPref === 'cheapest'
                ? 'bg-cooked-green/10 border-cooked-green/30 text-cooked-green'
                : 'bg-surface border-surface-border text-neutral-500 hover:border-neutral-600'
            }`}
            title={horizonPref === 'cheapest'
              ? 'Currently picking the cheapest period for you. Click to stay on the period you have selected.'
              : 'Click to have us pick the period with the lowest monthly cost'}
          >
            {horizonPref === 'cheapest' ? '✓ Auto-picking the cheapest period' : 'Pick the cheapest period for me'}
          </button>
          )}
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {horizonResults.map(({ h, result }) => {
            if (!result) return null;
            const { plan: cheapPlan, effectiveCost: effPrice, totalCost } = result;
            const isBest = h === best.horizon && !allPeriodsSame;
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
                  ${Number.isInteger(effPrice) ? effPrice.toFixed(0) : effPrice.toFixed(2)}<span class="text-xs font-normal text-neutral-500">/mo</span>
                </div>
                <div class={`text-[11px] mt-1 ${isActive ? 'text-neutral-400' : 'text-neutral-600'}`}>
                  {cheapPlan.providerName}
                </div>
                <div class={`text-[10px] mt-0.5 tabular-nums ${isActive ? 'text-neutral-500' : 'text-neutral-700'}`}>
                  {hasPromo && promoMonths > 0 ? (
                    promoMonths >= h ? (
                      <>${money(promoPrice)} × {h}mo = ${money(totalCost)}</>
                    ) : (
                      <>${money(promoPrice)} × {promoMonths}mo + ${money(cheapPlan.monthlyPrice)} × {h - promoMonths}mo</>
                    )
                  ) : (
                    <>${money(cheapPlan.monthlyPrice)} × {h}mo = ${money(totalCost)}</>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {allPeriodsSame && (
          <div class="text-xs text-neutral-500 mt-2">These plans cost the same at every period.</div>
        )}
        {horizonPref === 'cheapest' && !allPeriodsSame && (
          <div class="text-xs text-neutral-600 mt-2">
            Showing the period with the lowest monthly cost. Tap a period to choose your own. We'll remember it.
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
        const diff = baseline - otherTierPlan.plan.price;
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
                <>The cheapest {label} plan over {periodName(horizon)} averages <span class="text-white font-medium">${baseline.toFixed(2)}/mo</span> — that's <span class="text-white font-medium">${absDiff}/mo more</span> than you're paying now.</>
              ) : diff < 0 ? (
                <>The cheapest {label} plan over {periodName(horizon)} averages <span class="text-white font-medium">${baseline.toFixed(2)}/mo</span> — you could save <span class="text-accent font-medium">${absDiff}/mo</span>.</>
              ) : (
                <>The cheapest {label} plan over {periodName(horizon)} averages <span class="text-white font-medium">${baseline.toFixed(2)}/mo</span> — same as what you're paying now.</>
              )}
            </p>
          </div>
        );
      })()}

      {/* Cooked Rating */}
      <CookedRating
        tierKey={tierKey}
        planKey={userVariant ? userEntry!.key : undefined}
        cheapestPrice={cheapest}
        cheapestEffective={cheapestEffective < cheapest ? cheapestEffective : undefined}
        cheapestProviderName={cheapestAtHorizon?.plan.providerName}
        changeNote={changeText}
        cheapestPlanNote={cheapestAtHorizon?.plan.promoDuration && cheapestAtHorizon.plan.promoValue
          ? `${cheapestAtHorizon.plan.promoDuration} month intro discount, then it's ${money(cheapestAtHorizon.plan.monthlyPrice)}/mo`
          : undefined}
        fasterNote={fasterNote}
        hasSpeedChips={showSpeedFilter}
        cheapestPlanSpeed={cheapestAtHorizon ? `${cheapestAtHorizon.plan.downloadSpeed}/${cheapestAtHorizon.plan.uploadSpeed}` : undefined}
        scope={{
          yourDownload: tierData.downloadSpeed,
          yourUpload: userVariant ? userVariant.upload : isGrouped ? undefined : tierData.uploadSpeed,
          downloads: [tierData.downloadSpeed],
          uploads: isGrouped ? (speedFilter === 'all' ? uploadSpeeds : [speedFilter]) : [tierData.uploadSpeed],
        }}
        horizon={horizon}
        manifest={manifest}
        onCookedChange={handleCookedChange}
      />

      {/* How the saved plan compares with other speeds (same or better only counts against it) */}
      {userEntry && cookedResult && speedOptions && speedOptions.length > 0 && (
        <SpeedComparisons
          options={speedOptions}
          yours={userVariant ? { download: userVariant.download, upload: userVariant.upload } : (() => {
            const exact = parseTierKey(userEntry.key);
            return exact ? { download: exact.download, upload: exact.upload } : { download: tierData.downloadSpeed };
          })()}
          userPrice={userEntry.plan.price}
          horizon={horizon}
          mainLabel={currentResult?.label}
          mainLevel={currentResult?.level}
        />
      )}

      {/* Email alerts for this tier (exact tiers only; grouped pages cover several) */}
      {!isGrouped && (
        <AlertSignup
          tierKey={tierKey}
          label={label}
          defaultPrice={userPlan?.fullPrice ?? userPlan?.price}
          defaultProvider={userPlan?.provider}
          defaultPromoEndsAt={userPlan?.promoMonthsLeft ? (() => {
            const d = new Date(userPlan.savedAt);
            d.setMonth(d.getMonth() + userPlan.promoMonthsLeft);
            return d.toISOString().split('T')[0];
          })() : undefined}
        />
      )}

      {/* Savings Comparison — only shows when user has savings */}
      {/* Skipped when the saving comes from an averaged intro price: its yearly and house deposit sums would overstate it */}
      {cookedResult && cookedResult.monthlySavings > 0 && comparisons && baseline >= viewCheapest - 0.005 && (() => {
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
          plans={viewPlans}
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
