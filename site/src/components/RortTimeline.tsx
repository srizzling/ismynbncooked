import { LEVELS } from '../lib/cooked';
import { calculateCooked } from '../lib/cooked';

interface Props {
  promoPrice: number;
  fullPrice: number;
  promoMonthsLeft: number;
  cheapest: number;
}

function monthLabel(monthsFromNow: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsFromNow);
  return d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
}

export default function RortTimeline({ promoPrice, fullPrice, promoMonthsLeft, cheapest }: Props) {
  const currentResult = calculateCooked(promoPrice, cheapest);
  const currentLevel = LEVELS.find(l => l.level === currentResult.level)!;

  const postResult = calculateCooked(fullPrice, cheapest);
  const postLevel = LEVELS.find(l => l.level === postResult.level)!;

  const nowLabel = monthLabel(0);
  const endLabel = monthLabel(promoMonthsLeft);

  return (
    <div class="bg-surface-raised border border-surface-border rounded-xl p-4 sm:p-5">
      <div class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-4">Your rort timeline</div>

      {/* Timeline */}
      <div class="relative flex items-center">
        {/* Now marker */}
        <div class="flex flex-col items-center z-10">
          <div class="w-4 h-4 rounded-full border-2" style={{ backgroundColor: currentLevel.color, borderColor: currentLevel.color }} />
        </div>

        {/* Track — promo period */}
        <div class="flex-1 h-1.5 rounded-full" style={{ backgroundColor: currentLevel.color + '60' }} />

        {/* Promo end marker */}
        <div class="flex flex-col items-center z-10">
          <div class="w-4 h-4 rounded-full border-2 bg-surface" style={{ borderColor: postLevel.color }} />
        </div>

        {/* Track — post promo */}
        <div class="w-16 h-1.5 rounded-full" style={{ backgroundColor: postLevel.color + '40' }} />

        {/* Fade out */}
        <div class="w-8 h-1.5 rounded-r-full" style={{ background: `linear-gradient(to right, ${postLevel.color}40, transparent)` }} />
      </div>

      {/* Labels below */}
      <div class="relative flex items-start mt-2">
        {/* Now */}
        <div class="text-left">
          <div class="text-[10px] text-neutral-600">You are here</div>
          <div class="text-xs font-bold" style={{ color: currentLevel.color }}>{currentResult.label}</div>
          <div class="text-xs text-neutral-400">${promoPrice.toFixed(0)}/mo</div>
          <div class="text-[10px] text-neutral-500">{nowLabel}</div>
        </div>

        <div class="flex-1" />

        {/* Promo end */}
        <div class="text-center">
          <div class="text-[10px] text-accent">Promo ends</div>
          <div class="text-xs font-bold" style={{ color: postLevel.color }}>{postResult.label}</div>
          <div class="text-xs text-neutral-400">${fullPrice.toFixed(0)}/mo</div>
          <div class="text-[10px] text-neutral-500">{endLabel} ({promoMonthsLeft}mo)</div>
        </div>

        {/* Spacer for the fade */}
        <div class="w-24" />
      </div>

      {/* Footer */}
      <div class="mt-3 pt-3 border-t border-surface-border flex items-center justify-between text-xs text-neutral-500">
        <span>Cheapest: ${cheapest.toFixed(0)}/mo</span>
        {postResult.monthlySavings > 0 && (
          <span>Churn before <span class="text-accent font-medium">{endLabel}</span></span>
        )}
      </div>
    </div>
  );
}
