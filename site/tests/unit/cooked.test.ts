import { describe, expect, it } from 'vitest';
import { calculateCooked, levelFor, summariseRort, LEVELS, LEVEL_ORDER } from '../../src/lib/cooked';

describe('calculateCooked', () => {
  it.each([
    [100, 100, 'sweet-as'],
    [104, 100, 'sweet-as'],
    [105, 100, 'bit-shit'],
    [115, 100, 'taking-the-piss'],
    [130, 100, 'absolute-rort'],
    [99, 100, 'winning'],
    [80, 100, 'winning'],
  ])('paying $%i against a $%i cheapest is %s', (paying, cheapest, level) => {
    expect(calculateCooked(paying, cheapest).level).toBe(level);
  });

  it('works out monthly and yearly savings', () => {
    const r = calculateCooked(150, 100);
    expect(r.monthlySavings).toBe(50);
    expect(r.yearlySavings).toBe(600);
    expect(r.overpayPercent).toBe(0.5);
  });

  it('never reports negative savings when you beat the cheapest plan', () => {
    const r = calculateCooked(80, 100);
    expect(r.monthlySavings).toBe(0);
    expect(r.yearlySavings).toBe(0);
    expect(r.overpayPercent).toBeCloseTo(-0.2);
  });

  it('does not divide by zero when the cheapest price is zero', () => {
    expect(calculateCooked(50, 0).overpayPercent).toBe(0);
  });

  it('returns the colour for the matched level', () => {
    const r = calculateCooked(200, 100);
    expect(r.color).toBe(LEVELS.find((l) => l.level === r.level)!.color);
  });
});

describe('LEVELS', () => {
  it('is sorted from the harshest threshold down to the most generous', () => {
    const thresholds = LEVELS.map((l) => l.threshold);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => b - a));
  });

  it('covers every level in LEVEL_ORDER', () => {
    expect(LEVELS.map((l) => l.level).sort()).toEqual([...LEVEL_ORDER].sort());
  });
});

describe('levelFor', () => {
  it('treats the threshold itself as the upper level', () => {
    expect(levelFor(0.3).level).toBe('absolute-rort');
    expect(levelFor(0.15).level).toBe('taking-the-piss');
    expect(levelFor(0.05).level).toBe('bit-shit');
    expect(levelFor(0).level).toBe('sweet-as');
  });
});

describe('summariseRort', () => {
  it('returns null when there is nothing to summarise', () => {
    expect(summariseRort([])).toBeNull();
  });

  it('uses the median, not the mean, for the overall level', () => {
    // One huge outlier drags the mean to "rort" but the median stays "sweet as"
    const r = summariseRort([0, 0.01, 0.02, 2])!;
    expect(r.level).toBe('sweet-as');
    expect(r.meanOverpay).toBeGreaterThan(0.3);
  });

  it('averages the two middle values for an even count', () => {
    expect(summariseRort([0.1, 0.2])!.medianOverpay).toBeCloseTo(0.15);
  });

  it('counts how many tiers land at each level', () => {
    const r = summariseRort([-0.1, 0, 0.06, 0.2, 0.4, 0.5])!;
    expect(r.counts).toEqual({ winning: 1, 'sweet-as': 1, 'bit-shit': 1, 'taking-the-piss': 1, 'absolute-rort': 2 });
    expect(r.tierCount).toBe(6);
  });

  it('does not mutate its input', () => {
    const input = [0.3, 0.1, 0.2];
    summariseRort(input);
    expect(input).toEqual([0.3, 0.1, 0.2]);
  });
});
