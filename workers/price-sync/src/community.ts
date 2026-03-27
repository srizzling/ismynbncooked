import type { NBNPlan, NetworkType } from './types';

/** A community-submitted plan source to scrape */
export interface CommunitySource {
  provider: string;
  url: string;
  cisUrl?: string;
  networkType: NetworkType;
  downloadSpeed: number;
  uploadSpeed: number;
}

/** Extracted plan data from Firecrawl */
interface ExtractedPlan {
  planName: string;
  providerName?: string;
  monthlyPrice: number;
  promoPrice?: number;
  promoDuration?: number;
  downloadSpeed: number;
  uploadSpeed?: number;
  setupFee?: number;
  contractLength?: number;
  typicalEveningSpeed?: number;
}

// Inline the sources at build time
import sources from '../community-sources.json';

const EXTRACT_SCHEMA = {
  type: 'object' as const,
  properties: {
    plans: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          planName: { type: 'string' as const, description: 'Name of the internet plan' },
          providerName: { type: 'string' as const, description: 'Name of the ISP/provider' },
          monthlyPrice: { type: 'number' as const, description: 'Regular ongoing monthly price in AUD' },
          promoPrice: { type: 'number' as const, description: 'Promotional monthly price in AUD, if any' },
          promoDuration: { type: 'number' as const, description: 'How many months the promo lasts' },
          downloadSpeed: { type: 'number' as const, description: 'Download speed in Mbps' },
          uploadSpeed: { type: 'number' as const, description: 'Upload speed in Mbps' },
          setupFee: { type: 'number' as const, description: 'One-time setup fee in AUD, 0 if none' },
          contractLength: { type: 'number' as const, description: 'Lock-in period in months, 0 if month-to-month' },
          typicalEveningSpeed: { type: 'number' as const, description: 'Typical evening speed in Mbps if advertised' },
        },
        required: ['planName', 'monthlyPrice', 'downloadSpeed'],
      },
    },
  },
  required: ['plans'],
};

/**
 * Scrape a single community source URL using Firecrawl extract
 */
export async function scrapeSource(source: CommunitySource, apiKey: string): Promise<NBNPlan[]> {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url: source.url,
      formats: ['extract'],
      extract: {
        schema: EXTRACT_SCHEMA,
        prompt: `Extract all ${source.networkType.toUpperCase()} internet plans from this page that have a download speed of ${source.downloadSpeed} Mbps. Include pricing, speeds, and any promotional offers. Prices should be in AUD.`,
      },
    }),
  });

  if (!res.ok) {
    console.error(`[community] Firecrawl error for ${source.url}: ${res.status}`);
    return [];
  }

  const result = await res.json() as { data?: { extract?: { plans?: ExtractedPlan[] } } };
  const extracted = result.data?.extract?.plans ?? [];

  // Filter to matching speed and transform to NBNPlan
  return extracted
    .filter(p => p.downloadSpeed === source.downloadSpeed)
    .filter(p => !source.uploadSpeed || (p.uploadSpeed && p.uploadSpeed === source.uploadSpeed))
    .map((p, i) => transformExtractedPlan(p, source, i));
}

function transformExtractedPlan(p: ExtractedPlan, source: CommunitySource, index: number): NBNPlan {
  const monthlyPrice = p.monthlyPrice;
  const promoValue = p.promoPrice ? monthlyPrice - p.promoPrice : 0;
  const promoDuration = promoValue > 0 ? (p.promoDuration ?? 0) : 0;
  const setupFee = p.setupFee ?? 0;

  const promoMonths = Math.min(promoDuration, 12);
  const fullMonths = 12 - promoMonths;
  const yearlyCost = promoMonths * (monthlyPrice - promoValue) + fullMonths * monthlyPrice + setupFee;
  const effectiveMonthly = yearlyCost / 12;

  return {
    id: `community-${source.provider.toLowerCase().replace(/\s+/g, '-')}-${source.downloadSpeed}-${source.uploadSpeed}-${index}`,
    providerName: p.providerName ?? source.provider,
    planName: p.planName,
    monthlyPrice,
    yearlyCost: Math.round(yearlyCost * 100) / 100,
    effectiveMonthly: Math.round(effectiveMonthly * 100) / 100,
    setupFee,
    promoValue: promoValue > 0 ? promoValue : null,
    promoDuration: promoDuration > 0 ? promoDuration : null,
    typicalEveningSpeed: p.typicalEveningSpeed ?? null,
    contractLength: p.contractLength ?? 0,
    cisUrl: source.cisUrl ?? '',
    minimumTerm: null,
    cancellationFees: null,
    noticePeriod: null,
    downloadSpeed: source.downloadSpeed,
    uploadSpeed: source.uploadSpeed || p.uploadSpeed || 0,
    networkType: source.networkType,
  };
}

/**
 * Fetch all community-sourced plans using Firecrawl.
 * Returns plans ready to merge into the tier groups.
 */
export async function fetchCommunityPlans(firecrawlApiKey: string): Promise<NBNPlan[]> {
  const communitySources = sources as CommunitySource[];
  if (communitySources.length === 0) return [];

  console.log(`[community] Scraping ${communitySources.length} community source(s)...`);

  const allPlans: NBNPlan[] = [];

  for (const source of communitySources) {
    try {
      const plans = await scrapeSource(source, firecrawlApiKey);
      console.log(`[community] ${source.provider} (${source.downloadSpeed}/${source.uploadSpeed}): ${plans.length} plan(s)`);
      allPlans.push(...plans);
    } catch (err) {
      console.error(`[community] Failed to scrape ${source.url}:`, err);
    }
  }

  console.log(`[community] Total: ${allPlans.length} community plan(s)`);
  return allPlans;
}
