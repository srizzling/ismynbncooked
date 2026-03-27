import type { UserPlan, UserPlans, AUState } from './types';
import { DEFAULT_UPLOAD_MAP } from './types';

const STORAGE_KEY = 'ismynbncooked_plans';
const STATE_KEY = 'ismynbncooked_state';

/** Migrate old "nbn100" keys to new "nbn-100-20" format */
function migrateKeys(plans: Record<string, UserPlan>): Record<string, UserPlan> {
  const migrated: Record<string, UserPlan> = {};
  let needsMigration = false;

  for (const [key, plan] of Object.entries(plans)) {
    // Old format: "nbn100", "nbn1000" etc.
    const oldMatch = key.match(/^nbn(\d+)$/);
    if (oldMatch) {
      const speed = parseInt(oldMatch[1], 10);
      const newKey = DEFAULT_UPLOAD_MAP[speed] ?? `nbn-${speed}-20`;
      migrated[newKey] = plan;
      needsMigration = true;
    } else {
      migrated[key] = plan;
    }
  }

  if (needsMigration) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  }

  return needsMigration ? migrated : plans;
}

export function getUserPlans(): UserPlans {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const plans = raw ? JSON.parse(raw) : {};
    return migrateKeys(plans);
  } catch {
    return {};
  }
}

export function getUserPlan(tierKey: string): UserPlan | null {
  const plans = getUserPlans();
  return plans[tierKey] ?? null;
}

export function saveUserPlan(
  tierKey: string,
  price: number,
  provider: string,
  opts?: { fullPrice?: number; promoMonthsLeft?: number }
): void {
  const plans = getUserPlans();
  plans[tierKey] = {
    price,
    provider,
    savedAt: new Date().toISOString(),
    ...(opts?.fullPrice ? { fullPrice: opts.fullPrice } : {}),
    ...(opts?.promoMonthsLeft ? { promoMonthsLeft: opts.promoMonthsLeft } : {}),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

export function clearUserPlan(tierKey: string): void {
  const plans = getUserPlans();
  delete plans[tierKey];
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

// --- Horizon preference ---

const HORIZON_KEY = 'ismynbncooked_horizon';

export type HorizonPreference = 3 | 6 | 12 | 24 | 'cheapest';

export function getDefaultHorizon(): HorizonPreference {
  if (typeof window === 'undefined') return 6;
  try {
    const raw = localStorage.getItem(HORIZON_KEY);
    if (!raw) return 'cheapest';
    if (raw === 'cheapest') return 'cheapest';
    const num = parseInt(raw, 10);
    if ([3, 6, 12, 24].includes(num)) return num as 3 | 6 | 12 | 24;
    return 'cheapest';
  } catch {
    return 'cheapest';
  }
}

export function saveDefaultHorizon(pref: HorizonPreference): void {
  localStorage.setItem(HORIZON_KEY, String(pref));
}

// --- Tier grouping preference ---

const GROUPING_KEY = 'ismynbncooked_group_tiers';

export function getGroupTiers(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(GROUPING_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export function saveGroupTiers(grouped: boolean): void {
  localStorage.setItem(GROUPING_KEY, String(grouped));
}

// --- Price visit tracking (for "price drops since last visit") ---

const VISIT_KEY = 'ismynbncooked_visits';

interface TierVisit {
  cheapest: number;
  visitedAt: string;
}

type TierVisits = Record<string, TierVisit>;

/** Migrate old visit keys too */
function migrateVisitKeys(visits: Record<string, TierVisit>): Record<string, TierVisit> {
  const migrated: Record<string, TierVisit> = {};
  let needsMigration = false;

  for (const [key, visit] of Object.entries(visits)) {
    const oldMatch = key.match(/^nbn(\d+)$/);
    if (oldMatch) {
      const speed = parseInt(oldMatch[1], 10);
      const newKey = DEFAULT_UPLOAD_MAP[speed] ?? `nbn-${speed}-20`;
      migrated[newKey] = visit;
      needsMigration = true;
    } else {
      migrated[key] = visit;
    }
  }

  if (needsMigration) {
    localStorage.setItem(VISIT_KEY, JSON.stringify(migrated));
  }

  return needsMigration ? migrated : visits;
}

export function getTierVisit(tierKey: string): TierVisit | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(VISIT_KEY);
    const visits: TierVisits = raw ? JSON.parse(raw) : {};
    const migrated = migrateVisitKeys(visits);
    return migrated[tierKey] ?? null;
  } catch {
    return null;
  }
}

export function saveTierVisit(tierKey: string, cheapest: number): void {
  try {
    const raw = localStorage.getItem(VISIT_KEY);
    const visits: TierVisits = raw ? JSON.parse(raw) : {};
    visits[tierKey] = { cheapest, visitedAt: new Date().toISOString() };
    localStorage.setItem(VISIT_KEY, JSON.stringify(visits));
  } catch {}
}
