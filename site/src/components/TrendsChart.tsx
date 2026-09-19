import { useState, useRef, useMemo } from 'preact/hooks';
import { CHART, money, shortDate, longDate, niceTicks } from '../lib/chart';

export interface TrendSeriesData {
  key: string;
  label: string;
  points: { date: string; cheapest: number; average: number; planCount?: number }[];
}

/** Fixed categorical set, validated for colour-vision deficiency on the dark surface. */
export const SERIES_COLORS = ['#f97316', '#22d3ee', '#a78bfa', '#4ade80'];
/** Only this many tiers get a colour at once; any others draw as grey context lines. */
const MAX_COLOURED = SERIES_COLORS.length;
const DAY = 86400000;

type Metric = 'cheapest' | 'average';
type Range = 'all' | '90d' | '30d';

interface Props {
  /** Series rendered on the server (the default selection) */
  series: TrendSeriesData[];
  /** Tier keys selected on first render */
  defaultSelected: string[];
  /** Labels of every available tier, in master order (colour follows this order) */
  catalogue: { key: string; label: string }[];
  /** id of a <script type="application/json"> holding every series, read on first use */
  dataId?: string;
}

/**
 * The year's price lines. Up to four tiers at once, each with a fixed colour that
 * follows the tier (never its position), direct end labels, a legend, hover
 * crosshair with every selected value, and a table view underneath.
 */
export default function TrendsChart({ series: initial, defaultSelected, catalogue, dataId }: Props) {
  const [series, setSeries] = useState<TrendSeriesData[]>(initial);
  const initialKeys = defaultSelected.filter(k => initial.some(s => s.key === k));
  const [selected, setSelected] = useState<string[]>(initialKeys);
  // A colour sticks to a tier for as long as it is selected; the first four picks get one, the rest are grey
  const [colours, setColours] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialKeys.slice(0, MAX_COLOURED).map((k, i) => [k, SERIES_COLORS[i]])));

  // Pull the full dataset from the page the first time another tier is wanted
  const ensureAll = () => {
    if (!dataId || series.length >= catalogue.length) return;
    const el = document.getElementById(dataId);
    if (!el) return;
    try {
      const all = JSON.parse(el.textContent || '[]') as TrendSeriesData[];
      if (all.length) setSeries(all);
    } catch {}
  };
  const [metric, setMetric] = useState<Metric>('cheapest');
  const [range, setRange] = useState<Range>('all');
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const colorOf = (key: string): string | null => colours[key] ?? null;

  const now = Date.now();
  const rangeStart = range === '30d' ? now - 30 * DAY : range === '90d' ? now - 90 * DAY : 0;

  const active = useMemo(() => selected
    .map(k => series.find(s => s.key === k)!)
    .filter(Boolean)
    .map(s => ({
      ...s,
      color: colorOf(s.key) ?? CHART.context,
      coloured: colorOf(s.key) != null,
      pts: s.points
        .map(p => ({ t: new Date(p.date).getTime(), v: metric === 'cheapest' ? p.cheapest : p.average, date: p.date }))
        .filter(p => p.t >= rangeStart && Number.isFinite(p.v) && p.v > 0),
    }))
    .filter(s => s.pts.length > 1)
    // Grey context lines first so the coloured ones draw on top
    .sort((a, b) => Number(a.coloured) - Number(b.coloured)), [selected, series, metric, range, colours]);

  const padL = 48, padR = 96, padT = 14, padB = 26, plotW = 640, plotH = 240;
  const w = padL + plotW + padR, h = padT + plotH + padB;

  if (active.length === 0) {
    return <p class="text-sm text-neutral-500">Pick at least one tier below.</p>;
  }

  const tMin = Math.min(...active.map(s => s.pts[0].t));
  const tMax = Math.max(...active.map(s => s.pts[s.pts.length - 1].t));
  const vs = active.flatMap(s => s.pts.map(p => p.v));
  const vLo = Math.min(...vs), vHi = Math.max(...vs);
  const pad = Math.max((vHi - vLo) * 0.12, 2);
  const yTicks = niceTicks(vLo - pad, vHi + pad, 5);
  // Ticks are rounded; the domain must still contain every point
  const yMin = Math.min(yTicks[0], vLo - pad), yMax = Math.max(yTicks[yTicks.length - 1], vHi + pad);
  const x = (t: number) => padL + ((t - tMin) / (tMax - tMin || 1)) * plotW;
  const y = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const xTickCount = 5;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => tMin + ((tMax - tMin) * i) / xTickCount);

  const hover = hoverT != null ? active.map(s => {
    const pt = [...s.pts].reverse().find(p => p.t <= hoverT) ?? s.pts[0];
    return { ...s, pt };
  }) : null;
  const hoverX = hover ? x(hover[0].pt.t) : 0;

  // Direct end labels only for coloured lines; keep them from colliding by pushing apart
  const endLabels = active.filter(s => s.coloured).map(s => ({ key: s.key, label: s.label, color: s.color, y: y(s.pts[s.pts.length - 1].v), v: s.pts[s.pts.length - 1].v }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y - endLabels[i - 1].y < 14) endLabels[i].y = endLabels[i - 1].y + 14;
  }

  const toggle = (key: string) => {
    ensureAll();
    const isOn = selected.includes(key);
    setSelected(sel => isOn ? sel.filter(k => k !== key) : [...sel, key]);
    setColours(cur => {
      const next = { ...cur };
      if (isOn) {
        delete next[key];
      } else if (Object.keys(next).length < MAX_COLOURED) {
        next[key] = SERIES_COLORS.find(c => !Object.values(next).includes(c)) ?? SERIES_COLORS[0];
      }
      return next;
    });
  };
  const greyCount = active.filter(s => !s.coloured).length;

  return (
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div class="flex gap-1">
          {(['cheapest', 'average'] as const).map(m => (
            <button type="button" onClick={() => setMetric(m)}
                    class={`text-xs px-3 py-1 rounded-full transition-colors ${metric === m ? 'bg-accent text-black' : 'bg-surface border border-surface-border text-neutral-400 hover:text-white'}`}>
              {m === 'cheapest' ? 'Cheapest plan' : 'Average price'}
            </button>
          ))}
        </div>
        <div class="flex gap-1">
          {(['all', '90d', '30d'] as const).map(r => (
            <button type="button" onClick={() => setRange(r)}
                    class={`text-xs px-3 py-1 rounded-full transition-colors ${range === r ? 'bg-surface-border text-white' : 'bg-surface border border-surface-border text-neutral-400 hover:text-white'}`}>
              {r === 'all' ? 'Since March' : r === '90d' ? '90 days' : '30 days'}
            </button>
          ))}
        </div>
      </div>

      <div class="relative">
        <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} class="w-full touch-none" preserveAspectRatio="xMidYMid meet"
             onPointerMove={(e) => { const r = svgRef.current!.getBoundingClientRect(); const vx = ((e.clientX - r.left) / r.width) * w; setHoverT(Math.min(tMax, Math.max(tMin, tMin + ((vx - padL) / plotW) * (tMax - tMin)))); }}
             onPointerLeave={() => setHoverT(null)}>
          {yTicks.map(t => (
            <g>
              <line x1={padL} y1={y(t)} x2={padL + plotW} y2={y(t)} stroke={CHART.grid} stroke-width="1" />
              <text x={padL - 8} y={y(t) + 3} fill={CHART.textMuted} font-size="10" text-anchor="end">${t}</text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text x={x(t)} y={h - 8} fill={CHART.textMuted} font-size="10" text-anchor={i === 0 ? 'start' : i === xTickCount ? 'end' : 'middle'}>{shortDate(new Date(t).toISOString())}</text>
          ))}
          {active.map(s => (
            <path d={s.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)},${y(p.v)}`).join(' ')} fill="none" stroke={s.color} stroke-width={s.coloured ? 2 : 1.5} stroke-linejoin="round" stroke-linecap="round" />
          ))}
          {active.filter(s => s.coloured).map(s => {
            const last = s.pts[s.pts.length - 1];
            return <circle cx={x(last.t)} cy={y(last.v)} r={4} fill={s.color} stroke={CHART.surface} stroke-width="2" />;
          })}
          {endLabels.map(l => (
            <text x={padL + plotW + 8} y={l.y + 3} fill={CHART.textSecondary} font-size="10">{l.label} <tspan fill={CHART.textPrimary}>{money(l.v, 0)}</tspan></text>
          ))}
          {hover && (
            <g>
              <line x1={hoverX} y1={padT} x2={hoverX} y2={padT + plotH} stroke={CHART.textMuted} stroke-width="1" />
              {hover.filter(s => s.coloured).map(s => <circle cx={x(s.pt.t)} cy={y(s.pt.v)} r={4.5} fill={s.color} stroke={CHART.surface} stroke-width="2" />)}
            </g>
          )}
        </svg>
        {hover && (
          <div class="absolute pointer-events-none bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg text-xs z-10 whitespace-nowrap"
               style={{ left: `${(hoverX / w) * 100}%`, top: '0%', transform: `translate(${hoverX > w / 2 ? '-110%' : '10%'}, 0)` }}>
            <div class="text-neutral-400 mb-1">{longDate(new Date(hover[0].pt.t).toISOString())}</div>
            {[...hover].reverse().map(s => (
              <div class="flex items-center gap-2">
                <span class="inline-block w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                <span class={s.coloured ? 'text-neutral-300' : 'text-neutral-500'}>{s.label}</span>
                <span class={`tabular-nums ml-auto ${s.coloured ? 'text-white' : 'text-neutral-400'}`}>{money(s.pt.v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend doubles as the selector. The first four picks get a colour; the rest draw in grey. */}
      <div class="flex flex-wrap gap-2 mt-3">
        {catalogue.map(s => {
          const on = selected.includes(s.key);
          const colour = on ? colorOf(s.key) : null;
          return (
            <button type="button" onClick={() => toggle(s.key)}
                    title={on && !colour ? 'Drawn in grey. Deselect a coloured tier to free up a colour.' : undefined}
                    class={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? 'border-surface-border bg-surface-raised text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}>
              <span class={`inline-block w-2.5 h-2.5 rounded-full ${on && !colour ? 'ring-1 ring-neutral-500' : ''}`} style={{ background: colour ?? (on ? CHART.context : '#27272a') }} />
              {s.label}
            </button>
          );
        })}
      </div>
      <p class="text-xs text-neutral-600 mt-2">
        The first four tiers you pick get a colour; any more draw as grey context lines and still show up on hover and in the table.
        {greyCount > 0 && ` ${greyCount} in grey now.`}
      </p>

      <button type="button" onClick={() => setShowTable(v => !v)} class="mt-3 text-xs text-neutral-500 hover:text-white underline">
        {showTable ? 'Hide' : 'Show'} the numbers
      </button>
      {showTable && (
        <div class="overflow-x-auto mt-2">
          <table class="text-xs min-w-[420px]">
            <thead>
              <tr class="text-left text-neutral-500 border-b border-surface-border">
                <th class="py-1 pr-4 font-medium">Tier</th>
                <th class="py-1 pr-4 font-medium text-right">First</th>
                <th class="py-1 pr-4 font-medium text-right">Lowest</th>
                <th class="py-1 pr-4 font-medium text-right">Highest</th>
                <th class="py-1 pr-4 font-medium text-right">Now</th>
                <th class="py-1 font-medium text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {active.map(s => {
                const first = s.pts[0].v, last = s.pts[s.pts.length - 1].v;
                const lo = Math.min(...s.pts.map(p => p.v)), hi = Math.max(...s.pts.map(p => p.v));
                const d = last - first;
                return (
                  <tr class="border-b border-surface-border/50">
                    <td class="py-1 pr-4 text-neutral-300"><span class="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: s.color }} />{s.label}</td>
                    <td class="py-1 pr-4 text-right tabular-nums text-neutral-400">{money(first)}</td>
                    <td class="py-1 pr-4 text-right tabular-nums text-neutral-400">{money(lo)}</td>
                    <td class="py-1 pr-4 text-right tabular-nums text-neutral-400">{money(hi)}</td>
                    <td class="py-1 pr-4 text-right tabular-nums text-white">{money(last)}</td>
                    <td class={`py-1 text-right tabular-nums ${d > 0 ? 'text-cooked-red' : d < 0 ? 'text-cooked-green' : 'text-neutral-400'}`}>{d === 0 ? '—' : `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
