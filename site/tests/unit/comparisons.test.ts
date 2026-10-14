import { describe, expect, it } from 'vitest';
import { convertSavings } from '../../src/lib/comparisons';
import type { ComparisonUnit } from '../../src/lib/types';

const coffee: ComparisonUnit = { label: 'Coffee', icon: '☕', price: 5, per: 'month' };
const deposit: ComparisonUnit = { label: 'House deposit', icon: '🏠', price: 120000, per: 'total' };

describe('convertSavings', () => {
  it('converts monthly savings into units per month and per year', () => {
    const [c] = convertSavings(20, { coffee });
    expect(c.key).toBe('coffee');
    expect(c.monthly).toBe(4);
    expect(c.yearly).toBe(48);
    expect(c.display).toBe('4.0/mo');
  });

  it('expresses "total" units as years of savings needed', () => {
    const [d] = convertSavings(100, { deposit });
    expect(d.yearly).toBe(100);
    expect(d.display).toBe('100 years');
  });

  it('shows zero years rather than Infinity when nothing is being saved', () => {
    const [d] = convertSavings(0, { deposit });
    expect(d.yearly).toBe(0);
    expect(d.display).toBe('0 years');
  });

  it('keeps the order of the units', () => {
    expect(convertSavings(10, { deposit, coffee }).map((c) => c.key)).toEqual(['deposit', 'coffee']);
  });
});
