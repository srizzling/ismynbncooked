/** Shared chart tokens. Marks carry colour; text always uses the text tokens. */
export const CHART = {
  surface: '#141414',
  grid: '#262626',
  context: '#3f3f46',     // de-emphasised series
  range: '#333333',       // range bars
  accent: '#f97316',      // the emphasised series
  rise: '#ef4444',        // diverging pole: dearer
  drop: '#22d3ee',        // diverging pole: cheaper
  textMuted: '#737373',
  textSecondary: '#a3a3a3',
  textPrimary: '#ffffff',
};

export const money = (n: number, dp = 2) => `$${n.toFixed(dp)}`;
export const signedMoney = (n: number, dp = 2) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toFixed(dp)}`;
export const pct = (f: number, dp = 0) => `${f > 0 ? '+' : ''}${(f * 100).toFixed(dp)}%`;
export const shortDate = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
export const longDate = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

/** Round a value range out to clean tick steps. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rough) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}
