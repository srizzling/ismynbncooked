/**
 * Seed local dev data by fetching from NetBargains API.
 *
 * Usage:
 *   NETBARGAINS_API_KEY=xxx npx tsx scripts/seed-dev-data.ts
 *
 * Writes manifest + per-tier JSON files to site/public/data/
 */

const API_BASE = 'https://api.netbargains.com.au/v1';
const PAGE_SIZE = 50;
const DELAY_MS = 500;
const DOWNLOAD_SPEEDS = [25, 50, 100, 250, 500, 750, 1000, 2000];
const OUTPUT_DIR = new URL('../site/public/data', import.meta.url).pathname;

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

type NetworkType = 'nbn' | 'opticomm';

interface NetBargainsPlan {
  id: string;
  provider_name: string;
  plan_name: string;
  download_speed: number;
  upload_speed: number;
  typical_evening_speed: number | null;
  network_type: string;
  monthly_price: number;
  setup_fee: number;
  contract_length: number;
  promo_value: number | null;
  promo_duration: number | null;
  cis_url: string;
  [key: string]: unknown;
}

interface NBNPlan {
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

const apiKey = process.env.NETBARGAINS_API_KEY;
if (!apiKey) {
  console.error('Error: NETBARGAINS_API_KEY env var required');
  console.error('Usage: NETBARGAINS_API_KEY=xxx npx tsx scripts/seed-dev-data.ts');
  process.exit(1);
}

function normalizeNetworkType(raw: string): NetworkType {
  return raw.toLowerCase() === 'opticomm' ? 'opticomm' : 'nbn';
}

function transformPlan(raw: NetBargainsPlan): NBNPlan {
  const monthlyPrice = raw.monthly_price;
  const promoValue = raw.promo_value ?? 0;
  const promoDuration = raw.promo_duration ?? 0;
  const promoMonths = Math.min(promoDuration, 12);
  const fullMonths = 12 - promoMonths;
  const yearlyCost = promoMonths * (monthlyPrice - promoValue) + fullMonths * monthlyPrice + raw.setup_fee;
  const effectiveMonthly = yearlyCost / 12;

  return {
    id: raw.id,
    providerName: raw.provider_name,
    planName: raw.plan_name,
    monthlyPrice,
    yearlyCost: Math.round(yearlyCost * 100) / 100,
    effectiveMonthly: Math.round(effectiveMonthly * 100) / 100,
    setupFee: raw.setup_fee,
    promoValue: raw.promo_value,
    promoDuration: raw.promo_duration,
    typicalEveningSpeed: raw.typical_evening_speed,
    contractLength: raw.contract_length,
    cisUrl: raw.cis_url,
    minimumTerm: null,
    cancellationFees: null,
    noticePeriod: null,
    downloadSpeed: raw.download_speed,
    uploadSpeed: raw.upload_speed,
    networkType: normalizeNetworkType(raw.network_type),
  };
}

function buildTierKey(network: NetworkType, download: number, upload: number): string {
  return `${network}-${download}-${upload}`;
}

function buildTierLabel(network: NetworkType, download: number, upload: number): string {
  const prefix = network === 'nbn' ? 'NBN' : 'Opticomm';
  return `${prefix} ${download}/${upload}`;
}

async function fetchPlans(speed: number): Promise<NetBargainsPlan[]> {
  const allPlans: NetBargainsPlan[] = [];
  let skip = 0;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore) {
    if (pageCount > 0) await new Promise(r => setTimeout(r, DELAY_MS));

    const url = new URL(`${API_BASE}/plans/latest`);
    url.searchParams.set('speed', speed.toString());
    url.searchParams.set('connection_type', 'FIXED_LINE');
    url.searchParams.append('network_type', 'NBN');
    url.searchParams.append('network_type', 'OPTICOMM');
    url.searchParams.set('skip', skip.toString());
    url.searchParams.set('limit', PAGE_SIZE.toString());
    url.searchParams.set('sort_by', 'monthly_price');
    url.searchParams.set('sort_order', 'asc');

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'ismynbncooked-dev-seed/1.0',
      },
    });

    if (!res.ok) {
      throw new Error(`API error for speed=${speed}: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as { items: NetBargainsPlan[]; has_more: boolean; total: number };
    allPlans.push(...data.items);
    hasMore = data.has_more;
    skip += PAGE_SIZE;
    pageCount++;

    console.log(`  ${speed} Mbps page ${pageCount}: ${data.items.length} plans (${allPlans.length}/${data.total})`);
  }

  return allPlans;
}

async function main() {
  console.log('Seeding dev data from NetBargains API...\n');

  const plansDir = join(OUTPUT_DIR, 'plans');
  if (!existsSync(plansDir)) mkdirSync(plansDir, { recursive: true });

  const allTierGroups = new Map<string, NBNPlan[]>();

  for (const speed of DOWNLOAD_SPEEDS) {
    console.log(`Fetching ${speed} Mbps...`);
    try {
      const rawPlans = await fetchPlans(speed);
      const plans = rawPlans.map(transformPlan);

      for (const plan of plans) {
        const key = buildTierKey(plan.networkType, plan.downloadSpeed, plan.uploadSpeed);
        const group = allTierGroups.get(key);
        if (group) group.push(plan);
        else allTierGroups.set(key, [plan]);
      }

      console.log(`  → ${plans.length} plans across ${new Set(plans.map(p => buildTierKey(p.networkType, p.downloadSpeed, p.uploadSpeed))).size} tier(s)\n`);
    } catch (err) {
      console.error(`  Failed: ${err}\n`);
    }
  }

  // Write per-tier files
  const manifestTiers: { key: string; network: NetworkType; downloadSpeed: number; uploadSpeed: number; label: string }[] = [];

  for (const [tierKey, plans] of allTierGroups) {
    plans.sort((a, b) => a.monthlyPrice - b.monthlyPrice);
    const first = plans[0];
    const cheapest = plans[0].monthlyPrice;
    const average = Math.round((plans.reduce((s, p) => s + p.monthlyPrice, 0) / plans.length) * 100) / 100;

    const tierData = {
      tierKey,
      network: first.networkType,
      downloadSpeed: first.downloadSpeed,
      uploadSpeed: first.uploadSpeed,
      label: buildTierLabel(first.networkType, first.downloadSpeed, first.uploadSpeed),
      updatedAt: new Date().toISOString(),
      planCount: plans.length,
      cheapest,
      average,
      plans,
    };

    const filePath = join(plansDir, `${tierKey}.json`);
    writeFileSync(filePath, JSON.stringify(tierData));
    console.log(`  ${tierKey}: ${plans.length} plans, cheapest $${cheapest} → ${filePath}`);

    manifestTiers.push({
      key: tierKey,
      network: first.networkType,
      downloadSpeed: first.downloadSpeed,
      uploadSpeed: first.uploadSpeed,
      label: buildTierLabel(first.networkType, first.downloadSpeed, first.uploadSpeed),
    });
  }

  // Sort manifest: NBN first, then by download, then upload
  manifestTiers.sort((a, b) => {
    if (a.network !== b.network) return a.network === 'nbn' ? -1 : 1;
    if (a.downloadSpeed !== b.downloadSpeed) return a.downloadSpeed - b.downloadSpeed;
    return a.uploadSpeed - b.uploadSpeed;
  });

  const manifest = {
    updatedAt: new Date().toISOString(),
    tiers: manifestTiers,
  };

  const manifestPath = join(OUTPUT_DIR, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\nManifest: ${manifestTiers.length} tiers → ${manifestPath}`);
  console.log('\nDone! Restart dev server to pick up new data.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
