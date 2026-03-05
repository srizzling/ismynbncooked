import type { SpeedTier } from './types';

export interface TierSummary {
  cheapest: number;
  cheapestEffective: number;
  cheapestProvider: string;
  average: number;
  planCount: number;
}

// Fixture data for development / when R2 is not available
export function getFixtureTierSummaries(): Record<SpeedTier, TierSummary> {
  return {
    25:   { cheapest: 39.90,  cheapestEffective: 39.90,  cheapestProvider: 'Tangerine', average: 51,  planCount: 17 },
    50:   { cheapest: 49.90,  cheapestEffective: 49.90,  cheapestProvider: 'Tangerine', average: 63,  planCount: 24 },
    100:  { cheapest: 59.90,  cheapestEffective: 59.90,  cheapestProvider: 'Tangerine', average: 77,  planCount: 29 },
    250:  { cheapest: 79,     cheapestEffective: 79,     cheapestProvider: 'Superloop', average: 97,  planCount: 20 },
    500:  { cheapest: 89,     cheapestEffective: 89,     cheapestProvider: 'Superloop', average: 109, planCount: 15 },
    750:  { cheapest: 99,     cheapestEffective: 99,     cheapestProvider: 'Superloop', average: 125, planCount: 10 },
    1000: { cheapest: 99,     cheapestEffective: 99,     cheapestProvider: 'Superloop', average: 135, planCount: 13 },
    2000: { cheapest: 149,    cheapestEffective: 149,    cheapestProvider: 'Superloop', average: 179, planCount: 6 },
  };
}
