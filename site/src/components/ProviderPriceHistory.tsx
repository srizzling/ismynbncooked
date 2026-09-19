import { useState, useRef } from 'preact/hooks';
import type { HistoryEntry } from '../lib/types';

interface Props {
  /** Price change points (may also be legacy day-by-day data; it is compacted here). */
  history: HistoryEntry[];
  /** Last sync date that listed this provider. Defaults to the last history entry. */
  lastSeen?: string;
}

const DAY = 86400000;

function fmt(date: string, withYear = false) {
  return new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

function compact(entries: HistoryEntry[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const e of entries) {
    const prev = out[out.length - 1];
    if (!prev || prev.monthlyPrice !== e.monthlyPrice) out.push(e);
  }
  return out;
}

/**
 * Step chart of a provider's monthly price over time.
 * X axis is real time (first sighting → last seen), so a flat line means
 * "no change in this period", which is stated in words above the chart.
 */
export default function ProviderPriceHistory({ history, lastSeen }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const changes = compact(history);
  if (changes.length === 0) return null;

  const start = new Date(changes[0].date).getTime();
  const endDate = lastSeen && lastSeen > history[history.length - 1].date ? lastSeen : history[history.length - 1].date;
  const end = Math.max(new Date(endDate).getTime(), start + DAY);
  const spanDays = Math.round((end - start) / DAY);

  const w = 400;
  const h = 70;
  const padL = 40;
  const padR = 8;
  const padT = 8;
  const padB = 22;

  const prices = changes.map(c => c.monthlyPrice);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const single = lo === hi;
  const yMin = single ? lo - 5 : lo - (hi - lo) * 0.25;
  const yMax = single ? hi + 5 : hi + (hi - lo) * 0.25;
  const yRange = yMax - yMin || 1;

  const x = (t: number) => padL + ((t - start) / (end - start)) * w;
  const y = (p: number) => padT + h - ((p - yMin) / yRange) * h;

  // Segments: each price holds from its change date until the next change (or end)
  const segments = changes.map((c, i) => {
    const from = new Date(c.date).getTime();
    const to = i + 1 < changes.length ? new Date(changes[i + 1].date).getTime() : end;
    return { from, to, price: c.monthlyPrice, x1: x(from), x2: x(to), y: y(c.monthlyPrice), date: c.date };
  });

  let path = '';
  segments.forEach((s, i) => {
    path += i === 0 ? `M${s.x1},${s.y}` : `L${s.x1},${s.y}`;
    path += ` L${s.x2},${s.y}`;
  });

  const last = changes[changes.length - 1];
  const prev = changes.length > 1 ? changes[changes.length - 2] : null;
  const summary = prev
    ? `${changes.length - 1} price change${changes.length > 2 ? 's' : ''}. Last on ${fmt(last.date)}: $${prev.monthlyPrice.toFixed(2)} → $${last.monthlyPrice.toFixed(2)}`
    : `Unchanged at $${last.monthlyPrice.toFixed(2)} since ${fmt(changes[0].date, true)} (${spanDays} day${spanDays === 1 ? '' : 's'} tracked)`;

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * (w + padL + padR);
    let idx = segments.findIndex(s => vx >= s.x1 && vx <= s.x2);
    if (idx === -1) idx = vx < padL ? 0 : segments.length - 1;
    setActive(idx);
  };

  const seg = active != null ? segments[active] : null;
  const svgW = w + padL + padR;
  const svgH = h + padT + padB;

  return (
    <div>
      <div class="flex items-baseline justify-between gap-3 mb-1">
        <div class="text-xs text-neutral-500">Price history</div>
        <div class="text-xs text-neutral-400 text-right">{summary}</div>
      </div>
      <div class="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgW} ${svgH}`}
          class="w-full touch-none"
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setActive(null)}
        >
          {/* Y guides */}
          <line x1={padL} y1={y(yMax)} x2={padL + w} y2={y(yMax)} stroke="#262626" stroke-width="1" />
          <line x1={padL} y1={y(yMin)} x2={padL + w} y2={y(yMin)} stroke="#262626" stroke-width="1" />
          <text x={padL - 6} y={y(hi) + 3} fill="#737373" font-size="9" text-anchor="end">${hi.toFixed(0)}</text>
          {!single && (
            <text x={padL - 6} y={y(lo) + 3} fill="#737373" font-size="9" text-anchor="end">${lo.toFixed(0)}</text>
          )}

          {/* Highlighted segment */}
          {seg && (
            <rect x={seg.x1} y={padT} width={Math.max(seg.x2 - seg.x1, 1)} height={h} fill="#f97316" fill-opacity="0.08" />
          )}

          <path d={path} fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />

          {/* Change markers */}
          {segments.slice(1).map(s => (
            <circle cx={s.x1} cy={s.y} r="3" fill="#f97316" stroke="#0a0a0a" stroke-width="1.5" />
          ))}

          <text x={padL} y={svgH - 6} fill="#737373" font-size="9">{fmt(changes[0].date)}</text>
          <text x={padL + w} y={svgH - 6} fill="#737373" font-size="9" text-anchor="end">{fmt(endDate)}</text>
        </svg>

        {seg && (
          <div
            class="absolute pointer-events-none bg-surface border border-surface-border rounded-lg px-3 py-1.5 shadow-lg text-xs z-10 whitespace-nowrap"
            style={{
              left: `${(((seg.x1 + seg.x2) / 2) / svgW) * 100}%`,
              top: `${(seg.y / svgH) * 100}%`,
              transform: 'translate(-50%, -115%)',
            }}
          >
            <div class="text-white font-medium tabular-nums">${seg.price.toFixed(2)}/mo</div>
            <div class="text-neutral-400">
              {fmt(seg.date, true)} – {active === segments.length - 1 ? fmt(endDate, true) : fmt(changes[active! + 1].date, true)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
