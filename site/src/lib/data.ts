import type { TierManifest, TierInfo } from './types';

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
