import type { NBNPlan } from './types';

export type Horizon = 3 | 6 | 12 | 24;
export const HORIZONS: Horizon[] = [3, 6, 12, 24];

/** Calculate total cost and effective monthly for a plan over a given horizon */
export function calcCosts(plan: NBNPlan, months: Horizon) {
  const promoMonths = Math.min(plan.promoDuration ?? 0, months);
  const fullMonths = months - promoMonths;
  const promoDiscount = plan.promoValue ?? 0;
  const totalCost =
    promoMonths * (plan.monthlyPrice - promoDiscount) +
    fullMonths * plan.monthlyPrice +
    plan.setupFee;
  const effectiveCost = totalCost / months;
  return {
    totalCost: Math.round(totalCost * 100) / 100,
    effectiveCost: Math.round(effectiveCost * 100) / 100,
  };
}

/** Find the cheapest effective monthly price across all plans for a given horizon */
export function cheapestEffectiveForHorizon(plans: NBNPlan[], months: Horizon): number {
  if (plans.length === 0) return Infinity;
  return Math.min(...plans.map(p => calcCosts(p, months).effectiveCost));
}

/** Find the cheapest plan (by effective monthly) for a given horizon */
export function cheapestPlanForHorizon(plans: NBNPlan[], months: Horizon): { plan: NBNPlan; effectiveCost: number; totalCost: number } | null {
  if (plans.length === 0) return null;
  let best: { plan: NBNPlan; effectiveCost: number; totalCost: number } | null = null;
  for (const p of plans) {
    const { effectiveCost, totalCost } = calcCosts(p, months);
    if (!best || effectiveCost < best.effectiveCost) {
      best = { plan: p, effectiveCost, totalCost };
    }
  }
  return best;
}

/** Find the horizon that gives the cheapest effective monthly price.
 *  Ties broken by longest commitment (e.g. if 3mo and 6mo are equal, pick 6mo). */
export function bestHorizon(plans: NBNPlan[]): { horizon: Horizon; effectiveCost: number } {
  let best: { horizon: Horizon; effectiveCost: number } = { horizon: 12, effectiveCost: Infinity };
  for (const h of HORIZONS) {
    const cost = cheapestEffectiveForHorizon(plans, h);
    if (cost < best.effectiveCost || (cost === best.effectiveCost && h > best.horizon)) {
      best = { horizon: h, effectiveCost: cost };
    }
  }
  return best;
}
