import { describe, expect, it } from 'vitest';
import { getFixtureManifest, getFixtureTierSummaries, getTierKeysForGroup, groupTiersByDownload } from '../../src/lib/data';
import type { TierInfo } from '../../src/lib/types';

const tier = (over: Partial<TierInfo> & Pick<TierInfo, 'key' | 'downloadSpeed' | 'uploadSpeed'>): TierInfo => ({
  network: 'nbn', label: over.key, ...over,
});

describe('groupTiersByDownload', () => {
  const tiers = [
    tier({ key: 'nbn-500-50', downloadSpeed: 500, uploadSpeed: 50, planCount: 30, cheapest: 70, cheapestEffective: 68, cheapestProvider: 'B', average: 90 }),
    tier({ key: 'nbn-500-42', downloadSpeed: 500, uploadSpeed: 42, planCount: 10, cheapest: 80, cheapestEffective: 75, cheapestProvider: 'A', average: 100 }),
    tier({ key: 'nbn-100-20', downloadSpeed: 100, uploadSpeed: 20, planCount: 5, cheapest: 55, average: 60 }),
    tier({ key: 'opticomm-100-20', network: 'opticomm', downloadSpeed: 100, uploadSpeed: 20, planCount: 2, cheapest: 65, average: 70 }),
  ];
  const groups = groupTiersByDownload(tiers);

  it('merges upload variants of the same network and download speed', () => {
    const g = groups.find((x) => x.groupKey === 'nbn-500')!;
    expect(g.tierKeys).toEqual(['nbn-500-50', 'nbn-500-42']);
    expect(g.label).toBe('NBN 500');
    expect(g.planCount).toBe(40);
  });

  it('keeps the cheapest price and its provider across variants', () => {
    const g = groups.find((x) => x.groupKey === 'nbn-500')!;
    expect(g.cheapest).toBe(70);
    expect(g.cheapestProvider).toBe('B');
    expect(g.cheapestEffective).toBe(68);
  });

  it('weights the average by plan count', () => {
    expect(groups.find((x) => x.groupKey === 'nbn-500')!.average).toBe((90 * 30 + 100 * 10) / 40);
  });

  it('keeps networks apart', () => {
    expect(groups.map((g) => g.groupKey).sort()).toEqual(['nbn-100', 'nbn-500', 'opticomm-100']);
    expect(groups.find((x) => x.groupKey === 'opticomm-100')!.label).toBe('Opticomm 100');
  });

  it('sorts by download speed', () => {
    const speeds = groups.map((g) => g.downloadSpeed);
    expect(speeds).toEqual([...speeds].sort((a, b) => a - b));
  });

  it('copes with tiers that have no stats yet', () => {
    const [g] = groupTiersByDownload([tier({ key: 'nbn-25-5', downloadSpeed: 25, uploadSpeed: 5 })]);
    expect(g.planCount).toBe(0);
    expect(g.cheapest).toBeUndefined();
    expect(g.average).toBeUndefined();
  });
});

describe('getTierKeysForGroup', () => {
  const manifest = getFixtureManifest();

  it('finds every tier key for a grouped key', () => {
    expect(getTierKeysForGroup('nbn-100', manifest)).toEqual(['nbn-100-20']);
  });

  it('returns nothing for unknown or malformed keys', () => {
    expect(getTierKeysForGroup('nbn-999', manifest)).toEqual([]);
    expect(getTierKeysForGroup('nbn-100-20', manifest)).toEqual([]);
    expect(getTierKeysForGroup('nonsense', manifest)).toEqual([]);
  });
});

describe('fixture data', () => {
  it('has a summary for every fixture tier', () => {
    const manifest = getFixtureManifest();
    const summaries = getFixtureTierSummaries();
    expect(Object.keys(summaries).sort()).toEqual(manifest.tiers.map((t) => t.key).sort());
  });
});
