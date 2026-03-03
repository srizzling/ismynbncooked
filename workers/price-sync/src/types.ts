export interface Env {
  DATA_BUCKET: R2Bucket;
  NETBARGAINS_API_KEY: string;
  DEPLOY_HOOK_URL?: string;
}

export const SPEED_TIERS = [25, 50, 100, 250, 500, 750, 1000, 2000] as const;
export type SpeedTier = (typeof SPEED_TIERS)[number];

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

export interface DailySummary {
  date: string;
  cheapestPrice: number;
  averagePrice: number;
  planCount: number;
}

export interface TierHistory {
  providers: Record<string, {
    current: { monthlyPrice: number; planName: string; yearlyCost: number };
    history: { date: string; monthlyPrice: number; yearlyCost: number }[];
  }>;
  daily: DailySummary[];
}

export interface MetaData {
  lastPriceSync: string;
  lastTermsSync: string;
  lastComparisonSync: string;
}
