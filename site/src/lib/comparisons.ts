import type { ComparisonUnit } from './types';

export interface SavingsConversion {
  key: string;
  unit: ComparisonUnit;
  monthly: number;
  yearly: number;
  display: string;
}

export function convertSavings(
  monthlySavings: number,
  units: Record<string, ComparisonUnit>
): SavingsConversion[] {
  return Object.entries(units).map(([key, unit]) => {
    if (unit.per === 'total') {
      // For "total" units like house deposit, show how many days/years delayed
      const yearlySavings = monthlySavings * 12;
      const yearsDelayed = yearlySavings > 0 ? unit.price / yearlySavings : 0;
      return {
        key,
        unit,
        monthly: 0,
        yearly: yearsDelayed,
        display: `${Math.round(yearsDelayed).toLocaleString()} years`,
      };
    }

    const monthly = monthlySavings / unit.price;
    const yearly = (monthlySavings * 12) / unit.price;
    return {
      key,
      unit,
      monthly,
      yearly,
      display: `${monthly.toFixed(1)}/mo`,
    };
  });
}
