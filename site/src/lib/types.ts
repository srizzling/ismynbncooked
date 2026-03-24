// --- Tier key system ---

export type NetworkType = 'nbn' | 'opticomm';

export interface TierInfo {
  key: string;
  network: NetworkType;
  downloadSpeed: number;
  uploadSpeed: number;
  label: string;
  planCount?: number;
  cheapest?: number;
  cheapestEffective?: number;
  cheapestProvider?: string;
  average?: number;
}

export interface TierManifest {
  updatedAt: string;
  tiers: TierInfo[];
}

export function buildTierKey(network: NetworkType, download: number, upload: number): string {
  return `${network}-${download}-${upload}`;
}

export function parseTierKey(key: string): { network: NetworkType; download: number; upload: number } | null {
  const match = key.match(/^(nbn|opticomm)-(\d+)-(\d+)$/);
  if (!match) return null;
  return {
    network: match[1] as NetworkType,
    download: parseInt(match[2], 10),
    upload: parseInt(match[3], 10),
  };
}

export function buildTierLabel(network: NetworkType, download: number, upload: number): string {
  const prefix = network === 'nbn' ? 'NBN' : 'Opticomm';
  return `${prefix} ${download}/${upload}`;
}

// Default upload speed for each download speed (used for backward compat migration)
export const DEFAULT_UPLOAD_MAP: Record<number, string> = {
  25: 'nbn-25-5',
  50: 'nbn-50-20',
  100: 'nbn-100-20',
  250: 'nbn-250-25',
  500: 'nbn-500-50',
  750: 'nbn-750-50',
  1000: 'nbn-1000-50',
  2000: 'nbn-2000-200',
};

// --- Legacy aliases (for gradual migration) ---
/** @deprecated Use DOWNLOAD_SPEEDS or TierManifest instead */
export const SPEED_TIERS = [25, 50, 100, 250, 500, 750, 1000, 2000] as const;
/** @deprecated Use string tier keys instead */
export type SpeedTier = (typeof SPEED_TIERS)[number];
/** @deprecated Labels are now computed from tier info */
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

// --- Plan and tier data ---

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
  downloadSpeed: number;
  uploadSpeed: number;
  networkType: NetworkType;
}

export interface TierData {
  tierKey: string;
  network: NetworkType;
  downloadSpeed: number;
  uploadSpeed: number;
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
  source?: string;
  sourceUrl?: string;
  state?: string;
}

export interface ComparisonsData {
  updatedAt: string;
  units: Record<string, ComparisonUnit>;
}

export interface UserPlan {
  price: number;
  provider: string;
  savedAt: string;
  fullPrice?: number;
  promoMonthsLeft?: number;
}

export type UserPlans = Record<string, UserPlan>;

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
