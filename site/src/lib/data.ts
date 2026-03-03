import type { TierData, TierHistory, ComparisonsData, MetaData, SpeedTier, SPEED_TIERS } from './types';

const DATA_BASE_URL = import.meta.env.PUBLIC_DATA_URL ?? '/data';

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${DATA_BASE_URL}/${path}`);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

export function fetchTierData(speed: SpeedTier): Promise<TierData> {
  return fetchJSON(`plans/nbn-${speed}.json`);
}

export function fetchTierHistory(speed: SpeedTier): Promise<TierHistory> {
  return fetchJSON(`history/nbn-${speed}.json`);
}

export function fetchComparisons(): Promise<ComparisonsData> {
  return fetchJSON('comparisons.json');
}

export function fetchMeta(): Promise<MetaData> {
  return fetchJSON('meta.json');
}

// Fixture data for development / when R2 is not available
export function getFixtureTierSummaries(): Record<SpeedTier, { cheapest: number; average: number; planCount: number }> {
  return {
    25:   { cheapest: 39.90,  average: 51,  planCount: 17 },
    50:   { cheapest: 49.90,  average: 63,  planCount: 24 },
    100:  { cheapest: 59.90,  average: 77,  planCount: 29 },
    250:  { cheapest: 79,     average: 97,  planCount: 20 },
    500:  { cheapest: 89,     average: 109, planCount: 15 },
    750:  { cheapest: 99,     average: 125, planCount: 10 },
    1000: { cheapest: 99,     average: 135, planCount: 13 },
    2000: { cheapest: 149,    average: 179, planCount: 6 },
  };
}
