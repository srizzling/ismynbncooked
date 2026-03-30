import type { NBNPlan, NetworkType } from './types';
import { buildTierKey } from './types';

const CIS_URL = 'https://leaptel.com.au/wp-content/uploads/NBN-CIS-v25.6.pdf';
const PLAN_URL = 'https://leaptel.com.au/plans/';

/** Shape of a community-sources/*.json config file */
export interface CommunitySource {
  provider: string;
  url: string;
  networkType?: string;
  cisUrl?: string;
  downloadSpeed?: number;
  uploadSpeed?: number;
  notes?: string;
  submittedAt?: string;
}

/**
 * Reads all community source configs from R2 and scrapes each provider for missing plans.
 * Returns all plans that should be merged into the tier groups.
 */
export async function scrapeCommunityPlans(
  bucket: R2Bucket,
  firecrawlApiKey: string,
  allTierGroups: Map<string, NBNPlan[]>,
): Promise<{ plans: NBNPlan[]; added: number }> {
  // List all community source configs in R2
  const listed = await bucket.list({ prefix: 'data/community-sources/' });
  const sources: CommunitySource[] = [];

  for (const obj of listed.objects) {
    if (obj.key.endsWith('.json')) {
      try {
        const file = await bucket.get(obj.key);
        if (file) {
          const config = await file.json() as CommunitySource;
          sources.push(config);
        }
      } catch (err) {
        console.error(`[community] Failed to read ${obj.key}:`, err);
      }
    }
  }

  if (sources.length === 0) {
    console.log('[community] No community sources found in R2');
    return { plans: [], added: 0 };
  }

  console.log(`[community] Found ${sources.length} community source(s)`);
  let totalAdded = 0;
  const allNewPlans: NBNPlan[] = [];

  // Group sources by provider to avoid scraping the same site multiple times
  const byProvider = new Map<string, CommunitySource[]>();
  for (const source of sources) {
    const key = source.provider.toLowerCase();
    const existing = byProvider.get(key);
    if (existing) {
      existing.push(source);
    } else {
      byProvider.set(key, [source]);
    }
  }

  for (const [providerKey, providerSources] of byProvider) {
    try {
      let plans: NBNPlan[] = [];

      // Dispatch to the appropriate scraper
      if (providerKey === 'leaptel' || providerSources[0].url.includes('leaptel.com.au')) {
        plans = await scrapeLeaptelPlans(firecrawlApiKey);
      } else if (providerKey === 'origin energy' || providerKey === 'origin broadband' || providerKey === 'origin' || providerSources[0].url.includes('originenergy.com.au')) {
        plans = await scrapeOriginPlans(firecrawlApiKey);
      } else if (providerKey === 'swoop' || providerSources[0].url.includes('swoop.com.au')) {
        plans = await scrapeSwoopPlans(firecrawlApiKey, providerSources[0].url);
      } else {
        console.log(`[community] No scraper for provider "${providerSources[0].provider}" — skipping`);
        continue;
      }

      // Merge missing plans
      let added = 0;
      for (const plan of plans) {
        const tierKey = buildTierKey(plan.networkType, plan.downloadSpeed, plan.uploadSpeed);
        const existing = allTierGroups.get(tierKey);
        if (existing?.some(p => p.providerName.toLowerCase() === providerKey)) continue;
        if (existing) {
          existing.push(plan);
        } else {
          allTierGroups.set(tierKey, [plan]);
        }
        allNewPlans.push(plan);
        added++;
      }
      totalAdded += added;
      console.log(`[community] ${providerSources[0].provider}: ${plans.length} scraped, ${added} new plans merged`);
    } catch (err) {
      console.error(`[community] Scraper failed for ${providerSources[0].provider}:`, err);
    }
  }

  return { plans: allNewPlans, added: totalAdded };
}

/**
 * Scrapes Leaptel plans page via firecrawl and returns raw parsed plans.
 */
export async function scrapeLeaptelRaw(firecrawlApiKey: string): Promise<ParsedPlan[]> {
  console.log('[leaptel-scraper] Fetching plans via firecrawl...');

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: PLAN_URL,
      waitFor: 5000,
      actions: [
        { type: 'click', selector: '.wp-block-leaptel-plan-toggle__item:last-child' },
        { type: 'wait', milliseconds: 3000 },
        { type: 'scrape' },
      ],
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Firecrawl API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { success: boolean; data?: { markdown?: string }; error?: string };
  if (!data.success || !data.data?.markdown) {
    throw new Error(`Firecrawl scrape failed: ${data.error || 'no markdown returned'}`);
  }

  const plans = parseLeaptelMarkdownRaw(data.data.markdown);
  console.log(`[leaptel-scraper] Parsed ${plans.length} plans`);
  return plans;
}

/**
 * Scrapes all Leaptel NBN plans and returns them as NBNPlan[].
 * Used by the cron sync to merge missing plans.
 */
export async function scrapeLeaptelPlans(firecrawlApiKey: string): Promise<NBNPlan[]> {
  const rawPlans = await scrapeLeaptelRaw(firecrawlApiKey);
  return rawPlans.map(parsed => toNBNPlan(parsed));
}

export interface ParsedPlan {
  name: string;
  downloadSpeed: number;
  uploadSpeed: number;
  typicalEveningSpeed: number | null;
  monthlyPrice: number;       // promo price
  promoValue: number;         // discount amount per month
  promoDuration: number;      // months
  ongoingPrice: number;       // full price after promo
  networkType?: NetworkType;  // optional — defaults to 'nbn' if not set
}

/**
 * Parses firecrawl markdown output into structured plan data.
 *
 * The markdown has a repeating pattern per plan:
 *   ### Plan Name
 *   {download}Mbps
 *   DOWNLOAD
 *   {upload}Mbps
 *   UPLOAD
 *   ...
 *   Typical evening speed:
 *   {dl}/{ul}
 *   Mbps
 *   ...
 *   ${promo_price} / month
 *   ${discount} discount for {duration} months,
 *   then ${ongoing} ongoing
 */
/** Convert a ParsedPlan to an NBNPlan for the Leaptel provider. */
function toNBNPlan(parsed: ParsedPlan): NBNPlan {
  const yearlyCost = computeYearlyCost(parsed.monthlyPrice, parsed.promoValue, parsed.promoDuration);
  return {
    id: `leaptel-${parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${parsed.downloadSpeed}-${parsed.uploadSpeed}`,
    providerName: 'Leaptel',
    planName: `Leaptel ${parsed.name}`,
    monthlyPrice: parsed.ongoingPrice,
    yearlyCost: Math.round(yearlyCost * 100) / 100,
    effectiveMonthly: Math.round((yearlyCost / 12) * 100) / 100,
    setupFee: 0,
    promoValue: parsed.promoValue,
    promoDuration: parsed.promoDuration,
    typicalEveningSpeed: parsed.typicalEveningSpeed,
    contractLength: 0,
    cisUrl: CIS_URL,
    minimumTerm: null,
    cancellationFees: null,
    noticePeriod: null,
    downloadSpeed: parsed.downloadSpeed,
    uploadSpeed: parsed.uploadSpeed,
    networkType: 'nbn',
  };
}

export function parseLeaptelMarkdownRaw(markdown: string): ParsedPlan[] {
  const lines = markdown.split('\n').map(l => l.trim());
  const plans: ParsedPlan[] = [];

  // Known plan names to match against — avoids picking up section headers
  const knownPlanNames = [
    'Pronto', 'Accelerated', 'Full Throttle', 'Full Boost',
    'Turbo Boost +', 'Fast', 'Fast +', 'Superfast',
    'Ultrafast', 'Ultrafast +',
    'Hyperfast HFC', 'Hyperfast FTTP', 'Hyperfast +',
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for plan header: ### Plan Name
    if (!line.startsWith('### ')) continue;
    const name = line.replace('### ', '').replace(/\\/g, '');
    if (!knownPlanNames.includes(name)) continue;

    // Parse the block following this header
    const parsed = parsePlanBlock(lines, i + 1);
    if (!parsed) continue;

    plans.push(parsed);
  }

  return plans;
}

function parsePlanBlock(lines: string[], startIdx: number): ParsedPlan | null {
  let downloadSpeed = 0;
  let uploadSpeed = 0;
  let typicalEveningSpeed: number | null = null;
  let monthlyPrice = 0;
  let promoValue = 0;
  let promoDuration = 0;
  let ongoingPrice = 0;
  const name = lines[startIdx - 1]?.replace('### ', '').replace(/\\/g, '') || '';

  // Helper: find the next non-empty line after index i
  const nextNonEmpty = (from: number, max: number): string => {
    for (let j = from; j < max; j++) {
      if (lines[j] !== '') return lines[j];
    }
    return '';
  };

  // Scan forward up to 60 lines or until next plan header
  const endIdx = Math.min(startIdx + 60, lines.length);
  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i];
    if (line === '') continue;

    // Stop if we hit another plan header
    if (line.startsWith('### ')) break;

    // Download speed: "{N}Mbps" followed (possibly with blanks) by "DOWNLOAD"
    const dlMatch = line.match(/^(\d+)Mbps$/);
    if (dlMatch && nextNonEmpty(i + 1, endIdx) === 'DOWNLOAD' && !downloadSpeed) {
      downloadSpeed = parseInt(dlMatch[1]);
      continue;
    }

    // Upload speed: "{N}Mbps" followed (possibly with blanks) by "UPLOAD"
    const ulMatch = line.match(/^(\d+)Mbps$/);
    if (ulMatch && nextNonEmpty(i + 1, endIdx) === 'UPLOAD') {
      uploadSpeed = parseInt(ulMatch[1]);
      continue;
    }

    // Typical evening speed: "{dl}/{ul}" or "{dl}/{ul}\*"
    const tesMatch = line.match(/^(\d+)\/(\d+)\*?$/);
    if (tesMatch && nextNonEmpty(i + 1, endIdx) === 'Mbps') {
      typicalEveningSpeed = parseInt(tesMatch[1]);
      continue;
    }

    // Price: "$X.XX / month"
    const priceMatch = line.match(/^\$(\d+(?:\.\d{2})?) \/ month$/);
    if (priceMatch) {
      monthlyPrice = parseFloat(priceMatch[1]);
      continue;
    }

    // Discount: "$X discount for Y months,"
    const discountMatch = line.match(/^\$(\d+) discount for (\d+) months,?$/);
    if (discountMatch) {
      promoValue = parseFloat(discountMatch[1]);
      promoDuration = parseInt(discountMatch[2]);
      continue;
    }

    // Ongoing: "then $X.XX ongoing"
    const ongoingMatch = line.match(/^then \$(\d+(?:\.\d{2})?) ongoing$/);
    if (ongoingMatch) {
      ongoingPrice = parseFloat(ongoingMatch[1]);
      continue;
    }
  }

  if (!downloadSpeed || !monthlyPrice) return null;

  // If no separate ongoing price found, there's no promo
  if (!ongoingPrice) {
    ongoingPrice = monthlyPrice;
    promoValue = 0;
    promoDuration = 0;
  }

  return { name, downloadSpeed, uploadSpeed, typicalEveningSpeed, monthlyPrice, promoValue, promoDuration, ongoingPrice };
}

function computeYearlyCost(promoPrice: number, promoValue: number, promoDuration: number): number {
  const ongoingPrice = promoPrice + promoValue;
  const promoMonths = Math.min(promoDuration, 12);
  const fullMonths = 12 - promoMonths;
  return promoMonths * promoPrice + fullMonths * ongoingPrice;
}

// ─── Origin Energy Scraper ────────────────────────────────────────────────────

const ORIGIN_URL = 'https://www.originenergy.com.au/internet/plans/';
const ORIGIN_CIS_URL = 'https://www.originenergy.com.au/internet/terms-conditions/critical-information-summary/';

interface OriginTab {
  selector: string;
  networkType: NetworkType;
}

const ORIGIN_TABS: OriginTab[] = [
  { selector: '#tab-nbn', networkType: 'nbn' },
  { selector: '#tab-faster_nbn', networkType: 'nbn' },
  { selector: '#tab-opticomm', networkType: 'opticomm' },
  { selector: '#tab-faster_opticomm', networkType: 'opticomm' },
];

/**
 * Scrapes all Origin Energy plans across all tabs (NBN, Faster NBN, Opticomm, Faster Opticomm).
 */
export async function scrapeOriginRaw(firecrawlApiKey: string): Promise<ParsedPlan[]> {
  console.log('[origin-scraper] Fetching plans via firecrawl...');
  const allPlans: ParsedPlan[] = [];
  const seen = new Set<string>();

  for (const tab of ORIGIN_TABS) {
    try {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: ORIGIN_URL,
          waitFor: 3000,
          actions: [
            { type: 'click', selector: tab.selector },
            { type: 'wait', milliseconds: 2000 },
            { type: 'scrape' },
          ],
          formats: ['markdown'],
          onlyMainContent: true,
        }),
      });

      if (!res.ok) {
        console.error(`[origin-scraper] Firecrawl error for ${tab.selector}: ${res.status}`);
        continue;
      }

      const data = await res.json() as { success: boolean; data?: { markdown?: string }; error?: string };
      if (!data.success || !data.data?.markdown) {
        console.error(`[origin-scraper] Scrape failed for ${tab.selector}: ${data.error}`);
        continue;
      }

      const plans = parseOriginMarkdown(data.data.markdown, tab.networkType);
      for (const plan of plans) {
        const key = `${plan.name}-${plan.downloadSpeed}-${plan.uploadSpeed}-${plan.networkType}`;
        if (!seen.has(key)) {
          seen.add(key);
          allPlans.push(plan);
        }
      }
      console.log(`[origin-scraper] ${tab.selector}: ${plans.length} plans`);
    } catch (err) {
      console.error(`[origin-scraper] Error scraping ${tab.selector}:`, err);
    }
  }

  console.log(`[origin-scraper] Total: ${allPlans.length} unique plans`);
  return allPlans;
}

export async function scrapeOriginPlans(firecrawlApiKey: string): Promise<NBNPlan[]> {
  const rawPlans = await scrapeOriginRaw(firecrawlApiKey);
  return rawPlans.map(p => toOriginNBNPlan(p));
}

function toOriginNBNPlan(parsed: ParsedPlan): NBNPlan {
  const yearlyCost = computeYearlyCost(parsed.monthlyPrice, parsed.promoValue, parsed.promoDuration);
  return {
    id: `origin-${parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${parsed.downloadSpeed}-${parsed.uploadSpeed}`,
    providerName: 'Origin Broadband',
    planName: `Origin ${parsed.name}`,
    monthlyPrice: parsed.ongoingPrice,
    yearlyCost: Math.round(yearlyCost * 100) / 100,
    effectiveMonthly: Math.round((yearlyCost / 12) * 100) / 100,
    setupFee: 0,
    promoValue: parsed.promoValue,
    promoDuration: parsed.promoDuration,
    typicalEveningSpeed: parsed.typicalEveningSpeed,
    contractLength: 0,
    cisUrl: ORIGIN_CIS_URL,
    minimumTerm: null,
    cancellationFees: null,
    noticePeriod: null,
    downloadSpeed: parsed.downloadSpeed,
    uploadSpeed: parsed.uploadSpeed,
    networkType: parsed.networkType || 'nbn',
  };
}

// Parses Origin Energy markdown into ParsedPlan[].
// Plan headers look like: #### **Plan Name Speed/Speed**
// Prices: ~~$ongoing/month~~ then ## **$promo** then "for first N months..."
// Speeds: {N}mbps followed by "download" or "upload"
function parseOriginMarkdown(markdown: string, networkType: NetworkType): ParsedPlan[] {
  const lines = markdown.split('\n').map(l => l.trim());
  const plans: ParsedPlan[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match plan header: #### **Plan Name Network Speed/Speed**
    const headerMatch = line.match(/^####\s+\*\*(.+?)\s+(\d+)\/(\d+)\*\*$/);
    if (!headerMatch) continue;

    const name = headerMatch[1];
    const nominalDown = parseInt(headerMatch[2]);
    const nominalUp = parseInt(headerMatch[3]);

    // Skip if this doesn't look like a plan name
    if (!name.match(/nbn|Opticomm|Everyday|Experience|Enthusiast|Extra|Super|Ultra/i)) continue;

    const parsed = parseOriginPlanBlock(lines, i + 1, name, nominalDown, nominalUp, networkType);
    if (parsed) plans.push(parsed);
  }

  return plans;
}

function parseOriginPlanBlock(
  lines: string[],
  startIdx: number,
  name: string,
  nominalDown: number,
  nominalUp: number,
  networkType: NetworkType,
): ParsedPlan | null {
  let promoPrice = 0;
  let ongoingPrice = 0;
  let promoDuration = 0;
  let typicalDown: number | null = null;
  let typicalUp: number | null = null;

  const nextNonEmpty = (from: number, max: number): string => {
    for (let j = from; j < max; j++) {
      if (lines[j] !== '') return lines[j];
    }
    return '';
  };

  const endIdx = Math.min(startIdx + 50, lines.length);
  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i];
    if (line === '') continue;

    // Stop at next plan header (but not the "/month" line which is part of the current plan)
    if (line.match(/^####\s+\*\*/) && !line.includes('/month')) break;

    // Ongoing price from strikethrough: ~~$89/month~~
    const ongoingMatch = line.match(/^~~\$(\d+(?:\.\d{2})?)\/month~~$/);
    if (ongoingMatch) {
      ongoingPrice = parseFloat(ongoingMatch[1]);
      continue;
    }

    // Promo price: ## **$44.50**
    const promoMatch = line.match(/^##\s+\*\*\$(\d+(?:\.\d{2})?)\*\*$/);
    if (promoMatch) {
      promoPrice = parseFloat(promoMatch[1]);
      continue;
    }

    // Promo duration: "for first 6 months, then **$89/month** ^"
    const durationMatch = line.match(/^for first (\d+) months/);
    if (durationMatch) {
      promoDuration = parseInt(durationMatch[1]);
      continue;
    }

    // Typical evening speed download: "{N}mbps" followed by "download"
    const speedMatch = line.match(/^(\d+(?:\.\d+)?)mbps$/);
    if (speedMatch) {
      const next = nextNonEmpty(i + 1, endIdx).toLowerCase();
      if (next === 'download' && typicalDown === null) {
        typicalDown = parseFloat(speedMatch[1]);
      } else if (next === 'upload' && typicalUp === null) {
        typicalUp = parseFloat(speedMatch[1]);
      }
      continue;
    }
  }

  if (!ongoingPrice) return null;

  const promoValue = promoPrice > 0 ? ongoingPrice - promoPrice : 0;

  return {
    name,
    downloadSpeed: nominalDown,
    uploadSpeed: nominalUp,
    typicalEveningSpeed: typicalDown,
    monthlyPrice: promoPrice || ongoingPrice,
    promoValue,
    promoDuration,
    ongoingPrice,
    networkType,
  };
}

// ─── Swoop Scraper ────────────────────────────────────────────────────────────

// Scrapes Swoop NBN plans from the given URL.
export async function scrapeSwoopRaw(firecrawlApiKey: string, url: string): Promise<ParsedPlan[]> {
  console.log(`[swoop-scraper] Fetching plans from ${url} via firecrawl...`);

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: scrapeUrl,
      waitFor: 3000,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Firecrawl API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { success: boolean; data?: { markdown?: string }; error?: string };
  if (!data.success || !data.data?.markdown) {
    throw new Error(`Firecrawl scrape failed: ${data.error || 'no markdown returned'}`);
  }

  const plans = parseSwoopMarkdown(data.data.markdown);
  console.log(`[swoop-scraper] Parsed ${plans.length} plans`);
  return plans;
}

export async function scrapeSwoopPlans(firecrawlApiKey: string, url: string): Promise<NBNPlan[]> {
  const rawPlans = await scrapeSwoopRaw(firecrawlApiKey, url);
  return rawPlans.map(p => ({
    id: `swoop-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${p.downloadSpeed}-${p.uploadSpeed}`,
    providerName: 'Swoop',
    planName: `Swoop ${p.downloadSpeed}/${p.uploadSpeed}`,
    monthlyPrice: p.ongoingPrice,
    yearlyCost: Math.round(computeYearlyCost(p.monthlyPrice, p.promoValue, p.promoDuration) * 100) / 100,
    effectiveMonthly: Math.round((computeYearlyCost(p.monthlyPrice, p.promoValue, p.promoDuration) / 12) * 100) / 100,
    setupFee: 0,
    promoValue: p.promoValue,
    promoDuration: p.promoDuration,
    typicalEveningSpeed: p.typicalEveningSpeed,
    contractLength: 0,
    cisUrl: SWOOP_URL,
    minimumTerm: null,
    cancellationFees: null,
    noticePeriod: null,
    downloadSpeed: p.downloadSpeed,
    uploadSpeed: p.uploadSpeed,
    networkType: 'nbn',
  }));
}

// Parses Swoop markdown. Pattern per plan:
// {dl}/{ul} Mbps
// Typical evening speed (7pm-11pm)
// {dl} Mbps **Download**
// {ul} Mbps **Upload**
// ${ongoing}${promo}   (concatenated, e.g. "$69$54")
// **per** **month**
// ${discount}/mth off for {duration} months
function parseSwoopMarkdown(markdown: string): ParsedPlan[] {
  const lines = markdown.split('\n').map(l => l.trim());
  const plans: ParsedPlan[] = [];

  for (let i = 0; i < lines.length; i++) {
    // Match speed header: "25/10 Mbps" or "500/50 Mbps" or "1000/100 Mbps"
    const speedMatch = lines[i].match(/^(\d+)\/(\d+) Mbps$/);
    if (!speedMatch) continue;

    const downloadSpeed = parseInt(speedMatch[1]);
    const uploadSpeed = parseInt(speedMatch[2]);

    // Parse the block after this header
    const parsed = parseSwoopPlanBlock(lines, i + 1, downloadSpeed, uploadSpeed);
    if (parsed) plans.push(parsed);
  }

  return plans;
}

function parseSwoopPlanBlock(
  lines: string[],
  startIdx: number,
  downloadSpeed: number,
  uploadSpeed: number,
): ParsedPlan | null {
  let typicalDown: number | null = null;
  let typicalUp: number | null = null;
  let ongoingPrice = 0;
  let promoPrice = 0;
  let promoValue = 0;
  let promoDuration = 0;

  const nextNonEmpty = (from: number, max: number): string => {
    for (let j = from; j < max; j++) {
      if (lines[j] !== '') return lines[j];
    }
    return '';
  };

  const endIdx = Math.min(startIdx + 40, lines.length);
  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i];
    if (line === '') continue;

    // Stop at next plan's speed header
    if (line.match(/^\d+\/\d+ Mbps$/)) break;

    // Typical evening speed: bare number followed by Mbps then **Download** or **Upload**
    const numMatch = line.match(/^(\d+)$/);
    if (numMatch) {
      const next1 = nextNonEmpty(i + 1, endIdx);
      const next2 = nextNonEmpty(i + 2, endIdx);
      if (next1 === 'Mbps' && next2 === '**Download**' && typicalDown === null) {
        typicalDown = parseInt(numMatch[1]);
        continue;
      }
      if (next1 === 'Mbps' && next2 === '**Upload**' && typicalUp === null) {
        typicalUp = parseInt(numMatch[1]);
        continue;
      }
    }

    // Price: "$69$54" (ongoing then promo concatenated)
    const priceMatch = line.match(/^\$(\d+(?:\.\d{2})?)\$(\d+(?:\.\d{2})?)$/);
    if (priceMatch) {
      ongoingPrice = parseFloat(priceMatch[1]);
      promoPrice = parseFloat(priceMatch[2]);
      continue;
    }

    // Discount: "$15/mth off for 6 months"
    const discountMatch = line.match(/^\$(\d+)\/mth off for (\d+) months$/);
    if (discountMatch) {
      promoValue = parseFloat(discountMatch[1]);
      promoDuration = parseInt(discountMatch[2]);
      continue;
    }
  }

  if (!ongoingPrice) return null;

  // If no separate promo info, derive from prices
  if (!promoValue && promoPrice && promoPrice < ongoingPrice) {
    promoValue = ongoingPrice - promoPrice;
  }

  return {
    name: `NBN ${downloadSpeed}/${uploadSpeed}`,
    downloadSpeed,
    uploadSpeed,
    typicalEveningSpeed: typicalDown,
    monthlyPrice: promoPrice || ongoingPrice,
    promoValue,
    promoDuration,
    ongoingPrice,
    networkType: 'nbn',
  };
}
