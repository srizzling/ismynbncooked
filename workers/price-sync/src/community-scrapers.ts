import type { NBNPlan } from './types';

const CIS_URL = 'https://leaptel.com.au/wp-content/uploads/NBN-CIS-v25.6.pdf';
const PLAN_URL = 'https://leaptel.com.au/plans/';

/**
 * Scrapes all Leaptel NBN plans via firecrawl's scrape API.
 * Clicks the "All plans" tab to reveal plans not shown by default.
 */
export async function scrapeLeaptelPlans(firecrawlApiKey: string): Promise<NBNPlan[]> {
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

  const plans = parseLeaptelMarkdown(data.data.markdown);
  console.log(`[leaptel-scraper] Parsed ${plans.length} plans`);
  return plans;
}

interface ParsedPlan {
  name: string;
  downloadSpeed: number;
  uploadSpeed: number;
  typicalEveningSpeed: number | null;
  monthlyPrice: number;       // promo price
  promoValue: number;         // discount amount per month
  promoDuration: number;      // months
  ongoingPrice: number;       // full price after promo
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
function parseLeaptelMarkdown(markdown: string): NBNPlan[] {
  const lines = markdown.split('\n').map(l => l.trim());
  const plans: NBNPlan[] = [];

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

    const yearlyCost = computeYearlyCost(parsed.monthlyPrice, parsed.promoValue, parsed.promoDuration);

    plans.push({
      id: `leaptel-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${parsed.downloadSpeed}-${parsed.uploadSpeed}`,
      providerName: 'Leaptel',
      planName: `Leaptel ${name}`,
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
    });
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
