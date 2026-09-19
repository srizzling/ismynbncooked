import { useState } from 'preact/hooks';
import type { TrendSeriesData } from './TrendsChart';
import { CHART, money, shortDate } from '../lib/chart';

/**
 * Small multiples: one tile per tier with the cheapest-plan line in the accent
 * and the average in context grey, plus the change since tracking began.
 */
export default function TierTrendGrid({ series }: { series: TrendSeriesData[] }) {
  const [network, setNetwork] = useState<'nbn' | 'opticomm'>('nbn');
  const shown = series.filter(s => s.key.startsWith(network) && s.points.length > 1);

  return (
    <div>
      <div class="flex gap-1 mb-4">
        {(['nbn', 'opticomm'] as const).map(n => (
          <button type="button" onClick={() => setNetwork(n)}
                  class={`text-xs px-3 py-1 rounded-full transition-colors ${network === n ? 'bg-accent text-black' : 'bg-surface border border-surface-border text-neutral-400 hover:text-white'}`}>
            {n === 'nbn' ? 'NBN' : 'Opticomm'}
          </button>
        ))}
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {shown.map(s => <Tile s={s} />)}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-neutral-400">
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5" style={{ background: CHART.accent }} /> cheapest plan</span>
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5" style={{ background: CHART.context }} /> average price</span>
      </div>
    </div>
  );
}

function Tile({ s }: { s: TrendSeriesData }) {
  const w = 160, h = 48;
  const pts = s.points;
  const first = pts[0], last = pts[pts.length - 1];
  const t0 = new Date(first.date).getTime(), t1 = new Date(last.date).getTime() || t0 + 1;
  const vals = pts.flatMap(p => [p.cheapest, p.average]).filter(v => v > 0);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (d: string) => ((new Date(d).getTime() - t0) / (t1 - t0 || 1)) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * (h - 6) - 3;
  const path = (get: (p: TrendSeriesData['points'][number]) => number) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date)},${y(get(p))}`).join(' ');
  const delta = last.cheapest - first.cheapest;
  const pct = first.cheapest > 0 ? (delta / first.cheapest) * 100 : 0;

  return (
    <a href={`/${s.key}`} class="block bg-surface-raised border border-surface-border rounded-xl p-3 hover:border-accent transition-colors">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-sm font-medium text-white">{s.label}</span>
        <span class="text-sm tabular-nums text-white">{money(last.cheapest, 0)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} class="w-full mt-1" preserveAspectRatio="none" aria-hidden="true">
        <path d={path(p => p.average)} fill="none" stroke={CHART.context} stroke-width="1.5" stroke-linejoin="round" />
        <path d={path(p => p.cheapest)} fill="none" stroke={CHART.accent} stroke-width="2" stroke-linejoin="round" />
      </svg>
      <div class="flex justify-between text-[11px] mt-1">
        <span class="text-neutral-500">{shortDate(first.date)} → {shortDate(last.date)}</span>
        <span class={`tabular-nums ${delta > 0 ? 'text-cooked-red' : delta < 0 ? 'text-cooked-green' : 'text-neutral-500'}`}>
          {delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${money(Math.abs(delta), 0)} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)`}
        </span>
      </div>
    </a>
  );
}
