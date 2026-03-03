import type { CookedResult, CookedLevel } from './types';

const LEVELS: { threshold: number; level: CookedLevel; label: string; color: string }[] = [
  { threshold: 0.30, level: 'absolutely-cooked', label: 'Absolutely Cooked', color: '#ef4444' },
  { threshold: 0.15, level: 'cooked', label: 'Cooked', color: '#fb923c' },
  { threshold: 0.05, level: 'slightly-cooked', label: 'Slightly Cooked', color: '#facc15' },
  { threshold: 0, level: 'not-cooked', label: 'Not Cooked', color: '#4ade80' },
];

export function calculateCooked(userPrice: number, cheapestPrice: number): CookedResult {
  const monthlySavings = Math.max(0, userPrice - cheapestPrice);
  const yearlySavings = monthlySavings * 12;
  const overpayPercent = cheapestPrice > 0 ? monthlySavings / cheapestPrice : 0;

  const match = LEVELS.find((l) => overpayPercent >= l.threshold) ?? LEVELS[LEVELS.length - 1];

  return {
    level: match.level,
    label: match.label,
    overpayPercent,
    monthlySavings,
    yearlySavings,
    color: match.color,
  };
}
