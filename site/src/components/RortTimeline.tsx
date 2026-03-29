import { useMemo } from 'preact/hooks';
import { LEVELS } from '../lib/cooked';

interface Props {
  promoPrice: number;
  fullPrice: number;
  promoMonthsLeft: number;
  cheapest: number;
  totalMonths?: number;
}

export default function RortTimeline({ promoPrice, fullPrice, promoMonthsLeft, cheapest, totalMonths = 12 }: Props) {
  const months = useMemo(() => {
    const result: { month: number; price: number; overpay: number; level: string; color: string; label: string }[] = [];
    for (let m = 1; m <= totalMonths; m++) {
      const price = m <= promoMonthsLeft ? promoPrice : fullPrice;
      const overpay = cheapest > 0 ? (price - cheapest) / cheapest : 0;
      const match = LEVELS.find(l => overpay >= l.threshold) ?? LEVELS[LEVELS.length - 1];
      result.push({
        month: m,
        price,
        overpay,
        level: match.level,
        color: match.color,
        label: match.label,
      });
    }
    return result;
  }, [promoPrice, fullPrice, promoMonthsLeft, cheapest, totalMonths]);

  const maxPrice = Math.max(promoPrice, fullPrice, cheapest) * 1.1;
  const minPrice = Math.min(promoPrice, fullPrice, cheapest) * 0.9;
  const priceRange = maxPrice - minPrice;

  const barHeight = 120;
  const barWidth = Math.floor(100 / totalMonths);

  return (
    <div class="bg-surface-raised border border-surface-border rounded-xl p-4 sm:p-5">
      <div class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3">Your rort timeline</div>

      {/* Timeline bars */}
      <div class="flex items-end gap-px" style={{ height: `${barHeight}px` }}>
        {months.map(m => {
          const height = priceRange > 0 ? ((m.price - minPrice) / priceRange) * 100 : 50;
          return (
            <div
              key={m.month}
              class="relative group flex-1 rounded-t-sm transition-opacity hover:opacity-80"
              style={{
                height: `${Math.max(height, 5)}%`,
                backgroundColor: m.color + '40',
                borderTop: `2px solid ${m.color}`,
              }}
            >
              {/* Tooltip */}
              <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10
                bg-surface border border-surface-border rounded-lg px-2.5 py-1.5 shadow-lg text-xs whitespace-nowrap">
                <div class="text-white font-medium">Month {m.month}: ${m.price.toFixed(0)}/mo</div>
                <div style={{ color: m.color }}>{m.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Month labels */}
      <div class="flex gap-px mt-1">
        {months.map(m => (
          <div key={m.month} class="flex-1 text-center text-[9px] text-neutral-600 tabular-nums">
            {m.month}
          </div>
        ))}
      </div>

      {/* Cheapest line label */}
      <div class="flex items-center gap-2 mt-3">
        <div class="h-px flex-1 border-t border-dashed border-neutral-600" />
        <span class="text-[10px] text-neutral-500">cheapest: ${cheapest.toFixed(0)}/mo</span>
        <div class="h-px flex-1 border-t border-dashed border-neutral-600" />
      </div>

      {/* Summary */}
      <div class="flex flex-wrap gap-3 mt-3 text-xs">
        {promoMonthsLeft > 0 && (
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full" style={{ backgroundColor: months[0].color }} />
            <span class="text-neutral-400">
              Months 1–{promoMonthsLeft}: <span class="text-white">${promoPrice.toFixed(0)}/mo</span>
              {' '}— <span style={{ color: months[0].color }}>{months[0].label}</span>
            </span>
          </div>
        )}
        {promoMonthsLeft < totalMonths && (
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full" style={{ backgroundColor: months[months.length - 1].color }} />
            <span class="text-neutral-400">
              Months {promoMonthsLeft + 1}–{totalMonths}: <span class="text-white">${fullPrice.toFixed(0)}/mo</span>
              {' '}— <span style={{ color: months[months.length - 1].color }}>{months[months.length - 1].label}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
