import type { TierManifest, TierInfo, GroupedTier, NetworkType } from './types';
import { buildGroupedTierKey } from './types';

export interface TierSummary {
  cheapest: number;
  cheapestEffective: number;
  cheapestProvider: string;
  average: number;
  planCount: number;
}

// Fixture manifest for development / when R2 is not available
export function getFixtureManifest(): TierManifest {
  return {
    updatedAt: '2026-01-01T00:00:00Z',
    tiers: [
      { key: 'nbn-25-5', network: 'nbn', downloadSpeed: 25, uploadSpeed: 5, label: 'NBN 25/5', planCount: 17, cheapest: 39.90, cheapestEffective: 39.90, cheapestProvider: 'Tangerine', average: 51 },
      { key: 'nbn-50-20', network: 'nbn', downloadSpeed: 50, uploadSpeed: 20, label: 'NBN 50/20', planCount: 24, cheapest: 49.90, cheapestEffective: 49.90, cheapestProvider: 'Tangerine', average: 63 },
      { key: 'nbn-100-20', network: 'nbn', downloadSpeed: 100, uploadSpeed: 20, label: 'NBN 100/20', planCount: 29, cheapest: 59.90, cheapestEffective: 59.90, cheapestProvider: 'Tangerine', average: 77 },
      { key: 'nbn-250-25', network: 'nbn', downloadSpeed: 250, uploadSpeed: 25, label: 'NBN 250/25', planCount: 20, cheapest: 79, cheapestEffective: 79, cheapestProvider: 'Superloop', average: 97 },
      { key: 'nbn-500-50', network: 'nbn', downloadSpeed: 500, uploadSpeed: 50, label: 'NBN 500/50', planCount: 15, cheapest: 89, cheapestEffective: 89, cheapestProvider: 'Superloop', average: 109 },
      { key: 'nbn-750-50', network: 'nbn', downloadSpeed: 750, uploadSpeed: 50, label: 'NBN 750/50', planCount: 10, cheapest: 99, cheapestEffective: 99, cheapestProvider: 'Superloop', average: 125 },
      { key: 'nbn-1000-50', network: 'nbn', downloadSpeed: 1000, uploadSpeed: 50, label: 'NBN 1000/50', planCount: 13, cheapest: 99, cheapestEffective: 99, cheapestProvider: 'Superloop', average: 135 },
      { key: 'nbn-2000-200', network: 'nbn', downloadSpeed: 2000, uploadSpeed: 200, label: 'NBN 2000/200', planCount: 6, cheapest: 149, cheapestEffective: 149, cheapestProvider: 'Superloop', average: 179 },
    ],
    providers: ['Aussie Broadband', 'Exetel', 'Launtel', 'Leaptel', 'Superloop', 'Tangerine', 'Telstra', 'TPG'],
  };
}

/**
 * Group tiers by network + download speed, merging upload variants.
 * Each group aggregates plan counts, picks the cheapest price, and
 * computes a weighted average price across variants.
 */
export function groupTiersByDownload(tiers: TierInfo[]): GroupedTier[] {
  const map = new Map<string, GroupedTier>();

  for (const tier of tiers) {
    const groupKey = buildGroupedTierKey(tier.network, tier.downloadSpeed);
    let group = map.get(groupKey);
    if (!group) {
      const prefix = tier.network === 'nbn' ? 'NBN' : 'Opticomm';
      group = {
        groupKey,
        network: tier.network,
        downloadSpeed: tier.downloadSpeed,
        label: `${prefix} ${tier.downloadSpeed}`,
        tierKeys: [],
        tiers: [],
        planCount: 0,
      };
      map.set(groupKey, group);
    }
    group.tierKeys.push(tier.key);
    group.tiers.push(tier);
    group.planCount += tier.planCount ?? 0;

    if (tier.cheapest != null) {
      if (group.cheapest == null || tier.cheapest < group.cheapest) {
        group.cheapest = tier.cheapest;
        group.cheapestProvider = tier.cheapestProvider;
      }
    }
    if (tier.cheapestEffective != null) {
      if (group.cheapestEffective == null || tier.cheapestEffective < group.cheapestEffective) {
        group.cheapestEffective = tier.cheapestEffective;
      }
    }
  }

  // Compute weighted average price across variants
  for (const group of map.values()) {
    let totalWeightedPrice = 0;
    let totalPlans = 0;
    for (const tier of group.tiers) {
      if (tier.average != null && tier.planCount != null && tier.planCount > 0) {
        totalWeightedPrice += tier.average * tier.planCount;
        totalPlans += tier.planCount;
      }
    }
    if (totalPlans > 0) {
      group.average = totalWeightedPrice / totalPlans;
    }
  }

  // Sort by download speed
  return [...map.values()].sort((a, b) => a.downloadSpeed - b.downloadSpeed);
}

/**
 * Find all tier keys that belong to a grouped tier key (e.g. "nbn-500" → ["nbn-500-42", "nbn-500-45", ...])
 */
export function getTierKeysForGroup(groupKey: string, manifest: TierManifest): string[] {
  const match = groupKey.match(/^(nbn|opticomm)-(\d+)$/);
  if (!match) return [];
  const network = match[1];
  const download = parseInt(match[2], 10);
  return manifest.tiers
    .filter(t => t.network === network && t.downloadSpeed === download)
    .map(t => t.key);
}

// Fixture data for development / when R2 is not available
export function getFixtureTierSummaries(): Record<string, TierSummary> {
  const manifest = getFixtureManifest();
  const summaries: Record<string, TierSummary> = {};
  for (const tier of manifest.tiers) {
    summaries[tier.key] = {
      cheapest: tier.cheapest!,
      cheapestEffective: tier.cheapestEffective!,
      cheapestProvider: tier.cheapestProvider!,
      average: tier.average!,
      planCount: tier.planCount!,
    };
  }
  return summaries;
}
