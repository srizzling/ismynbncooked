import type { SpeedTier } from './types';

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
