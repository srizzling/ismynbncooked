import { useState, useRef, useMemo } from 'preact/hooks';
import type { HistoryEntry, CookedLevel } from '../lib/types';
import { LEVELS, LEVEL_ORDER, levelFor, type ProviderRort } from '../lib/cooked';
import { CHART, money, pct, shortDate, longDate, niceTicks } from '../lib/chart';

const LEVEL_COLOR: Record<CookedLevel, string> = Object.fromEntries(LEVELS.map(l => [l.level, l.color])) as Record<CookedLevel, string>;
const LEVEL_LABEL: Record<CookedLevel, string> = Object.fromEntries(LEVELS.map(l => [l.level, l.label])) as Record<CookedLevel, string>;

// ─── Where the provider sits in each tier ────────────────────────────────────

export interface TierPositionRow {
  tierKey: string;
  label: string;
  price: number;
  cheapest: number;
  average: number;
  rank: number;
  planCount: number;
}

/**
 * One row per tier: a grey range from the tier's cheapest price to its average,
 * and a dot for this provider's price coloured by its Rort Scale level.
 * Reads left-to-right as "how far past the cheapest is this provider".
 */
export function TierPositionChart({ rows }: { rows: TierPositionRow[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (rows.length === 0) return null;

  const labelW = 96;
  const valueW = 88;
  const plotW = 420;
  const rowH = 22;
  const padT = 18;
  const padB = 6;
  const w = labelW + plotW + valueW;
  const h = padT + rows.length * rowH + padB;

  const lo = Math.min(...rows.map(r => r.cheapest));
  const hi = Math.max(...rows.map(r => Math.max(r.price, r.average)));
  // Domain hugs the data (prices never start at $0), ticks on clean steps inside it
  const xMin = Math.max(0, Math.floor((lo - 5) / 10) * 10);
  const xMax = Math.ceil((hi + 5) / 10) * 10;
  const step = niceTicks(0, xMax - xMin, 5)[1] || 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) ticks.push(v);
  const x = (v: number) => labelW + ((v - xMin) / (xMax - xMin || 1)) * plotW;

  const a = active != null ? rows[active] : null;
  const usedLevels = LEVEL_ORDER.filter(l => rows.some(r => levelFor((r.price - r.cheapest) / r.cheapest).level === l));

  return (
    <div>
      <div class="relative">
        <svg viewBox={`0 0 ${w} ${h}`} class="w-full" preserveAspectRatio="xMidYMid meet" onPointerLeave={() => setActive(null)}>
          {ticks.map(t => (
            <g>
              <line x1={x(t)} y1={padT - 4} x2={x(t)} y2={h - padB} stroke={CHART.grid} stroke-width="1" />
              <text x={x(t)} y={padT - 8} fill={CHART.textMuted} font-size="9" text-anchor="middle">${t}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cy = padT + i * rowH + rowH / 2;
            const level = levelFor((r.price - r.cheapest) / r.cheapest);
            const isActive = active === i;
            return (
              <g onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)}>
                <rect x={0} y={cy - rowH / 2} width={w} height={rowH} fill={isActive ? CHART.accent : 'transparent'} fill-opacity={isActive ? 0.06 : 0} />
                <text x={labelW - 8} y={cy + 3} fill={isActive ? CHART.textPrimary : CHART.textSecondary} font-size="10" text-anchor="end">{r.label}</text>
                <rect x={x(r.cheapest)} y={cy - 3} width={Math.max(x(r.average) - x(r.cheapest), 2)} height={6} rx={3} fill={CHART.range} />
                <circle cx={x(r.price)} cy={cy} r={5} fill={level.color} stroke={CHART.surface} stroke-width="2" />
                <text x={labelW + plotW + 8} y={cy + 3} fill={CHART.textSecondary} font-size="10">
                  {r.price <= r.cheapest ? 'cheapest' : `+$${(r.price - r.cheapest).toFixed(2)}`}
                </text>
              </g>
            );
          })}
        </svg>
        {a && (
          <div class="absolute pointer-events-none bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg text-xs z-10 whitespace-nowrap"
               style={{ left: `${(x(a.price) / w) * 100}%`, top: `${((padT + active! * rowH) / h) * 100}%`, transform: 'translate(-50%, -110%)' }}>
            <div class="text-white font-medium">{a.label}</div>
            <div class="text-neutral-300 tabular-nums">This provider {money(a.price)} · #{a.rank} of {a.planCount}</div>
            <div class="text-neutral-400 tabular-nums">Tier cheapest {money(a.cheapest)} · average {money(a.average)}</div>
          </div>
        )}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-neutral-400">
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-1.5 rounded-full" style={{ background: CHART.range }} /> cheapest → average</span>
        {usedLevels.map(l => (
          <span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full" style={{ background: LEVEL_COLOR[l] }} /> {LEVEL_LABEL[l]}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Rort Scale distribution ─────────────────────────────────────────────────

/** Stacked bar of how many tiers fall at each Rort Scale level, with the overall verdict. */
export function RortDistribution({ rort }: { rort: ProviderRort }) {
  const total = rort.tierCount || 1;
  const segments = LEVEL_ORDER.map(l => ({ level: l, n: rort.counts[l], color: LEVEL_COLOR[l], label: LEVEL_LABEL[l] })).filter(s => s.n > 0);
  return (
    <div>
      <div class="flex h-3 rounded-full overflow-hidden gap-[2px]">
        {segments.map(s => (
          <div style={{ width: `${(s.n / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.n} tier${s.n === 1 ? '' : 's'}`} />
        ))}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-neutral-400">
        {segments.map(s => (
          <span class="inline-flex items-center gap-1.5">
            <span class="inline-block w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            {s.label} <span class="text-neutral-500 tabular-nums">{s.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Price trend across tiers ────────────────────────────────────────────────

export interface TrendSeries {
  tierKey: string;
  label: string;
  history: HistoryEntry[];
  lastSeen?: string;
}

const DAY = 86400000;

/**
 * Every tier's price as a step line indexed to its first tracked price, in
 * context grey; one tier (selectable) in the accent. Lets you see at a glance
 * whether a provider has been raising prices across the board or in one tier.
 */
export function ProviderTrendChart({ series }: { series: TrendSeries[] }) {
  // Legacy histories are day-by-day; keep only price change points so markers mean something
  const usable = series
    .map(s => ({ ...s, history: s.history.filter((h, i, arr) => i === 0 || h.monthlyPrice !== arr[i - 1].monthlyPrice) }))
    .filter(s => s.history.length > 0);
  const defaultKey = useMemo(() => {
    let best = usable[0]?.tierKey ?? '';
    let bestChanges = -1;
    for (const s of usable) {
      const changes = s.history.filter((h, i) => i > 0 && h.monthlyPrice !== s.history[i - 1].monthlyPrice).length;
      if (changes > bestChanges) { bestChanges = changes; best = s.tierKey; }
    }
    return best;
  }, [usable]);
  const [selected, setSelected] = useState(defaultKey);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (usable.length === 0) return null;

  const start = Math.min(...usable.map(s => new Date(s.history[0].date).getTime()));
  const end = Math.max(...usable.map(s => new Date(s.lastSeen ?? s.history[s.history.length - 1].date).getTime()), start + DAY);

  const padL = 44, padR = 12, padT = 12, padB = 24;
  const plotW = 560, plotH = 160;
  const w = padL + plotW + padR;
  const h = padT + plotH + padB;

  const lines = usable.map(s => {
    const base = s.history[0].monthlyPrice || 1;
    const pts = s.history.map(hst => ({ t: new Date(hst.date).getTime(), v: hst.monthlyPrice / base - 1, price: hst.monthlyPrice }));
    return { ...s, pts, endT: new Date(s.lastSeen ?? s.history[s.history.length - 1].date).getTime() };
  });
  const allV = lines.flatMap(l => l.pts.map(p => p.v));
  const vLo = Math.min(0, ...allV), vHi = Math.max(0, ...allV);
  const padV = Math.max((vHi - vLo) * 0.25, 0.03);
  const yMin = vLo - padV, yMax = vHi + padV;
  const x = (t: number) => padL + ((t - start) / (end - start)) * plotW;
  const y = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const pathFor = (l: typeof lines[number]) => {
    let d = '';
    l.pts.forEach((p, i) => {
      const nextT = i + 1 < l.pts.length ? l.pts[i + 1].t : l.endT;
      d += `${i === 0 ? 'M' : 'L'}${x(p.t)},${y(p.v)} L${x(nextT)},${y(p.v)}`;
    });
    return d;
  };

  const sel = lines.find(l => l.tierKey === selected) ?? lines[0];
  const yTicks = niceTicks(yMin, yMax, 3).filter(t => t >= yMin && t <= yMax);
  const xTickCount = 4;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => start + ((end - start) * i) / xTickCount);

  const hover = hoverT != null ? (() => {
    const pt = [...sel.pts].reverse().find(p => p.t <= hoverT) ?? sel.pts[0];
    return { t: hoverT, price: pt.price, v: pt.v };
  })() : null;

  const totalChanges = lines.reduce((n, l) => n + l.pts.filter((p, i) => i > 0 && p.price !== l.pts[i - 1].price).length, 0);

  return (
    <div>
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div class="text-xs text-neutral-400">
          {totalChanges === 0
            ? `No price changes recorded in any tier since ${longDate(new Date(start).toISOString())}.`
            : `${totalChanges} price change${totalChanges === 1 ? '' : 's'} across ${lines.length} tier${lines.length === 1 ? '' : 's'} since ${longDate(new Date(start).toISOString())}.`}
        </div>
        <label class="text-xs text-neutral-400 inline-flex items-center gap-2">
          Highlight
          <select value={selected} onChange={(e) => setSelected((e.currentTarget as HTMLSelectElement).value)}
                  class="bg-surface border border-surface-border rounded-md px-2 py-1 text-white text-xs">
            {lines.map(l => <option value={l.tierKey}>{l.label}</option>)}
          </select>
        </label>
      </div>
      <div class="relative">
        <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} class="w-full touch-none" preserveAspectRatio="xMidYMid meet"
             onPointerMove={(e) => { const r = svgRef.current!.getBoundingClientRect(); const vx = ((e.clientX - r.left) / r.width) * w; setHoverT(Math.min(end, Math.max(start, start + ((vx - padL) / plotW) * (end - start)))); }}
             onPointerLeave={() => setHoverT(null)}>
          {yTicks.map(t => (
            <g>
              <line x1={padL} y1={y(t)} x2={padL + plotW} y2={y(t)} stroke={t === 0 ? CHART.textMuted : CHART.grid} stroke-width="1" />
              <text x={padL - 6} y={y(t) + 3} fill={CHART.textMuted} font-size="9" text-anchor="end">{pct(t)}</text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text x={x(t)} y={h - 8} fill={CHART.textMuted} font-size="9" text-anchor={i === 0 ? 'start' : i === xTickCount ? 'end' : 'middle'}>{shortDate(new Date(t).toISOString())}</text>
          ))}
          {lines.filter(l => l.tierKey !== sel.tierKey).map(l => (
            <path d={pathFor(l)} fill="none" stroke={CHART.context} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          ))}
          <path d={pathFor(sel)} fill="none" stroke={CHART.accent} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          {sel.pts.slice(1).map(p => <circle cx={x(p.t)} cy={y(p.v)} r={4} fill={CHART.accent} stroke={CHART.surface} stroke-width="2" />)}
          <text x={Math.min(x(sel.endT), padL + plotW) - 4} y={y(sel.pts[sel.pts.length - 1].v) - 6} fill={CHART.textSecondary} font-size="9" text-anchor="end">{sel.label}</text>
          {hover && (
            <line x1={x(hover.t)} y1={padT} x2={x(hover.t)} y2={padT + plotH} stroke={CHART.textMuted} stroke-width="1" />
          )}
        </svg>
        {hover && (
          <div class="absolute pointer-events-none bg-surface border border-surface-border rounded-lg px-3 py-1.5 shadow-lg text-xs z-10 whitespace-nowrap"
               style={{ left: `${(x(hover.t) / w) * 100}%`, top: `${(y(hover.v) / h) * 100}%`, transform: 'translate(-50%, -120%)' }}>
            <div class="text-white font-medium">{sel.label}: {money(hover.price)}/mo</div>
            <div class="text-neutral-400">{longDate(new Date(hover.t).toISOString())} · {pct(hover.v)} vs first tracked</div>
          </div>
        )}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-neutral-400">
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5" style={{ background: CHART.accent }} /> {sel.label}</span>
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5" style={{ background: CHART.context }} /> other tiers</span>
        <span class="text-neutral-600">Y axis: change since first tracked price</span>
      </div>
    </div>
  );
}
