import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', storage);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
});

// The module reads the globals at call time, so a single import is fine.
const mod = () => import('../../src/lib/storage');

describe('user plans', () => {
  it('saves and reads back a plan', async () => {
    const { saveUserPlan, getUserPlan } = await mod();
    saveUserPlan('nbn-100-20', 79.9, 'Telstra');
    expect(getUserPlan('nbn-100-20')).toEqual({ price: 79.9, provider: 'Telstra', savedAt: '2026-10-01T00:00:00.000Z' });
  });

  it('only stores promo details when given', async () => {
    const { saveUserPlan, getUserPlan } = await mod();
    saveUserPlan('nbn-100-20', 59, 'Exetel', { fullPrice: 79, promoMonthsLeft: 4 });
    expect(getUserPlan('nbn-100-20')).toMatchObject({ fullPrice: 79, promoMonthsLeft: 4 });
  });

  it('clears one plan without touching the others', async () => {
    const { saveUserPlan, clearUserPlan, getUserPlans } = await mod();
    saveUserPlan('nbn-100-20', 79, 'A');
    saveUserPlan('nbn-50-20', 69, 'B');
    clearUserPlan('nbn-100-20');
    expect(Object.keys(getUserPlans())).toEqual(['nbn-50-20']);
  });

  it('migrates legacy nbn100 keys to full tier keys and persists the migration', async () => {
    const { getUserPlans } = await mod();
    storage.setItem('ismynbncooked_plans', JSON.stringify({
      nbn100: { price: 80, provider: 'A', savedAt: 'x' },
      nbn1000: { price: 110, provider: 'B', savedAt: 'x' },
      'nbn-50-20': { price: 70, provider: 'C', savedAt: 'x' },
    }));
    expect(Object.keys(getUserPlans()).sort()).toEqual(['nbn-100-20', 'nbn-1000-50', 'nbn-50-20']);
    expect(Object.keys(JSON.parse(storage.getItem('ismynbncooked_plans')!)).sort()).toEqual(['nbn-100-20', 'nbn-1000-50', 'nbn-50-20']);
  });

  it('gives an unlisted legacy speed a sensible default key', async () => {
    const { getUserPlans } = await mod();
    storage.setItem('ismynbncooked_plans', JSON.stringify({ nbn300: { price: 80, provider: 'A', savedAt: 'x' } }));
    expect(Object.keys(getUserPlans())).toEqual(['nbn-300-20']);
  });

  it('survives corrupt storage', async () => {
    const { getUserPlans } = await mod();
    storage.setItem('ismynbncooked_plans', '{not json');
    expect(getUserPlans()).toEqual({});
  });

  it('returns nothing on the server', async () => {
    vi.unstubAllGlobals();
    const { getUserPlans, getUserState } = await mod();
    expect(getUserPlans()).toEqual({});
    expect(getUserState()).toBeNull();
  });
});

describe('preferences', () => {
  it('defaults the horizon to one year', async () => {
    const { getDefaultHorizon } = await mod();
    expect(getDefaultHorizon()).toBe(12);
  });

  it('round-trips a numeric horizon', async () => {
    const { getDefaultHorizon, saveDefaultHorizon } = await mod();
    saveDefaultHorizon(12);
    expect(getDefaultHorizon()).toBe(12);
    saveDefaultHorizon('cheapest');
    expect(getDefaultHorizon()).toBe('cheapest');
  });

  it('ignores a horizon that is not one of the options', async () => {
    const { getDefaultHorizon } = await mod();
    storage.setItem('ismynbncooked_horizon', '5');
    expect(getDefaultHorizon()).toBe('cheapest');
  });

  it('groups tiers by default and remembers the choice', async () => {
    const { getGroupTiers, saveGroupTiers } = await mod();
    expect(getGroupTiers()).toBe(true);
    saveGroupTiers(false);
    expect(getGroupTiers()).toBe(false);
  });

  it('remembers the chosen state', async () => {
    const { getUserState, saveUserState } = await mod();
    expect(getUserState()).toBeNull();
    saveUserState('vic');
    expect(getUserState()).toBe('vic');
  });
});

describe('tier visits', () => {
  it('records the cheapest price seen at the last visit', async () => {
    const { getTierVisit, saveTierVisit } = await mod();
    expect(getTierVisit('nbn-100-20')).toBeNull();
    saveTierVisit('nbn-100-20', 59.9);
    expect(getTierVisit('nbn-100-20')).toEqual({ cheapest: 59.9, visitedAt: '2026-10-01T00:00:00.000Z' });
  });

  it('migrates legacy visit keys', async () => {
    const { getTierVisit } = await mod();
    storage.setItem('ismynbncooked_visits', JSON.stringify({ nbn250: { cheapest: 79, visitedAt: 'x' } }));
    expect(getTierVisit('nbn-250-25')).toEqual({ cheapest: 79, visitedAt: 'x' });
  });
});
