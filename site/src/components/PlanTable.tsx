import { useState, useMemo, useEffect, useRef, useCallback } from 'preact/hooks';
import type { NBNPlan, ProviderHistory } from '../lib/types';
import { calcCosts, type Horizon, HORIZONS } from '../lib/costs';

type SortKey = 'monthlyPrice' | 'totalCost' | 'effectiveCost' | 'typicalEveningSpeed' | 'eff3mo' | 'eff6mo' | 'eff12mo';
type SortDir = 'asc' | 'desc';

interface ColumnDef {
  key: string;
  label: string | ((horizon: string) => string);
  always?: boolean;
  mobileDefault?: boolean;
  sortKey?: SortKey;
}

const BASE_COLUMNS: ColumnDef[] = [
  { key: 'provider', label: 'Provider', always: true, mobileDefault: true },
  { key: 'planName', label: 'Plan', always: true, mobileDefault: true },
  { key: 'uploadSpeed', label: 'Upload', mobileDefault: true },
  { key: 'monthlyPrice', label: 'Monthly', mobileDefault: true, sortKey: 'monthlyPrice' },
  { key: 'promo', label: 'Promo', mobileDefault: true },
  { key: 'eff3mo', label: '3mo $/mo', sortKey: 'eff3mo' },
  { key: 'eff6mo', label: '6mo $/mo', sortKey: 'eff6mo' },
  { key: 'eff12mo', label: '1yr $/mo', sortKey: 'eff12mo' },
  { key: 'totalCost', label: (h) => `${h} Total`, sortKey: 'totalCost' },
  { key: 'typicalEveningSpeed', label: 'Eve Speed', sortKey: 'typicalEveningSpeed' },
  { key: 'contract', label: 'Contract' },
  { key: 'noticePeriod', label: 'Notice' },
];

interface Props {
  plans: NBNPlan[];
  highlightProvider?: string;
  userPrice?: number;
  userFullPrice?: number;
  userPromoMonthsLeft?: number;
  providerHistory?: Record<string, ProviderHistory>;
  horizon: Horizon;
  onHorizonChange: (h: Horizon) => void;
  showUploadSpeed?: boolean;
}

function isNoNotice(val: string | null | undefined): boolean {
  if (!val) return true;
  const lower = val.toLowerCase().trim();
  return lower === '' || lower === 'none' || lower === 'not specified' || lower === 'no notice required';
}

// Interactive sparkline for provider price history
function ProviderSparkline({ history }: { history: { date: string; monthlyPrice: number }[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (history.length < 2) return null;

  const prices = history.map(h => h.monthlyPrice);
  const min = Math.min(...prices) - 2;
  const max = Math.max(...prices) + 2;
  const range = max - min || 1;
  const w = 400;
  const h = 80;
  const pad = 5;

  const dataPoints = history.map((entry, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((entry.monthlyPrice - min) / range) * h;
    return { x, y, date: entry.date, value: entry.monthlyPrice };
  });

  const points = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  const firstDate = new Date(history[0].date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const lastDate = new Date(history[history.length - 1].date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

  const handleMouseMove = (e: MouseEvent) => {
    const svg = svgRef.current;
    if (!svg || !dataPoints.length) return;
    const rect = svg.getBoundingClientRect();
    const svgWidth = w + pad * 2;
    const scaleX = svgWidth / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX - pad;

    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < dataPoints.length; i++) {
      const dist = Math.abs(dataPoints[i].x - mouseX);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    }
    setActiveIndex(nearest);
  };

  const handleMouseLeave = () => setActiveIndex(null);

  const activePoint = activeIndex != null ? dataPoints[activeIndex] : null;
  const svgW = w + pad * 2;
  const svgH = h + 20 + pad;

  return (
    <div>
      <div class="text-xs text-neutral-500 mb-1">Price history</div>
      <div class="relative">
        <svg
          ref={svgRef}
          viewBox={`-${pad} -${pad} ${svgW} ${svgH}`}
          class="w-full"
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <polyline
            points={points}
            fill="none"
            stroke="#f97316"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          {activePoint && (
            <>
              <line
                x1={activePoint.x}
                y1={0}
                x2={activePoint.x}
                y2={h}
                stroke="#525252"
                stroke-width="1"
                stroke-dasharray="4 3"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="4"
                fill="#f97316"
                stroke="#1c1917"
                stroke-width="2"
              />
            </>
          )}
          <text x={0} y={h + 14} fill="#737373" font-size="9">{firstDate}</text>
          <text x={w} y={h + 14} fill="#737373" font-size="9" text-anchor="end">{lastDate}</text>
          <text x={-2} y={6} fill="#737373" font-size="9" text-anchor="end">${max.toFixed(0)}</text>
          <text x={-2} y={h} fill="#737373" font-size="9" text-anchor="end">${min.toFixed(0)}</text>
        </svg>
        {activePoint && (
          <div
            class="absolute pointer-events-none bg-surface border border-surface-border rounded-lg px-3 py-1.5 shadow-lg text-xs z-10"
            style={{
              left: `${((activePoint.x + pad) / svgW) * 100}%`,
              top: `${((activePoint.y + pad) / svgH) * 100 - 10}%`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div class="text-white font-medium tabular-nums">${activePoint.value.toFixed(2)}</div>
            <div class="text-neutral-400">
              {new Date(activePoint.date).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlanTable({ plans, highlightProvider, userPrice, userFullPrice, userPromoMonthsLeft, providerHistory, horizon, onHorizonChange, showUploadSpeed }: Props) {
  // Filter out the upload column unless showUploadSpeed is set
  const COLUMNS = useMemo(() =>
    BASE_COLUMNS.filter(c => c.key !== 'uploadSpeed' || showUploadSpeed),
    [showUploadSpeed]
  );

  const horizonToSortKey = (h: Horizon): SortKey =>
    h === 3 ? 'eff3mo' : h === 6 ? 'eff6mo' : h === 12 ? 'eff12mo' : 'monthlyPrice';
  const [sortKey, setSortKey] = useState<SortKey>(() => horizonToSortKey(horizon));
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterNoLockin, setFilterNoLockin] = useState(false);
  const [filterHasPromo, setFilterHasPromo] = useState(false);
  const [filterNoNotice, setFilterNoNotice] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    // SSR-safe default: mobile set. Will update on mount via useEffect.
    const initial = new Set(['monthlyPrice', 'promo']);
    if (showUploadSpeed) initial.add('uploadSpeed');
    return initial;
  });
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Set initial visible columns based on screen size
  useEffect(() => {
    const isLg = window.matchMedia('(min-width: 1024px)').matches;
    if (isLg) {
      setVisibleColumns(new Set(COLUMNS.filter(c => !c.always).map(c => c.key)));
    } else {
      setVisibleColumns(new Set(COLUMNS.filter(c => c.mobileDefault && !c.always).map(c => c.key)));
    }
  }, []);

  // Close column picker on outside click
  useEffect(() => {
    if (!columnPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setColumnPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [columnPickerOpen]);

  const filtered = useMemo(() => {
    let result = plans;
    if (filterNoLockin) result = result.filter((p) => p.contractLength === 0);
    if (filterHasPromo) result = result.filter((p) => p.promoValue && p.promoValue > 0);
    if (filterNoNotice) result = result.filter((p) => isNoNotice(p.noticePeriod));
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.providerName.toLowerCase().includes(q) || p.planName.toLowerCase().includes(q)
      );
    }
    return result;
  }, [plans, filterNoLockin, filterHasPromo, filterNoNotice, search]);

  // Pre-compute costs for all plans at all relevant horizons — avoids repeated calcCosts in sort + render
  const costMap = useMemo(() => {
    const map = new Map<string, { h: ReturnType<typeof calcCosts>; eff3: number; eff6: number; eff12: number }>();
    for (const plan of filtered) {
      const h = calcCosts(plan, horizon);
      map.set(plan.id, {
        h,
        eff3: calcCosts(plan, 3).effectiveCost,
        eff6: calcCosts(plan, 6).effectiveCost,
        eff12: calcCosts(plan, 12).effectiveCost,
      });
    }
    return map;
  }, [filtered, horizon]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const ca = costMap.get(a.id)!;
      const cb = costMap.get(b.id)!;
      let av: number, bv: number;
      if (sortKey === 'totalCost') {
        av = ca.h.totalCost; bv = cb.h.totalCost;
      } else if (sortKey === 'effectiveCost') {
        av = ca.h.effectiveCost; bv = cb.h.effectiveCost;
      } else if (sortKey === 'eff3mo') {
        av = ca.eff3; bv = cb.eff3;
      } else if (sortKey === 'eff6mo') {
        av = ca.eff6; bv = cb.eff6;
      } else if (sortKey === 'eff12mo') {
        av = ca.eff12; bv = cb.eff12;
      } else {
        av = (a[sortKey] as number) ?? Infinity;
        bv = (b[sortKey] as number) ?? Infinity;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [filtered, costMap, sortKey, sortDir]);

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

  function toggleColumn(key: string) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const horizonLabel = horizon === 12 ? '1yr' : horizon === 24 ? '2yr' : `${horizon}mo`;

  const activeColumns = COLUMNS.filter(
    (c) => c.always || visibleColumns.has(c.key)
  );
  const visibleCount = activeColumns.length;

  function getColumnLabel(col: ColumnDef): string {
    return typeof col.label === 'function' ? col.label(horizonLabel) : col.label;
  }

  function renderCell(col: ColumnDef, plan: NBNPlan, costs: { h: ReturnType<typeof calcCosts>; eff3: number; eff6: number; eff12: number }) {
    const { totalCost, effectiveCost } = costs.h;
    switch (col.key) {
      case 'provider':
        return (
          <td class="px-4 py-3 font-medium text-white" key={col.key}>
            <span class="flex items-center gap-1.5">
              <span class={`text-[10px] text-neutral-500 transition-transform ${expandedId === plan.id ? 'rotate-90' : ''}`}>&#9654;</span>
              {plan.providerName}
            </span>
          </td>
        );
      case 'planName':
        return (
          <td class="px-4 py-3 text-neutral-300 max-w-[200px] truncate" key={col.key}>
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
          </td>
        );
      case 'uploadSpeed':
        return (
          <td class="px-4 py-3 tabular-nums text-neutral-300" key={col.key}>
            {plan.uploadSpeed} Mbps
          </td>
        );
      case 'monthlyPrice':
        return (
          <td class="px-4 py-3 tabular-nums font-medium" key={col.key}>
            ${plan.monthlyPrice.toFixed(2)}
          </td>
        );
      case 'promo': {
        const hasPromo = plan.promoValue && plan.promoValue > 0 && plan.promoDuration;
        const promoCoversHorizon = hasPromo && (plan.promoDuration ?? 0) >= horizon;
        return (
          <td class="px-4 py-3 text-sm" key={col.key}>
            {hasPromo ? (
              <span class={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
                promoCoversHorizon
                  ? 'bg-cooked-green/20 text-cooked-green'
                  : 'bg-accent/20 text-accent'
              }`}>
                ${(plan.monthlyPrice - (plan.promoValue ?? 0)).toFixed(2)} x {plan.promoDuration}mo
              </span>
            ) : (
              <span class="text-neutral-600">—</span>
            )}
          </td>
        );
      }
      case 'eff3mo':
        return (
          <td class={`px-4 py-3 tabular-nums ${horizon === 3 ? 'bg-accent/5' : ''}`} key={col.key}>
            <span class={costs.eff3 < plan.monthlyPrice ? 'text-cooked-green' : 'text-neutral-300'}>
              ${costs.eff3.toFixed(2)}
            </span>
          </td>
        );
      case 'eff6mo':
        return (
          <td class={`px-4 py-3 tabular-nums ${horizon === 6 ? 'bg-accent/5' : ''}`} key={col.key}>
            <span class={costs.eff6 < plan.monthlyPrice ? 'text-cooked-green' : 'text-neutral-300'}>
              ${costs.eff6.toFixed(2)}
            </span>
          </td>
        );
      case 'eff12mo':
        return (
          <td class={`px-4 py-3 tabular-nums ${horizon === 12 ? 'bg-accent/5' : ''}`} key={col.key}>
            <span class={costs.eff12 < plan.monthlyPrice ? 'text-cooked-green' : 'text-neutral-300'}>
              ${costs.eff12.toFixed(2)}
            </span>
          </td>
        );
      case 'totalCost':
        return (
          <td class="px-4 py-3 tabular-nums text-neutral-300" key={col.key}>
            ${totalCost.toFixed(0)}
          </td>
        );
      case 'typicalEveningSpeed':
        return (
          <td class="px-4 py-3 tabular-nums text-neutral-300" key={col.key}>
            {plan.typicalEveningSpeed
              ? `${plan.typicalEveningSpeed} Mbps`
              : '—'}
          </td>
        );
      case 'contract':
        return (
          <td class="px-4 py-3 text-neutral-400" key={col.key}>
            {plan.contractLength === 0
              ? 'No lock-in'
              : `${plan.contractLength} mo`}
          </td>
        );
      case 'noticePeriod':
        return (
          <td class="px-4 py-3 text-neutral-400" key={col.key}>
            {plan.noticePeriod ?? '—'}
          </td>
        );
      default:
        return null;
    }
  }

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
        <label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={filterNoNotice}
            onChange={() => setFilterNoNotice(!filterNoNotice)}
            class="accent-accent"
          />
          No notice period
        </label>

        {/* Column picker */}
        <div class="relative ml-auto self-center" ref={pickerRef}>
          <button
            onClick={() => setColumnPickerOpen(!columnPickerOpen)}
            class={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              columnPickerOpen
                ? 'bg-accent/10 border-accent text-accent'
                : 'bg-surface border-surface-border text-neutral-400 hover:text-white hover:border-neutral-600'
            }`}
          >
            Columns
          </button>
          {columnPickerOpen && (
            <div class="absolute right-0 top-full mt-1 z-20 bg-surface border border-surface-border rounded-lg shadow-xl p-2 min-w-[160px]">
              {COLUMNS.filter(c => !c.always).map((col) => (
                <label
                  key={col.key}
                  class="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer px-2 py-1.5 rounded hover:bg-surface-raised/50"
                >
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    class="accent-accent"
                  />
                  {getColumnLabel(col)}
                </label>
              ))}
            </div>
          )}
        </div>

        <span class="text-sm text-neutral-500 self-center">
          {sorted.length} plan{sorted.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div class="overflow-x-auto rounded-xl border border-surface-border">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-border text-left text-neutral-400">
              {activeColumns.map((col) => {
                const label = getColumnLabel(col);
                const isActiveHorizonCol =
                  (col.key === 'eff3mo' && horizon === 3) ||
                  (col.key === 'eff6mo' && horizon === 6) ||
                  (col.key === 'eff12mo' && horizon === 12);
                const thClass = `px-4 py-3 font-medium whitespace-nowrap ${isActiveHorizonCol ? 'bg-accent/5 text-accent' : ''}`;
                if (col.sortKey) {
                  return (
                    <th
                      key={col.key}
                      class={`${thClass} cursor-pointer hover:text-white`}
                      onClick={() => toggleSort(col.sortKey!)}
                    >
                      {label}{sortIndicator(col.sortKey)}
                    </th>
                  );
                }
                return (
                  <th key={col.key} class={thClass}>
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((plan) => {
              const isHighlighted =
                highlightProvider &&
                plan.providerName.toLowerCase() === highlightProvider.toLowerCase();
              const isExpanded = expandedId === plan.id;
              const history = providerHistory?.[plan.providerName]?.history;
              const costs = costMap.get(plan.id)!;
              const { totalCost, effectiveCost } = costs.h;
              const hasSavings = userPrice && userPrice > effectiveCost;
              const savings = userPrice ? userPrice - effectiveCost : 0;
              const hasPromo = plan.promoValue && plan.promoValue > 0 && plan.promoDuration;

              return (
                <>
                  <tr
                    key={plan.id}
                    onClick={() => toggleExpand(plan.id)}
                    class={`border-b border-surface-border/50 hover:bg-surface-raised/50 transition-colors cursor-pointer ${
                      isHighlighted ? 'bg-accent/10 border-l-2 border-l-accent' : ''
                    } ${isExpanded ? 'bg-surface-raised/70' : ''}`}
                  >
                    {activeColumns.map((col) => renderCell(col, plan, costs))}
                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <tr key={`${plan.id}-detail`} class="border-b border-surface-border/50 bg-surface-raised/30">
                      <td colSpan={visibleCount} class="px-4 py-4">
                        <div class="flex flex-col sm:flex-row gap-6">
                          {/* Plan details */}
                          <div class="sm:w-1/3 space-y-3">
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
                              {plan.noticePeriod && (
                                <div class="flex justify-between">
                                  <span class="text-neutral-500">Notice period</span>
                                  <span class="text-white">{plan.noticePeriod}</span>
                                </div>
                              )}
                            </div>

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
                            <div class="sm:w-2/3">
                              <ProviderSparkline history={history} />
                            </div>
                          )}
                        </div>

                        {/* Comparison with user's plan — full width */}
                        {userPrice && (
                          <div class={`mt-4 rounded-lg p-3 text-sm text-center ${hasSavings ? 'bg-cooked-green/10 border border-cooked-green/20' : 'bg-surface border border-surface-border'}`}>
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
