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
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
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

      <ul class="relative space-y-0">
        {/* Step 1: Now */}
        <li class="relative pl-8 pb-6">
          {/* Vertical line */}
          <div class="absolute left-[9px] top-5 bottom-0 w-0.5" style={{ backgroundColor: currentLevel.color }} />
          {/* Dot */}
          <div class="absolute left-0 top-1 w-5 h-5 rounded-full border-2 flex items-center justify-center"
            style={{ backgroundColor: currentLevel.color, borderColor: currentLevel.color }}>
            <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          {/* Content */}
          <div>
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="font-bold" style={{ color: currentLevel.color }}>{currentResult.label}</span>
              <span class="text-xs text-neutral-500">{nowLabel}</span>
            </div>
            <p class="text-sm text-neutral-400">
              You're paying <span class="text-white font-medium">${promoPrice.toFixed(2)}/mo</span> on your promo rate.
              {currentResult.monthlySavings > 0 ? (
                <> That's <span class="text-white">${currentResult.monthlySavings.toFixed(2)}/mo</span> more than the cheapest plan.</>
              ) : (
                <> You're beating the cheapest available plan — nice.</>
              )}
            </p>
          </div>
        </li>

        {/* Step 2: Promo ends */}
        <li class="relative pl-8 pb-6">
          {/* Vertical line */}
          <div class="absolute left-[9px] top-5 bottom-0 w-0.5" style={{ backgroundColor: postLevel.color + '60' }} />
          {/* Dot */}
          <div class="absolute left-0 top-1 w-5 h-5 rounded-full border-2 flex items-center justify-center"
            style={{ backgroundColor: 'transparent', borderColor: postLevel.color }}>
            <div class="w-2 h-2 rounded-full" style={{ backgroundColor: postLevel.color }} />
          </div>
          {/* Content */}
          <div>
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="font-medium text-accent">Promo ends</span>
              <span class="text-xs text-neutral-500">{endLabel} ({promoMonthsLeft}mo from now)</span>
            </div>
            <p class="text-sm text-neutral-400">
              Your price jumps to <span class="text-white font-medium">${fullPrice.toFixed(2)}/mo</span>.
              {postResult.monthlySavings > 0 ? (
                <> That's <span style={{ color: postLevel.color }} class="font-medium">{(postResult.overpayPercent * 100).toFixed(0)}% above</span> the cheapest plan.</>
              ) : (
                <> Still a fair price — no need to churn.</>
              )}
            </p>
          </div>
        </li>

        {/* Step 3: After promo */}
        <li class="relative pl-8">
          {/* Dot */}
          <div class="absolute left-0 top-1 w-5 h-5 rounded-full border-2 flex items-center justify-center"
            style={{ backgroundColor: postLevel.color + '20', borderColor: postLevel.color + '60' }}>
          </div>
          {/* Content */}
          <div>
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="font-bold" style={{ color: postLevel.color }}>{postResult.label}</span>
              <span class="text-xs text-neutral-500">Ongoing</span>
            </div>
            {postResult.monthlySavings > 0 ? (
              <p class="text-sm text-neutral-400">
                At full price you'll be paying <span class="text-white font-medium">${postResult.monthlySavings.toFixed(2)}/mo</span> more
                than the cheapest plan (${cheapest.toFixed(0)}/mo).
                <span class="block mt-1 text-accent font-medium">
                  Start looking for a new deal before {endLabel}.
                </span>
              </p>
            ) : (
              <p class="text-sm text-neutral-400">
                Even at full price you're still on a good deal. No rush to switch.
              </p>
            )}
          </div>
        </li>
      </ul>
    </div>
  );
}
