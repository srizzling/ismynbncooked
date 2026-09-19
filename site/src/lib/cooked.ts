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

export interface ProviderRort {
  /** Median of (price − tier cheapest) / tier cheapest across the provider's tiers */
  medianOverpay: number;
  meanOverpay: number;
  level: CookedLevel;
  label: string;
  color: string;
  description: string;
  /** How many of the provider's tiers land at each level */
  counts: Record<CookedLevel, number>;
  tierCount: number;
}

export function levelFor(overpayPercent: number) {
  return LEVELS.find(l => overpayPercent >= l.threshold) ?? LEVELS[LEVELS.length - 1];
}

export const LEVEL_ORDER: CookedLevel[] = ['winning', 'sweet-as', 'bit-shit', 'taking-the-piss', 'absolute-rort'];

/** Overall Rort Scale for a provider from its per-tier overpay fractions (mirrored in the worker). */
export function summariseRort(overpays: number[]): ProviderRort | null {
  if (overpays.length === 0) return null;
  const sorted = [...overpays].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianOverpay = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const meanOverpay = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const counts: Record<CookedLevel, number> = { 'winning': 0, 'sweet-as': 0, 'bit-shit': 0, 'taking-the-piss': 0, 'absolute-rort': 0 };
  for (const o of overpays) counts[levelFor(o).level]++;
  const m = levelFor(medianOverpay);
  return { medianOverpay, meanOverpay, level: m.level, label: m.label, color: m.color, description: m.description, counts, tierCount: overpays.length };
}
