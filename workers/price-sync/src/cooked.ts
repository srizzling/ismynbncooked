// Mirrors site/src/lib/cooked.ts — keep thresholds in sync.
export type CookedLevel = 'winning' | 'sweet-as' | 'bit-shit' | 'taking-the-piss' | 'absolute-rort';

export const LEVELS: { threshold: number; level: CookedLevel; label: string }[] = [
  { threshold: 0.30, level: 'absolute-rort', label: 'Absolute Rort' },
  { threshold: 0.15, level: 'taking-the-piss', label: 'Taking the Piss' },
  { threshold: 0.05, level: 'bit-shit', label: 'Bit Shit' },
  { threshold: 0, level: 'sweet-as', label: 'Sweet As' },
  { threshold: -Infinity, level: 'winning', label: 'Winning' },
];

export function levelFor(overpayPercent: number): { level: CookedLevel; label: string } {
  const m = LEVELS.find(l => overpayPercent >= l.threshold) ?? LEVELS[LEVELS.length - 1];
  return { level: m.level, label: m.label };
}

export interface ProviderRort {
  /** Median of (price − tier cheapest) / tier cheapest across the provider's tiers */
  medianOverpay: number;
  meanOverpay: number;
  level: CookedLevel;
  label: string;
  /** How many of the provider's tiers land at each level */
  counts: Record<CookedLevel, number>;
  tierCount: number;
}

/** Overall Rort Scale for a provider from its per-tier overpay fractions. */
export function summariseRort(overpays: number[]): ProviderRort | null {
  if (overpays.length === 0) return null;
  const sorted = [...overpays].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianOverpay = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const meanOverpay = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const counts: Record<CookedLevel, number> = { 'winning': 0, 'sweet-as': 0, 'bit-shit': 0, 'taking-the-piss': 0, 'absolute-rort': 0 };
  for (const o of overpays) counts[levelFor(o).level]++;
  const { level, label } = levelFor(medianOverpay);
  return { medianOverpay, meanOverpay, level, label, counts, tierCount: overpays.length };
}
