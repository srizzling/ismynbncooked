import { useState, useMemo } from 'preact/hooks';
import type { ReportTier } from '../lib/types';
import { CHART, money, signedMoney, shortDate, niceTicks } from '../lib/chart';
import { displayProviderName } from '../lib/providers';

// ─── Cheapest / average movement per tier ────────────────────────────────────

/**
 * Diverging bars: how much the tier's cheapest (or average) price moved over the
 * month. Rises to the right in red, drops to the left in cyan, biggest first.
 * Unchanged tiers are summarised in a line rather than drawn as empty rows.
 */
export function TierDeltaChart({ tiers, final }: { tiers: ReportTier[]; final: boolean }) {
  const [metric, setMetric] = useState<'cheapest' | 'average'>('cheapest');
  const [active, setActive] = useState<number | null>(null);

  const rows = useMemo(() => tiers
    .map(t => ({
      t,
      start: metric === 'cheapest' ? t.cheapestStart : t.averageStart,
      end: metric === 'cheapest' ? t.cheapestEnd : t.averageEnd,
    }))
    .map(r => ({ ...r, delta: Math.round((r.end - r.start) * 100) / 100 }))
    .filter(r => Math.abs(r.delta) >= 0.005)
    .sort((a, b) => b.delta - a.delta), [tiers, metric]);
  const unchanged = tiers.length - rows.length;

  const labelW = 100, valueW = 70, plotW = 400, rowH = 20, padT = 18, padB = 6;
  const w = labelW + plotW + valueW;
  const h = padT + Math.max(rows.length, 1) * rowH + padB;
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.delta)));
  const ticks = niceTicks(-maxAbs, maxAbs, 4);
  const lim = Math.max(Math.abs(ticks[0]), Math.abs(ticks[ticks.length - 1]), maxAbs * 1.05);
  const x = (v: number) => labelW + ((v + lim) / (2 * lim)) * plotW;
  const a = active != null ? rows[active] : null;

  return (
    <div>
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div class="text-xs text-neutral-400">
          {rows.length === 0
            ? `No tier's ${metric} price moved${final ? ' this month' : ' so far'}.`
            : `${rows.filter(r => r.delta > 0).length} tier${rows.filter(r => r.delta > 0).length === 1 ? '' : 's'} dearer, ${rows.filter(r => r.delta < 0).length} cheaper${unchanged > 0 ? `, ${unchanged} unchanged` : ''}.`}
        </div>
        <div class="flex gap-1">
          {(['cheapest', 'average'] as const).map(m => (
            <button type="button" onClick={() => setMetric(m)}
                    class={`text-xs px-3 py-1 rounded-full transition-colors ${metric === m ? 'bg-accent text-black' : 'bg-surface border border-surface-border text-neutral-400 hover:text-white'}`}>
              {m === 'cheapest' ? 'Cheapest plan' : 'Average price'}
            </button>
          ))}
        </div>
      </div>
      {rows.length > 0 && (
        <div class="relative">
          <svg viewBox={`0 0 ${w} ${h}`} class="w-full" preserveAspectRatio="xMidYMid meet" onPointerLeave={() => setActive(null)}>
            {ticks.filter(t => Math.abs(t) <= lim + 1e-9).map(t => (
              <g>
                <line x1={x(t)} y1={padT - 4} x2={x(t)} y2={h - padB} stroke={t === 0 ? CHART.textMuted : CHART.grid} stroke-width="1" />
                <text x={x(t)} y={padT - 8} fill={CHART.textMuted} font-size="9" text-anchor="middle">{t === 0 ? '0' : signedMoney(t, 0)}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cy = padT + i * rowH + rowH / 2;
              const x0 = x(0), x1 = x(r.delta);
              const left = Math.min(x0, x1), width = Math.max(Math.abs(x1 - x0), 2);
              const isActive = active === i;
              const color = r.delta > 0 ? CHART.rise : CHART.drop;
              return (
                <g onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)}>
                  <rect x={0} y={cy - rowH / 2} width={w} height={rowH} fill={CHART.accent} fill-opacity={isActive ? 0.06 : 0} />
                  <text x={labelW - 8} y={cy + 3} fill={isActive ? CHART.textPrimary : CHART.textSecondary} font-size="10" text-anchor="end">{r.t.label}</text>
                  <rect x={left} y={cy - 6} width={width} height={12} rx={3} fill={color} />
                  <text x={r.delta > 0 ? x1 + 6 : x1 - 6} y={cy + 3} fill={CHART.textSecondary} font-size="10" text-anchor={r.delta > 0 ? 'start' : 'end'}>{signedMoney(r.delta)}</text>
                </g>
              );
            })}
          </svg>
          {a && (
            <div class="absolute pointer-events-none bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg text-xs z-10 whitespace-nowrap"
                 style={{ left: `${(x(a.delta) / w) * 100}%`, top: `${((padT + active! * rowH) / h) * 100}%`, transform: 'translate(-50%, -110%)' }}>
              <div class="text-white font-medium">{a.t.label}</div>
              <div class="text-neutral-300 tabular-nums">{metric === 'cheapest' ? 'Cheapest' : 'Average'} {money(a.start)} → {money(a.end)} ({signedMoney(a.delta)})</div>
              {metric === 'cheapest' && a.t.cheapestProvider && <div class="text-neutral-400">Now cheapest: {displayProviderName(a.t.cheapestProvider)}</div>}
            </div>
          )}
        </div>
      )}
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-neutral-400">
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm" style={{ background: CHART.rise }} /> dearer (+)</span>
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm" style={{ background: CHART.drop }} /> cheaper (−)</span>
      </div>
    </div>
  );
}

// ─── Rises and drops by provider ─────────────────────────────────────────────

/** Diverging stacked bars per provider: price drops to the left, rises to the right. */
export function ProviderChangesChart({ tiers, limit = 12 }: { tiers: ReportTier[]; limit?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const rows = useMemo(() => {
    const map = new Map<string, { provider: string; rises: number; drops: number; tiers: Set<string> }>();
    for (const t of tiers) {
      for (const c of t.changes) {
        const e = map.get(c.provider) ?? { provider: c.provider, rises: 0, drops: 0, tiers: new Set<string>() };
        if (c.to > c.from) e.rises++; else if (c.to < c.from) e.drops++;
        e.tiers.add(t.label);
        map.set(c.provider, e);
      }
    }
    return [...map.values()].sort((a, b) => (b.rises + b.drops) - (a.rises + a.drops) || b.rises - a.rises).slice(0, limit);
  }, [tiers, limit]);

  if (rows.length === 0) return <p class="text-xs text-neutral-500">No provider changed a price yet.</p>;

  const labelW = 120, plotW = 360, valueW = 40, rowH = 20, padT = 18, padB = 6;
  const w = labelW + plotW + valueW;
  const h = padT + rows.length * rowH + padB;
  const maxSide = Math.max(1, ...rows.map(r => Math.max(r.rises, r.drops)));
  const x = (v: number) => labelW + plotW / 2 + (v / maxSide) * (plotW / 2 - 8);
  const a = active != null ? rows[active] : null;

  return (
    <div>
      <div class="relative">
        <svg viewBox={`0 0 ${w} ${h}`} class="w-full" preserveAspectRatio="xMidYMid meet" onPointerLeave={() => setActive(null)}>
          <line x1={x(0)} y1={padT - 4} x2={x(0)} y2={h - padB} stroke={CHART.textMuted} stroke-width="1" />
          <text x={x(-maxSide)} y={padT - 8} fill={CHART.textMuted} font-size="9" text-anchor="start">{maxSide} drop{maxSide === 1 ? '' : 's'}</text>
          <text x={x(maxSide)} y={padT - 8} fill={CHART.textMuted} font-size="9" text-anchor="end">{maxSide} rise{maxSide === 1 ? '' : 's'}</text>
          {rows.map((r, i) => {
            const cy = padT + i * rowH + rowH / 2;
            const isActive = active === i;
            return (
              <g onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)}>
                <rect x={0} y={cy - rowH / 2} width={w} height={rowH} fill={CHART.accent} fill-opacity={isActive ? 0.06 : 0} />
                <text x={labelW - 8} y={cy + 3} fill={isActive ? CHART.textPrimary : CHART.textSecondary} font-size="10" text-anchor="end">{displayProviderName(r.provider)}</text>
                {r.drops > 0 && <rect x={x(-r.drops)} y={cy - 6} width={x(0) - x(-r.drops) - 1} height={12} rx={3} fill={CHART.drop} />}
                {r.rises > 0 && <rect x={x(0) + 1} y={cy - 6} width={x(r.rises) - x(0) - 1} height={12} rx={3} fill={CHART.rise} />}
                {r.drops > 0 && <text x={x(-r.drops) - 5} y={cy + 3} fill={CHART.textSecondary} font-size="10" text-anchor="end">{r.drops}</text>}
                {r.rises > 0 && <text x={x(r.rises) + 5} y={cy + 3} fill={CHART.textSecondary} font-size="10">{r.rises}</text>}
              </g>
            );
          })}
        </svg>
        {a && (
          <div class="absolute pointer-events-none bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg text-xs z-10 whitespace-nowrap"
               style={{ left: `${(x(0) / w) * 100}%`, top: `${((padT + active! * rowH) / h) * 100}%`, transform: 'translate(-50%, -110%)' }}>
            <div class="text-white font-medium">{displayProviderName(a.provider)}</div>
            <div class="text-neutral-300">{a.rises} rise{a.rises === 1 ? '' : 's'}, {a.drops} drop{a.drops === 1 ? '' : 's'}</div>
            <div class="text-neutral-400">{[...a.tiers].slice(0, 6).join(', ')}{a.tiers.size > 6 ? '…' : ''}</div>
          </div>
        )}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-neutral-400">
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm" style={{ background: CHART.drop }} /> drops</span>
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm" style={{ background: CHART.rise }} /> rises</span>
        <span class="text-neutral-600">top {rows.length} providers by number of changes</span>
      </div>
    </div>
  );
}

// ─── When in the month changes happened ──────────────────────────────────────

/** Columns per day: how many prices changed that day. */
export function ChangesTimeline({ tiers, month }: { tiers: ReportTier[]; month: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const perDay = useMemo(() => {
    const counts = Array.from({ length: days }, () => ({ rises: 0, drops: 0, items: [] as string[] }));
    for (const t of tiers) for (const c of t.changes) {
      const d = parseInt(c.date.slice(8, 10), 10) - 1;
      if (d < 0 || d >= days) continue;
      if (c.to > c.from) counts[d].rises++; else counts[d].drops++;
      counts[d].items.push(`${displayProviderName(c.provider)} ${t.label} ${money(c.from)}→${money(c.to)}`);
    }
    return counts;
  }, [tiers, days]);

  const padL = 28, padR = 8, padT = 10, padB = 22, plotW = 560, plotH = 110;
  const w = padL + plotW + padR, h = padT + plotH + padB;
  const slot = plotW / days;
  const barW = Math.min(24, slot - 3);
  const maxN = Math.max(1, ...perDay.map(d => d.rises + d.drops));
  const ticks = niceTicks(0, maxN, 3).filter(t => t <= maxN + 1e-9);
  const yTop = Math.max(ticks[ticks.length - 1] || 0, maxN) || 1;
  const yOf = (v: number) => padT + plotH - (v / yTop) * plotH;
  const xOf = (i: number) => padL + i * slot + (slot - barW) / 2;
  const total = perDay.reduce((n, d) => n + d.rises + d.drops, 0);
  const a = active != null ? perDay[active] : null;

  return (
    <div>
      <div class="text-xs text-neutral-400 mb-2">
        {total === 0 ? 'No changes yet this month.' : `${total} change${total === 1 ? '' : 's'} on ${perDay.filter(d => d.rises + d.drops > 0).length} day${perDay.filter(d => d.rises + d.drops > 0).length === 1 ? '' : 's'}.`}
      </div>
      <div class="relative">
        <svg viewBox={`0 0 ${w} ${h}`} class="w-full" preserveAspectRatio="xMidYMid meet" onPointerLeave={() => setActive(null)}>
          {ticks.map(t => (
            <g>
              <line x1={padL} y1={yOf(t)} x2={padL + plotW} y2={yOf(t)} stroke={t === 0 ? CHART.textMuted : CHART.grid} stroke-width="1" />
              <text x={padL - 6} y={yOf(t) + 3} fill={CHART.textMuted} font-size="9" text-anchor="end">{t}</text>
            </g>
          ))}
          {perDay.map((d, i) => {
            const n = d.rises + d.drops;
            const isActive = active === i;
            return (
              <g onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)}>
                <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill={CHART.accent} fill-opacity={isActive ? 0.06 : 0} />
                {d.drops > 0 && <rect x={xOf(i)} y={yOf(d.drops)} width={barW} height={yOf(0) - yOf(d.drops)} fill={CHART.drop} />}
                {d.rises > 0 && <rect x={xOf(i)} y={yOf(n) } width={barW} height={Math.max(yOf(d.drops) - yOf(n) - (d.drops > 0 ? 2 : 0), 1)} rx={3} fill={CHART.rise} />}
                {(i === 0 || (i + 1) % 5 === 0) && <text x={padL + i * slot + slot / 2} y={h - 8} fill={CHART.textMuted} font-size="9" text-anchor="middle">{i + 1}</text>}
              </g>
            );
          })}
        </svg>
        {a && a.rises + a.drops > 0 && (
          <div class="absolute pointer-events-none bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg text-xs z-10 max-w-xs"
               style={{ left: `${((padL + active! * slot + slot / 2) / w) * 100}%`, top: `${(yOf(a.rises + a.drops) / h) * 100}%`, transform: `translate(${active! > days / 2 ? '-100%' : '0'}, -110%)` }}>
            <div class="text-white font-medium">{shortDate(`${month}-${String(active! + 1).padStart(2, '0')}`)}: {a.rises} rise{a.rises === 1 ? '' : 's'}, {a.drops} drop{a.drops === 1 ? '' : 's'}</div>
            {a.items.slice(0, 5).map(s => <div class="text-neutral-400 truncate">{s}</div>)}
            {a.items.length > 5 && <div class="text-neutral-500">+{a.items.length - 5} more</div>}
          </div>
        )}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-neutral-400">
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm" style={{ background: CHART.rise }} /> rises</span>
        <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm" style={{ background: CHART.drop }} /> drops</span>
        <span class="text-neutral-600">day of month</span>
      </div>
    </div>
  );
}
