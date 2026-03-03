import { useState, useMemo } from 'preact/hooks';
import type { NBNPlan, ProviderHistory } from '../lib/types';

type SortKey = 'monthlyPrice' | 'totalCost' | 'effectiveCost' | 'typicalEveningSpeed';
type SortDir = 'asc' | 'desc';
type Horizon = 3 | 6 | 12 | 24;

interface Props {
  plans: NBNPlan[];
  highlightProvider?: string;
  userPrice?: number;
  userFullPrice?: number;       // User's price after promo ends
  userPromoMonthsLeft?: number; // Months left on user's promo
  providerHistory?: Record<string, ProviderHistory>;
}

/** Calculate total cost and effective monthly for a plan over a given horizon */
function calcCosts(plan: NBNPlan, months: Horizon) {
  const promoMonths = Math.min(plan.promoDuration ?? 0, months);
  const fullMonths = months - promoMonths;
  const promoDiscount = plan.promoValue ?? 0;
  const totalCost =
    promoMonths * (plan.monthlyPrice - promoDiscount) +
    fullMonths * plan.monthlyPrice +
    plan.setupFee;
  const effectiveCost = totalCost / months;
  return {
    totalCost: Math.round(totalCost * 100) / 100,
    effectiveCost: Math.round(effectiveCost * 100) / 100,
  };
}

// Mini sparkline for provider price history
function ProviderSparkline({ history }: { history: { date: string; monthlyPrice: number }[] }) {
  if (history.length < 2) return null;

  const prices = history.map(h => h.monthlyPrice);
  const min = Math.min(...prices) - 2;
  const max = Math.max(...prices) + 2;
  const range = max - min || 1;
  const w = 280;
  const h = 60;

  const points = history
    .map((entry, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((entry.monthlyPrice - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');

  const firstDate = new Date(history[0].date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const lastDate = new Date(history[history.length - 1].date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

  return (
    <div>
      <div class="text-xs text-neutral-500 mb-1">Price history</div>
      <svg viewBox={`-5 -5 ${w + 10} ${h + 20}`} class="w-full max-w-[280px]" preserveAspectRatio="xMidYMid meet">
        <polyline
          points={points}
          fill="none"
          stroke="#f97316"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <text x={0} y={h + 14} fill="#737373" font-size="9">{firstDate}</text>
        <text x={w} y={h + 14} fill="#737373" font-size="9" text-anchor="end">{lastDate}</text>
        <text x={-2} y={6} fill="#737373" font-size="9" text-anchor="end">${max.toFixed(0)}</text>
        <text x={-2} y={h} fill="#737373" font-size="9" text-anchor="end">${min.toFixed(0)}</text>
      </svg>
    </div>
  );
}

export default function PlanTable({ plans, highlightProvider, userPrice, userFullPrice, userPromoMonthsLeft, providerHistory }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('effectiveCost');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterNoLockin, setFilterNoLockin] = useState(false);
  const [filterHasPromo, setFilterHasPromo] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<Horizon>(12);

  const filtered = useMemo(() => {
    let result = plans;
    if (filterNoLockin) result = result.filter((p) => p.contractLength === 0);
    if (filterHasPromo) result = result.filter((p) => p.promoValue && p.promoValue > 0);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.providerName.toLowerCase().includes(q) || p.planName.toLowerCase().includes(q)
      );
    }
    return result;
  }, [plans, filterNoLockin, filterHasPromo, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === 'totalCost') {
        av = calcCosts(a, horizon).totalCost;
        bv = calcCosts(b, horizon).totalCost;
      } else if (sortKey === 'effectiveCost') {
        av = calcCosts(a, horizon).effectiveCost;
        bv = calcCosts(b, horizon).effectiveCost;
      } else {
        av = (a[sortKey] as number) ?? Infinity;
        bv = (b[sortKey] as number) ?? Infinity;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [filtered, sortKey, sortDir, horizon]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id);
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const horizonLabel = horizon === 12 ? '1yr' : horizon === 24 ? '2yr' : `${horizon}mo`;

  return (
    <div>
      {/* Filters + horizon selector */}
      <div class="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search providers..."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          class="bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
        />
        <label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={filterNoLockin}
            onChange={() => setFilterNoLockin(!filterNoLockin)}
            class="accent-accent"
          />
          No lock-in
        </label>
        <label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={filterHasPromo}
            onChange={() => setFilterHasPromo(!filterHasPromo)}
            class="accent-accent"
          />
          Has promo
        </label>
        <span class="text-sm text-neutral-500 self-center ml-auto">
          {sorted.length} plan{sorted.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Time horizon selector */}
      <div class="flex items-center gap-2 mb-3">
        <span class="text-sm text-neutral-400">Compare over:</span>
        {([3, 6, 12, 24] as Horizon[]).map((h) => (
          <button
            key={h}
            onClick={() => setHorizon(h)}
            class={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              horizon === h
                ? 'bg-accent text-white'
                : 'bg-surface border border-surface-border text-neutral-400 hover:text-white'
            }`}
          >
            {h === 12 ? '1 year' : h === 24 ? '2 years' : `${h} months`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div class="overflow-x-auto rounded-xl border border-surface-border">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-border text-left text-neutral-400">
              <th class="px-4 py-3 font-medium">Provider</th>
              <th class="px-4 py-3 font-medium">Plan</th>
              <th
                class="px-4 py-3 font-medium cursor-pointer hover:text-white whitespace-nowrap"
                onClick={() => toggleSort('monthlyPrice')}
              >
                Monthly{sortIndicator('monthlyPrice')}
              </th>
              <th
                class="px-4 py-3 font-medium cursor-pointer hover:text-white whitespace-nowrap hidden sm:table-cell"
                onClick={() => toggleSort('totalCost')}
              >
                {horizonLabel} total{sortIndicator('totalCost')}
              </th>
              <th
                class="px-4 py-3 font-medium cursor-pointer hover:text-white whitespace-nowrap hidden md:table-cell"
                onClick={() => toggleSort('effectiveCost')}
              >
                Effective/mo{sortIndicator('effectiveCost')}
              </th>
              <th
                class="px-4 py-3 font-medium cursor-pointer hover:text-white whitespace-nowrap hidden lg:table-cell"
                onClick={() => toggleSort('typicalEveningSpeed')}
              >
                Eve Speed{sortIndicator('typicalEveningSpeed')}
              </th>
              <th class="px-4 py-3 font-medium hidden lg:table-cell">Contract</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((plan) => {
              const isHighlighted =
                highlightProvider &&
                plan.providerName.toLowerCase() === highlightProvider.toLowerCase();
              const isExpanded = expandedId === plan.id;
              const history = providerHistory?.[plan.providerName]?.history;
              const { totalCost, effectiveCost } = calcCosts(plan, horizon);
              const hasSavings = userPrice && userPrice > effectiveCost;
              const savings = userPrice ? userPrice - effectiveCost : 0;
              const hasPromo = plan.promoValue && plan.promoValue > 0 && plan.promoDuration;
              // Is the promo still active within the selected horizon?
              const promoActive = hasPromo && (plan.promoDuration ?? 0) > 0;
              // Does the promo fully cover the horizon?
              const promoCoversHorizon = hasPromo && (plan.promoDuration ?? 0) >= horizon;

              return (
                <>
                  <tr
                    key={plan.id}
                    onClick={() => toggleExpand(plan.id)}
                    class={`border-b border-surface-border/50 hover:bg-surface-raised/50 transition-colors cursor-pointer ${
                      isHighlighted ? 'bg-accent/10 border-l-2 border-l-accent' : ''
                    } ${isExpanded ? 'bg-surface-raised/70' : ''}`}
                  >
                    <td class="px-4 py-3 font-medium text-white">
                      <span class="flex items-center gap-1.5">
                        <span class={`text-[10px] text-neutral-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                        {plan.providerName}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-neutral-300 max-w-[200px] truncate">
                      <span class="flex items-center gap-2">
                        {plan.cisUrl ? (
                          <a
                            href={plan.cisUrl}
                            target="_blank"
                            rel="noopener"
                            class="hover:text-accent underline decoration-neutral-600 hover:decoration-accent truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {plan.planName}
                          </a>
                        ) : (
                          <span class="truncate">{plan.planName}</span>
                        )}
                        {hasPromo && (
                          <span class={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            promoCoversHorizon
                              ? 'bg-cooked-green/20 text-cooked-green'
                              : 'bg-accent/20 text-accent'
                          }`}>
                            -{plan.promoValue?.toFixed(0)}/mo x {plan.promoDuration}mo
                          </span>
                        )}
                      </span>
                    </td>
                    <td class="px-4 py-3 tabular-nums font-medium">
                      ${plan.monthlyPrice.toFixed(2)}
                    </td>
                    <td class="px-4 py-3 tabular-nums text-neutral-300 hidden sm:table-cell">
                      ${totalCost.toFixed(0)}
                    </td>
                    <td class="px-4 py-3 tabular-nums hidden md:table-cell">
                      <span class={effectiveCost < plan.monthlyPrice ? 'text-cooked-green font-medium' : 'text-neutral-300'}>
                        ${effectiveCost.toFixed(2)}
                      </span>
                    </td>
                    <td class="px-4 py-3 tabular-nums text-neutral-300 hidden lg:table-cell">
                      {plan.typicalEveningSpeed
                        ? `${plan.typicalEveningSpeed} Mbps`
                        : '—'}
                    </td>
                    <td class="px-4 py-3 text-neutral-400 hidden lg:table-cell">
                      {plan.contractLength === 0
                        ? 'No lock-in'
                        : `${plan.contractLength} mo`}
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <tr key={`${plan.id}-detail`} class="border-b border-surface-border/50 bg-surface-raised/30">
                      <td colSpan={7} class="px-4 py-4">
                        <div class="flex flex-col sm:flex-row gap-6">
                          {/* Plan details + comparison */}
                          <div class="flex-1 space-y-3">
                            {/* Promo breakdown */}
                            {hasPromo && (
                              <div class="bg-accent/10 border border-accent/20 rounded-lg p-3 text-sm">
                                <div class="font-medium text-accent mb-1">
                                  Promo: -${plan.promoValue?.toFixed(2)}/mo for {plan.promoDuration} months
                                </div>
                                <div class="text-neutral-400 text-xs space-y-0.5">
                                  <div>Months 1-{plan.promoDuration}: <span class="text-white">${(plan.monthlyPrice - (plan.promoValue ?? 0)).toFixed(2)}/mo</span></div>
                                  {(plan.promoDuration ?? 0) < horizon && (
                                    <div>Months {(plan.promoDuration ?? 0) + 1}-{horizon}: <span class="text-white">${plan.monthlyPrice.toFixed(2)}/mo</span> (full price)</div>
                                  )}
                                </div>
                              </div>
                            )}

                            <div class="text-sm space-y-1.5">
                              <div class="flex justify-between">
                                <span class="text-neutral-500">Monthly price</span>
                                <span class="text-white font-medium tabular-nums">${plan.monthlyPrice.toFixed(2)}</span>
                              </div>
                              <div class="flex justify-between">
                                <span class="text-neutral-500">{horizonLabel} total cost</span>
                                <span class="text-white tabular-nums">${totalCost.toFixed(0)}</span>
                              </div>
                              <div class="flex justify-between">
                                <span class="text-neutral-500">Effective monthly ({horizonLabel})</span>
                                <span class={`tabular-nums ${effectiveCost < plan.monthlyPrice ? 'text-cooked-green font-medium' : 'text-white'}`}>
                                  ${effectiveCost.toFixed(2)}
                                </span>
                              </div>
                              {plan.setupFee > 0 && (
                                <div class="flex justify-between">
                                  <span class="text-neutral-500">Setup fee (included above)</span>
                                  <span class="text-white tabular-nums">${plan.setupFee.toFixed(2)}</span>
                                </div>
                              )}
                              {plan.typicalEveningSpeed && (
                                <div class="flex justify-between">
                                  <span class="text-neutral-500">Typical evening speed</span>
                                  <span class="text-white">{plan.typicalEveningSpeed} Mbps</span>
                                </div>
                              )}
                              <div class="flex justify-between">
                                <span class="text-neutral-500">Contract</span>
                                <span class="text-white">
                                  {plan.contractLength === 0 ? 'No lock-in' : `${plan.contractLength} months`}
                                </span>
                              </div>
                              {plan.minimumTerm && (
                                <div class="flex justify-between">
                                  <span class="text-neutral-500">Minimum term</span>
                                  <span class="text-white">{plan.minimumTerm}</span>
                                </div>
                              )}
                              {plan.cancellationFees && (
                                <div class="flex justify-between">
                                  <span class="text-neutral-500">Cancellation</span>
                                  <span class="text-white">{plan.cancellationFees}</span>
                                </div>
                              )}
                            </div>

                            {/* Comparison with user's plan */}
                            {userPrice && (
                              <div class={`rounded-lg p-3 text-sm ${hasSavings ? 'bg-cooked-green/10 border border-cooked-green/20' : 'bg-surface border border-surface-border'}`}>
                                {hasSavings ? (
                                  <p class="text-neutral-300">
                                    Over {horizonLabel}, effectively save <span class="font-bold text-cooked-green">${savings.toFixed(2)}/mo</span>{' '}
                                    (<span class="font-bold text-cooked-green">${(savings * horizon).toFixed(0)} total</span>)
                                  </p>
                                ) : savings < 0 ? (
                                  <p class="text-neutral-400">
                                    Over {horizonLabel}, effectively <span class="font-medium text-white">${Math.abs(savings).toFixed(2)}/mo more</span> than your current plan
                                  </p>
                                ) : (
                                  <p class="text-neutral-400">
                                    Same effective price as your current plan
                                  </p>
                                )}
                                {/* Show post-promo comparison if user is on a promo */}
                                {userFullPrice && userPromoMonthsLeft != null && userPromoMonthsLeft > 0 && (
                                  <p class="text-neutral-500 text-xs mt-1.5">
                                    After your promo ends ({userPromoMonthsLeft}mo left): you'll pay <span class="text-white">${userFullPrice.toFixed(2)}/mo</span>
                                    {userFullPrice > effectiveCost ? (
                                      <> — switching saves <span class="text-cooked-green">${(userFullPrice - effectiveCost).toFixed(2)}/mo</span></>
                                    ) : userFullPrice < effectiveCost ? (
                                      <> — still cheaper than this plan by ${(effectiveCost - userFullPrice).toFixed(2)}/mo</>
                                    ) : null}
                                  </p>
                                )}
                              </div>
                            )}

                            {plan.cisUrl && (
                              <a
                                href={plan.cisUrl}
                                target="_blank"
                                rel="noopener"
                                class="inline-flex items-center gap-2 text-sm bg-surface border border-surface-border rounded-lg px-3 py-2 text-accent hover:border-accent transition-colors"
                              >
                                <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 17h6M9 13h6M9 9h1" />
                                </svg>
                                Critical Information Summary (PDF)
                              </a>
                            )}
                          </div>

                          {/* Provider price history chart */}
                          {history && history.length >= 2 && (
                            <div class="flex-shrink-0">
                              <ProviderSparkline history={history} />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
