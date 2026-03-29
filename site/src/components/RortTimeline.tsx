import { LEVELS } from '../lib/cooked';
import { calculateCooked } from '../lib/cooked';

interface Props {
  promoPrice: number;
  fullPrice: number;
  promoMonthsLeft: number;
  cheapest: number;
  totalMonths?: number;
}

export default function RortTimeline({ promoPrice, fullPrice, promoMonthsLeft, cheapest, totalMonths = 12 }: Props) {
  const currentResult = calculateCooked(promoPrice, cheapest);
  const currentLevel = LEVELS.find(l => l.level === currentResult.level)!;

  const postResult = calculateCooked(fullPrice, cheapest);
  const postLevel = LEVELS.find(l => l.level === postResult.level)!;

  const promoPercent = Math.round((promoMonthsLeft / totalMonths) * 100);
  const postPercent = 100 - promoPercent;

  return (
    <div class="bg-surface-raised border border-surface-border rounded-xl p-4 sm:p-5">
      <div class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-4">Your rort timeline</div>

      {/* Timeline track */}
      <div class="relative">
        <div class="flex rounded-full overflow-hidden h-3">
          {/* Promo segment */}
          <div
            class="relative"
            style={{ width: `${promoPercent}%`, backgroundColor: currentLevel.color + '40', borderRight: '2px solid ' + currentLevel.color }}
            title={`${promoMonthsLeft} months at $${promoPrice.toFixed(0)}/mo`}
          />
          {/* Post-promo segment */}
          <div
            class="relative"
            style={{ width: `${postPercent}%`, backgroundColor: postLevel.color + '40' }}
            title={`${totalMonths - promoMonthsLeft} months at $${fullPrice.toFixed(0)}/mo`}
          />
        </div>

        {/* "You are here" marker at the start */}
        <div class="absolute left-0 -top-1" style={{ transform: 'translateX(-50%)' }}>
          <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center text-[8px]"
            style={{ backgroundColor: currentLevel.color, borderColor: currentLevel.color }}>
          </div>
        </div>

        {/* Promo end marker */}
        <div class="absolute -top-1" style={{ left: `${promoPercent}%`, transform: 'translateX(-50%)' }}>
          <div class="w-5 h-5 rounded-full border-2 bg-surface flex items-center justify-center"
            style={{ borderColor: postLevel.color }}>
          </div>
        </div>

        {/* End marker */}
        <div class="absolute right-0 -top-1" style={{ transform: 'translateX(50%)' }}>
          <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center"
            style={{ backgroundColor: postLevel.color + '40', borderColor: postLevel.color }}>
          </div>
        </div>
      </div>

      {/* Labels */}
      <div class="flex justify-between mt-3">
        {/* Current */}
        <div class="text-left">
          <div class="text-xs text-neutral-500">Now</div>
          <div class="text-sm font-bold" style={{ color: currentLevel.color }}>
            {currentResult.label}
          </div>
          <div class="text-xs text-neutral-400">${promoPrice.toFixed(0)}/mo</div>
          <div class="text-[10px] text-neutral-600">You are here</div>
        </div>

        {/* Promo end */}
        <div class="text-center">
          <div class="text-xs text-neutral-500">Month {promoMonthsLeft}</div>
          <div class="text-xs text-accent font-medium">Promo ends</div>
          <div class="text-xs text-neutral-400">↓ ${fullPrice.toFixed(0)}/mo</div>
        </div>

        {/* End */}
        <div class="text-right">
          <div class="text-xs text-neutral-500">Month {totalMonths}</div>
          <div class="text-sm font-bold" style={{ color: postLevel.color }}>
            {postResult.label}
          </div>
          <div class="text-xs text-neutral-400">${fullPrice.toFixed(0)}/mo</div>
          {postResult.monthlySavings > 0 && (
            <div class="text-[10px] text-neutral-600">
              ${postResult.monthlySavings.toFixed(0)}/mo over cheapest
            </div>
          )}
        </div>
      </div>

      {/* Cheapest reference */}
      <div class="mt-3 pt-3 border-t border-surface-border flex items-center justify-between text-xs text-neutral-500">
        <span>Cheapest plan: ${cheapest.toFixed(0)}/mo</span>
        {postResult.monthlySavings > 0 && (
          <span>Set a reminder to churn in <span class="text-accent font-medium">{promoMonthsLeft} months</span></span>
        )}
      </div>
    </div>
  );
}
