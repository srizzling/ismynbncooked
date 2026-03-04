import type { CookedResult, CookedLevel } from './types';

const LEVELS: { threshold: number; level: CookedLevel; label: string; color: string; description: string }[] = [
  { threshold: 0.30, level: 'absolute-rort', label: 'Absolute F***ing Rort', color: '#ef4444', description: 'Mate. You\'re getting absolutely done.' },
  { threshold: 0.15, level: 'taking-the-piss', label: 'Taking the Piss', color: '#fb923c', description: 'Your provider is having a laugh.' },
  { threshold: 0.05, level: 'bit-shit', label: 'Bit Shit', color: '#facc15', description: 'Not the end of the world, but money\'s money.' },
  { threshold: 0, level: 'sweet-as', label: 'Sweet As', color: '#4ade80', description: 'You\'re on a fair deal. No worries.' },
  { threshold: -Infinity, level: 'winning', label: 'Winning', color: '#22d3ee', description: 'You\'re beating the cheapest plan we can find. Legend.' },
];

export { LEVELS };

export function calculateCooked(userPrice: number, cheapestPrice: number): CookedResult {
  const diff = userPrice - cheapestPrice;
  const monthlySavings = Math.max(0, diff);
  const yearlySavings = monthlySavings * 12;
  const overpayPercent = cheapestPrice > 0 ? diff / cheapestPrice : 0;

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
