import { useState } from 'preact/hooks';
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
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const currentResult = calculateCooked(promoPrice, cheapest);
  const currentLevel = LEVELS.find(l => l.level === currentResult.level)!;

  const postResult = calculateCooked(fullPrice, cheapest);
  const postLevel = LEVELS.find(l => l.level === postResult.level)!;

  const nowLabel = monthLabel(0);
  const endLabel = monthLabel(promoMonthsLeft);

  const steps = [
    {
      color: currentLevel.color,
      dateLabel: nowLabel,
      title: currentResult.label,
      subtitle: 'You are here',
      detail: `Paying $${promoPrice.toFixed(2)}/mo on your promo rate.${
        currentResult.monthlySavings > 0
          ? ` That's $${currentResult.monthlySavings.toFixed(2)}/mo more than the cheapest plan.`
          : ` You're beating the cheapest plan ($${cheapest.toFixed(0)}/mo).`
      }`,
    },
    {
      color: postLevel.color,
      dateLabel: `${endLabel} (${promoMonthsLeft}mo)`,
      title: 'Promo ends',
      subtitle: `→ $${fullPrice.toFixed(0)}/mo`,
      detail: `Your price jumps to $${fullPrice.toFixed(2)}/mo.${
        postResult.monthlySavings > 0
          ? ` That's ${(postResult.overpayPercent * 100).toFixed(0)}% above the cheapest plan — time to churn.`
          : ` Still a fair price. No rush to switch.`
      }`,
    },
    {
      color: postLevel.color,
      dateLabel: 'Ongoing',
      title: postResult.label,
      subtitle: `$${fullPrice.toFixed(0)}/mo`,
      detail: postResult.monthlySavings > 0
        ? `You'll be paying $${postResult.monthlySavings.toFixed(2)}/mo more than the cheapest plan. Start looking for a new deal before ${endLabel}.`
        : `Even at full price you're on a good deal. No need to switch.`,
    },
  ];

  return (
    <div class="bg-surface-raised border border-surface-border rounded-xl p-4 sm:p-5">
      <div class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-4">Your rort timeline</div>

      {/* Horizontal timeline */}
      <ol class="flex items-start w-full">
        {steps.map((step, i) => {
          const isActive = activeStep === i;
          const isLast = i === steps.length - 1;
          const isFirst = i === 0;

          return (
            <li
              key={i}
              class={`${isLast ? 'shrink-0' : 'flex-1'} cursor-pointer`}
              onMouseEnter={() => setActiveStep(i)}
              onMouseLeave={() => setActiveStep(null)}
            >
              {/* Track + dot */}
              <div class="flex items-center">
                <div
                  class={`rounded-full flex items-center justify-center shrink-0 z-10 transition-all ${
                    isActive ? 'w-8 h-8 -m-1' : 'w-6 h-6'
                  }`}
                  style={{
                    backgroundColor: isFirst ? step.color : isLast ? step.color + '20' : 'var(--color-surface)',
                    borderWidth: '2px',
                    borderStyle: 'solid',
                    borderColor: isLast ? step.color + '60' : step.color,
                  }}
                >
                  {isFirst && (
                    <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {!isFirst && !isLast && (
                    <div class="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: step.color }} />
                  )}
                </div>
                {!isLast && (
                  <div
                    class="flex-1 h-1 transition-all"
                    style={{
                      backgroundColor: isFirst ? step.color : step.color + '60',
                    }}
                  />
                )}
              </div>

              {/* Labels — always visible */}
              <div class={`mt-2 ${isLast ? '' : 'pr-4'}`}>
                <div class="text-[10px] text-neutral-500">{step.dateLabel}</div>
                <div class={`font-bold transition-colors ${isActive ? 'text-base' : 'text-sm'}`} style={{ color: step.color }}>
                  {step.title}
                </div>
                <div class="text-xs text-neutral-400">{step.subtitle}</div>
              </div>

              {/* Detail — shown on hover */}
              {isActive && (
                <div class="relative mt-2">
                  <div
                    class="absolute left-1/2 -translate-x-1/2 text-xs text-neutral-300 bg-surface border border-surface-border rounded-lg px-3 py-2 shadow-lg w-[220px] z-20"
                  >
                    {step.detail}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
