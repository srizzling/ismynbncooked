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

      {/* Horizontal timeline */}
      <ol class="flex items-start w-full">
        {/* Step 1: Now */}
        <li class="flex-1">
          <div class="flex items-center">
            <div class="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 z-10"
              style={{ backgroundColor: currentLevel.color, borderColor: currentLevel.color }}>
              <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div class="flex-1 h-1" style={{ backgroundColor: currentLevel.color }} />
          </div>
          <div class="mt-2 pr-4">
            <div class="text-[10px] text-neutral-500">{nowLabel}</div>
            <div class="text-sm font-bold" style={{ color: currentLevel.color }}>{currentResult.label}</div>
            <div class="text-xs text-neutral-400">${promoPrice.toFixed(0)}/mo</div>
            <div class="text-[10px] text-neutral-600 mt-0.5">You are here</div>
          </div>
        </li>

        {/* Step 2: Promo ends */}
        <li class="flex-1">
          <div class="flex items-center">
            <div class="w-6 h-6 rounded-full border-2 bg-surface flex items-center justify-center shrink-0 z-10"
              style={{ borderColor: postLevel.color }}>
              <div class="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: postLevel.color }} />
            </div>
            <div class="flex-1 h-1" style={{ backgroundColor: postLevel.color + '60' }} />
          </div>
          <div class="mt-2 pr-4">
            <div class="text-[10px] text-neutral-500">{endLabel} ({promoMonthsLeft}mo)</div>
            <div class="text-sm font-medium text-accent">Promo ends</div>
            <div class="text-xs text-neutral-400">→ ${fullPrice.toFixed(0)}/mo</div>
          </div>
        </li>

        {/* Step 3: Ongoing */}
        <li class="shrink-0">
          <div class="flex items-center">
            <div class="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 z-10"
              style={{ backgroundColor: postLevel.color + '20', borderColor: postLevel.color + '60' }}>
            </div>
          </div>
          <div class="mt-2">
            <div class="text-[10px] text-neutral-500">Ongoing</div>
            <div class="text-sm font-bold" style={{ color: postLevel.color }}>{postResult.label}</div>
            <div class="text-xs text-neutral-400">${fullPrice.toFixed(0)}/mo</div>
            {postResult.monthlySavings > 0 && (
              <div class="text-[10px] text-accent mt-0.5">Churn before {endLabel}</div>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}
