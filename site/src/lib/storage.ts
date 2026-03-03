import type { UserPlan, UserPlans, SpeedTier, AUState } from './types';

const STORAGE_KEY = 'ismynbncooked_plans';
const STATE_KEY = 'ismynbncooked_state';

export function getUserPlans(): UserPlans {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getUserPlan(tier: SpeedTier): UserPlan | null {
  const plans = getUserPlans();
  return plans[`nbn${tier}`] ?? null;
}

export function saveUserPlan(
  tier: SpeedTier,
  price: number,
  provider: string,
  opts?: { fullPrice?: number; promoMonthsLeft?: number }
): void {
  const plans = getUserPlans();
  plans[`nbn${tier}`] = {
    price,
    provider,
    savedAt: new Date().toISOString(),
    ...(opts?.fullPrice ? { fullPrice: opts.fullPrice } : {}),
    ...(opts?.promoMonthsLeft ? { promoMonthsLeft: opts.promoMonthsLeft } : {}),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

export function clearUserPlan(tier: SpeedTier): void {
  const plans = getUserPlans();
  delete plans[`nbn${tier}`];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

export function getUserState(): AUState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw as AUState | null;
  } catch {
    return null;
  }
}

export function saveUserState(state: AUState): void {
  localStorage.setItem(STATE_KEY, state);
}

// --- Price visit tracking (for "price drops since last visit") ---

const VISIT_KEY = 'ismynbncooked_visits';

interface TierVisit {
  cheapest: number;
  visitedAt: string;
}

type TierVisits = Partial<Record<`nbn${SpeedTier}`, TierVisit>>;

export function getTierVisit(tier: SpeedTier): TierVisit | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(VISIT_KEY);
    const visits: TierVisits = raw ? JSON.parse(raw) : {};
    return visits[`nbn${tier}`] ?? null;
  } catch {
    return null;
  }
}

export function saveTierVisit(tier: SpeedTier, cheapest: number): void {
  try {
    const raw = localStorage.getItem(VISIT_KEY);
    const visits: TierVisits = raw ? JSON.parse(raw) : {};
    visits[`nbn${tier}`] = { cheapest, visitedAt: new Date().toISOString() };
    localStorage.setItem(VISIT_KEY, JSON.stringify(visits));
  } catch {}
}
