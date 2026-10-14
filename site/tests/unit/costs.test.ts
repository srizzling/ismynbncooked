import { describe, expect, it } from 'vitest';
import { bestHorizon, calcCosts, cheapestEffectiveForHorizon, cheapestPlanForHorizon } from '../../src/lib/costs';
import type { NBNPlan } from '../../src/lib/types';

function plan(over: Partial<NBNPlan> = {}): NBNPlan {
  return {
    id: 'p', providerName: 'Test', planName: 'Test 100', monthlyPrice: 60, yearlyCost: 0, effectiveMonthly: 0,
    setupFee: 0, promoValue: null, promoDuration: null, typicalEveningSpeed: null, contractLength: 0, cisUrl: '',
    minimumTerm: null, cancellationFees: null, noticePeriod: null, downloadSpeed: 100, uploadSpeed: 20, networkType: 'nbn',
    ...over,
  };
}

describe('calcCosts', () => {
  it('charges the full price when there is no promo', () => {
    expect(calcCosts(plan(), 12)).toEqual({ totalCost: 720, effectiveCost: 60 });
  });

  it('applies the promo discount for the promo months only', () => {
    const p = plan({ promoValue: 10, promoDuration: 6 });
    expect(calcCosts(p, 12)).toEqual({ totalCost: 660, effectiveCost: 55 });
    expect(calcCosts(p, 24).totalCost).toBe(1380);
  });

  it('caps promo months at the horizon', () => {
    const p = plan({ promoValue: 10, promoDuration: 6 });
    expect(calcCosts(p, 3)).toEqual({ totalCost: 150, effectiveCost: 50 });
  });

  it('spreads the setup fee across the horizon', () => {
    const p = plan({ setupFee: 99 });
    expect(calcCosts(p, 3)).toEqual({ totalCost: 279, effectiveCost: 93 });
    expect(calcCosts(p, 24).effectiveCost).toBe(64.13);
  });

  it('rounds to cents', () => {
    expect(calcCosts(plan({ monthlyPrice: 59.99, setupFee: 1 }), 6).effectiveCost).toBe(60.16);
  });
});

describe('cheapest helpers', () => {
  const promo = plan({ id: 'promo', monthlyPrice: 80, promoValue: 30, promoDuration: 6 });
  const flat = plan({ id: 'flat', monthlyPrice: 60 });

  it('prefers the promo plan on a short horizon and the flat plan on a long one', () => {
    expect(cheapestPlanForHorizon([promo, flat], 3)!.plan.id).toBe('promo');
    expect(cheapestPlanForHorizon([promo, flat], 24)!.plan.id).toBe('flat');
  });

  it('handles an empty list', () => {
    expect(cheapestPlanForHorizon([], 12)).toBeNull();
    expect(cheapestEffectiveForHorizon([], 12)).toBe(Infinity);
  });

  it('reports the cheapest effective price for a horizon', () => {
    expect(cheapestEffectiveForHorizon([promo, flat], 3)).toBe(50);
  });
});

describe('bestHorizon', () => {
  it('breaks ties towards the longest commitment', () => {
    // 50/mo for the first 6 months, so 3 and 6 months tie at 50
    const p = plan({ monthlyPrice: 60, promoValue: 10, promoDuration: 6 });
    expect(bestHorizon([p])).toEqual({ horizon: 6, effectiveCost: 50 });
  });

  it('picks the longest horizon when the price never changes', () => {
    expect(bestHorizon([plan()]).horizon).toBe(24);
  });
});
