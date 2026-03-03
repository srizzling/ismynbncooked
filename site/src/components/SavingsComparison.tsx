import type { ComparisonUnit, AUState } from '../lib/types';
import { convertSavings } from '../lib/comparisons';

interface Props {
  monthlySavings: number;
  units: Record<string, ComparisonUnit>;
  userState?: AUState | null;
  /** When user is on a promo, show breakdown by period */
  promo?: {
    promoSavings: number;     // savings/mo during promo (promoPrice - cheapest)
    fullPriceSavings: number; // savings/mo after promo (fullPrice - cheapest)
    promoMonthsLeft: number;
  };
}

function SourceTooltip({ unit }: { unit: ComparisonUnit }) {
  if (!unit.source) return null;
  // pb-3 creates an invisible hover bridge between tooltip and trigger (no gap for mouse to fall through)
  return (
    <div class="absolute bottom-full left-1/2 -translate-x-1/2 pb-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-10">
      <div class="px-3 py-2 bg-surface border border-surface-border rounded-lg text-xs text-neutral-400 whitespace-nowrap shadow-lg">
        <div class="text-white font-medium">${unit.price.toFixed(2)} each</div>
        {unit.sourceUrl ? (
          <a
            href={unit.sourceUrl}
            target="_blank"
            rel="noopener"
            class="mt-0.5 text-accent hover:underline block"
            onClick={(e) => e.stopPropagation()}
          >
            {unit.source}
          </a>
        ) : (
          <div class="mt-0.5">{unit.source}</div>
        )}
      </div>
    </div>
  );
}

function SourceTooltipInline({ unit }: { unit: ComparisonUnit }) {
  if (!unit.source) return null;
  return (
    <div class="absolute bottom-full left-0 pb-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-10">
      <div class="px-3 py-2 bg-surface border border-surface-border rounded-lg text-xs text-neutral-400 whitespace-nowrap shadow-lg">
        {unit.sourceUrl ? (
          <a
            href={unit.sourceUrl}
            target="_blank"
            rel="noopener"
            class="text-accent hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {unit.source}
          </a>
        ) : (
          <span>{unit.source}</span>
        )}
      </div>
    </div>
  );
}

function SavingsGrid({ savings, units, label }: { savings: number; units: Record<string, ComparisonUnit>; label?: string }) {
  const conversions = convertSavings(savings, units);
  const monthlyItems = conversions.filter((c) => c.unit.per === 'month');

  return (
    <div>
      {label && <div class="text-sm text-neutral-400 mb-3">{label}</div>}
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {monthlyItems.map((c) => (
          <div key={c.key} class="text-center group relative cursor-default">
            <div class="text-3xl mb-1">{c.unit.icon}</div>
            <div class="text-2xl font-display font-bold tabular-nums">
              {c.monthly.toFixed(1)}
            </div>
            <div class="text-sm text-neutral-400">{c.unit.label}/mo</div>
            <div class="text-xs text-neutral-500 mt-1">
              ({c.yearly.toFixed(0)}/yr)
            </div>
            <SourceTooltip unit={c.unit} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SavingsComparison({ monthlySavings, units, userState, promo }: Props) {
  if (monthlySavings <= 0) return null;

  // Filter units: show non-state units + only the PT unit matching user's state
  // If no state set, show NSW (Opal) as default
  const effectiveState = userState ?? 'nsw';
  const filteredUnits: Record<string, ComparisonUnit> = {};
  for (const [key, unit] of Object.entries(units)) {
    if (!unit.state) {
      filteredUnits[key] = unit;
    } else if (unit.state === effectiveState) {
      filteredUnits[key] = unit;
    }
  }

  const hasPromoBreakdown = promo && promo.promoMonthsLeft > 0 && promo.fullPriceSavings > promo.promoSavings;

  // Compute total items for house deposit calculation
  const conversions = convertSavings(monthlySavings, filteredUnits);
  const totalItems = conversions.filter((c) => c.unit.per === 'total');

  return (
    <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 sm:p-8">
      <h3 class="font-display font-bold text-xl mb-1">What you're throwing away</h3>

      {hasPromoBreakdown ? (
        <div class="space-y-6">
          <p class="text-neutral-400 text-sm">
            You're overpaying <span class="text-white font-medium">${promo.promoSavings.toFixed(2)}/mo</span> now, jumping to{' '}
            <span class="text-white font-medium">${promo.fullPriceSavings.toFixed(2)}/mo</span> in {promo.promoMonthsLeft} month{promo.promoMonthsLeft !== 1 ? 's' : ''}
          </p>

          {promo.promoSavings > 0 && (
            <SavingsGrid
              savings={promo.promoSavings}
              units={filteredUnits}
              label={`Now (${promo.promoMonthsLeft}mo left on promo) — $${promo.promoSavings.toFixed(2)}/mo wasted on...`}
            />
          )}

          <div class={promo.promoSavings > 0 ? 'pt-4 border-t border-surface-border' : ''}>
            <SavingsGrid
              savings={promo.fullPriceSavings}
              units={filteredUnits}
              label={`After promo ends — $${promo.fullPriceSavings.toFixed(2)}/mo wasted on...`}
            />
          </div>
        </div>
      ) : (
        <>
          <p class="text-neutral-400 text-sm mb-6">
            Every month, you could be spending ${monthlySavings.toFixed(2)} on...
          </p>
          <SavingsGrid savings={monthlySavings} units={filteredUnits} />
        </>
      )}

      {totalItems.length > 0 && (
        <div class="mt-6 pt-6 border-t border-surface-border">
          {totalItems.map((c) => {
            const yearlySavings = monthlySavings * 12;
            const yearsToDeposit = yearlySavings > 0 ? c.unit.price / yearlySavings : Infinity;

            if (yearsToDeposit < 1) {
              const months = Math.round(yearsToDeposit * 12);
              return (
                <div key={c.key} class="group relative inline-block cursor-default">
                  <p class="text-neutral-300 text-sm">
                    {c.unit.icon} Your overpayment could fund a{' '}
                    <span class="font-bold text-white">5% house deposit</span> in{' '}
                    <span class="font-bold text-white">{months} months</span>
                    {c.unit.note ? ` (${c.unit.note})` : ''}
                  </p>
                  <SourceTooltipInline unit={c.unit} />
                </div>
              );
            }

            return (
              <div key={c.key} class="group relative inline-block cursor-default">
                <p class="text-neutral-300 text-sm">
                  {c.unit.icon} At this rate, your NBN overpayment could cover a{' '}
                  <span class="font-bold text-white">5% house deposit</span> in{' '}
                  <span class="font-bold text-white">
                    {yearsToDeposit.toFixed(0)} years
                  </span>
                  {c.unit.note ? ` (${c.unit.note})` : ''}
                </p>
                <SourceTooltipInline unit={c.unit} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
