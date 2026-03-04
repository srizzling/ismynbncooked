export const SPEED_TIERS = [25, 50, 100, 250, 500, 750, 1000, 2000] as const;
export type SpeedTier = (typeof SPEED_TIERS)[number];

export const TIER_LABELS: Record<SpeedTier, string> = {
  25: 'NBN 25 (25/5 Mbps)',
  50: 'NBN 50 (50/20 Mbps)',
  100: 'NBN 100 (100/20 Mbps)',
  250: 'NBN 250 (250/25 Mbps)',
  500: 'NBN 500 (500/50 Mbps)',
  750: 'NBN 750 (750/50 Mbps)',
  1000: 'NBN 1000 (1000/50 Mbps)',
  2000: 'NBN 2000 (2000/200 Mbps)',
};

export interface NBNPlan {
  id: string;
  providerName: string;
  planName: string;
  monthlyPrice: number;
  yearlyCost: number;
  effectiveMonthly: number;
  setupFee: number;
  promoValue: number | null;
  promoDuration: number | null;
  typicalEveningSpeed: number | null;
  contractLength: number;
  cisUrl: string;
  minimumTerm: string | null;
  cancellationFees: string | null;
  noticePeriod: string | null;
}

export interface TierData {
  speed: SpeedTier;
  label: string;
  updatedAt: string;
  planCount: number;
  cheapest: number;
  average: number;
  plans: NBNPlan[];
}

export interface HistoryEntry {
  date: string;
  monthlyPrice: number;
  yearlyCost: number;
}

export interface ProviderHistory {
  current: {
    monthlyPrice: number;
    planName: string;
    yearlyCost: number;
  };
  history: HistoryEntry[];
}

export interface DailySummary {
  date: string;
  cheapestPrice: number;
  averagePrice: number;
  planCount: number;
}

export interface TierHistory {
  providers: Record<string, ProviderHistory>;
  daily: DailySummary[];
}

export interface ComparisonUnit {
  label: string;
  icon: string;
  price: number;
  per: 'month' | 'total';
  note?: string;
  source?: string;     // Where the price data came from (shown on hover)
  sourceUrl?: string;  // Link to the data source
  state?: string;      // Only shown when user's state matches (e.g. 'nsw', 'vic')
}

export interface ComparisonsData {
  updatedAt: string;
  units: Record<string, ComparisonUnit>;
}

export interface UserPlan {
  price: number;
  provider: string;
  savedAt: string;
  fullPrice?: number;         // Price after promo ends (if on a promo)
  promoMonthsLeft?: number;   // Months left on promo from when plan was saved
}

export type UserPlans = Partial<Record<`nbn${SpeedTier}`, UserPlan>>;

export type CookedLevel = 'winning' | 'sweet-as' | 'bit-shit' | 'taking-the-piss' | 'absolute-rort';

export interface CookedResult {
  level: CookedLevel;
  label: string;
  overpayPercent: number;
  monthlySavings: number;
  yearlySavings: number;
  color: string;
}

export interface MetaData {
  lastPriceSync: string;
  lastTermsSync: string;
  lastComparisonSync: string;
}

export const AU_STATES = ['nsw', 'vic', 'qld', 'sa', 'wa', 'tas', 'act', 'nt'] as const;
export type AUState = (typeof AU_STATES)[number];

export const STATE_LABELS: Record<AUState, string> = {
  nsw: 'NSW',
  vic: 'VIC',
  qld: 'QLD',
  sa: 'SA',
  wa: 'WA',
  tas: 'TAS',
  act: 'ACT',
  nt: 'NT',
};
