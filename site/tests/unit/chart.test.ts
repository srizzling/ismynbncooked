import { describe, expect, it } from 'vitest';
import { money, niceTicks, pct, signedMoney } from '../../src/lib/chart';

describe('formatters', () => {
  it('formats money', () => {
    expect(money(5)).toBe('$5.00');
    expect(money(59.9)).toBe('$59.90');
    expect(money(59.9, 0)).toBe('$60');
  });

  it('signs money with a real minus sign', () => {
    expect(signedMoney(2)).toBe('+$2.00');
    expect(signedMoney(-3.5)).toBe('−$3.50');
    expect(signedMoney(0)).toBe('$0.00');
  });

  it('formats percentages from fractions', () => {
    expect(pct(0.1234)).toBe('+12%');
    expect(pct(-0.05, 1)).toBe('-5.0%');
    expect(pct(0)).toBe('0%');
  });
});

describe('niceTicks', () => {
  it('rounds out to clean steps', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
  });

  it('starts at or below the minimum and ends within half a step of the maximum', () => {
    // The last tick may stop short of max by up to half a step. Callers filter ticks to their range.
    for (const [min, max] of [[39.9, 99], [0.5, 1.7], [1000, 1400], [-20, 40]]) {
      const ticks = niceTicks(min, max);
      const step = ticks[1] - ticks[0];
      expect(ticks[0]).toBeLessThanOrEqual(min);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max - step / 2);
    }
  });

  it('spaces ticks evenly', () => {
    const ticks = niceTicks(39.9, 99);
    const steps = ticks.slice(1).map((t, i) => Math.round((t - ticks[i]) * 1000) / 1000);
    expect(new Set(steps).size).toBe(1);
  });

  it('returns ascending ticks', () => {
    const ticks = niceTicks(39.9, 99);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it('copes with a flat range', () => {
    expect(niceTicks(5, 5)).toContain(5);
  });
});
