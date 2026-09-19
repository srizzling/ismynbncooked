export interface Env {
  DATA_BUCKET: R2Bucket;
  NETBARGAINS_API_KEY: string;
  GITHUB_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
  FIRECRAWL_API_KEY?: string;
}

// Download speeds we query from the NetBargains API
export const DOWNLOAD_SPEEDS = [25, 50, 100, 250, 500, 750, 1000, 2000] as const;
export type DownloadSpeed = (typeof DOWNLOAD_SPEEDS)[number];

// Legacy type alias — kept for dual-write transition
export const SPEED_TIERS = DOWNLOAD_SPEEDS;
export type SpeedTier = DownloadSpeed;

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
  providers: string[];
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

export interface NetBargainsPlan {
  id: string;
  provider_id: number;
  provider_name: string;
  provider_website: string;
  plan_name: string;
  speed_tier: string;
  download_speed: number;
  upload_speed: number;
  typical_evening_speed: number | null;
  network_type: string;
  monthly_price: number;
  setup_fee: number;
  total_min_cost: number;
  contract_length: number;
  data_limit: string;
  promo_type: string | null;
  promo_value: number | null;
  promo_duration: number | null;
  promo_end_date: string | null;
  cis_url: string;
  scraped_date: string;
  is_active: boolean;
}

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
  /** Provider's website (from NetBargains or the community scraper) */
  providerWebsite?: string | null;
  /** Promo end date if the provider publishes one (YYYY-MM-DD) */
  promoEndDate?: string | null;
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

export interface DailySummary {
  date: string;
  cheapestPrice: number;
  averagePrice: number;
  planCount: number;
}

export interface TierHistory {
  providers: Record<string, {
    current: { monthlyPrice: number; planName: string; yearlyCost: number; lastSeen?: string };
    history: HistoryEntry[];
  }>;
  daily: DailySummary[];
}

export interface MetaData {
  lastPriceSync: string;
  lastTermsSync: string;
  lastComparisonSync: string;
}

/** One recorded price point for a provider within a tier */
export interface HistoryEntry {
  date: string;
  monthlyPrice: number;
  yearlyCost: number;
}

// ─── Provider pages ──────────────────────────────────────────────────────────

export interface ProviderTierEntry {
  tierKey: string;
  label: string;
  network: NetworkType;
  downloadSpeed: number;
  uploadSpeed: number;
  /** The provider's cheapest plan in this tier */
  plan: NBNPlan;
  /** 1-based rank of that plan by ongoing monthly price within the tier */
  rank: number;
  planCount: number;
  tierCheapest: number;
  tierAverage: number;
  history: HistoryEntry[];
  lastSeen?: string;
}

export interface ProviderData {
  slug: string;
  name: string;
  website: string | null;
  updatedAt: string;
  planCount: number;
  tiers: ProviderTierEntry[];
}

export interface ProviderIndexEntry {
  slug: string;
  name: string;
  website: string | null;
  planCount: number;
  tierCount: number;
  cheapest: number;
  networks: NetworkType[];
}

export interface ProviderIndex {
  updatedAt: string;
  providers: ProviderIndexEntry[];
}

// ─── Monthly price reports ───────────────────────────────────────────────────

export interface ReportPriceChange {
  provider: string;
  from: number;
  to: number;
  date: string;
}

export interface ReportTier {
  tierKey: string;
  label: string;
  network: NetworkType;
  planCountStart: number;
  planCountEnd: number;
  cheapestStart: number;
  cheapestEnd: number;
  averageStart: number;
  averageEnd: number;
  cheapestProvider: string | null;
  changes: ReportPriceChange[];
  newProviders: string[];
  goneProviders: string[];
}

export interface MonthlyReport {
  /** YYYY-MM */
  month: string;
  generatedAt: string;
  /** true once the month is over and the numbers will not change */
  final: boolean;
  tiers: ReportTier[];
  summary: {
    rises: number;
    drops: number;
    tiersCheaper: number;
    tiersDearer: number;
    newProviders: string[];
    goneProviders: string[];
    biggestRise: (ReportPriceChange & { tierKey: string; label: string }) | null;
    biggestDrop: (ReportPriceChange & { tierKey: string; label: string }) | null;
  };
}

export interface ReportIndexEntry {
  month: string;
  generatedAt: string;
  final: boolean;
  rises: number;
  drops: number;
  newProviders: number;
}

export interface ReportIndex {
  updatedAt: string;
  reports: ReportIndexEntry[];
}
