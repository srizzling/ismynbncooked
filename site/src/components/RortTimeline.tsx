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

function formatICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function downloadIcal(promoMonthsLeft: number, fullPrice: number) {
  const reminderDate = new Date();
  reminderDate.setMonth(reminderDate.getMonth() + promoMonthsLeft - 1);
  reminderDate.setHours(9, 0, 0, 0);

  const endDate = new Date(reminderDate);
  endDate.setHours(10, 0, 0, 0);

  const promoEndDate = new Date();
  promoEndDate.setMonth(promoEndDate.getMonth() + promoMonthsLeft);

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//amigettingrorted.au//Churn Reminder//EN',
    'BEGIN:VEVENT',
    `DTSTART:${formatICalDate(reminderDate)}`,
    `DTEND:${formatICalDate(endDate)}`,
    `SUMMARY:NBN Promo ending soon — time to churn?`,
    `DESCRIPTION:Your NBN promo ends next month (${promoEndDate.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}).\\nYour price will jump to $${fullPrice.toFixed(2)}/mo.\\n\\nCompare plans at https://amigettingrorted.au`,
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:NBN promo ending soon',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nbn-churn-reminder.ics';
  a.click();
  URL.revokeObjectURL(url);
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

      {/* Calendar reminder */}
      {postResult.monthlySavings > 0 && promoMonthsLeft > 1 && (
        <div class="mt-4 pt-3 border-t border-surface-border flex items-center justify-between">
          <span class="text-xs text-neutral-500">
            Cheapest plan: ${cheapest.toFixed(0)}/mo
          </span>
          <button
            onClick={() => downloadIcal(promoMonthsLeft, fullPrice)}
            class="text-xs px-3 py-1.5 rounded-lg border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors flex items-center gap-1.5"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Remind me to churn
          </button>
        </div>
      )}
    </div>
  );
}
