/**
 * One-time migration script: ptrckr SQLite → ismynbncooked JSON
 *
 * Reads ptrckr's SQLite DB and exports:
 * - nbnSpeedSnapshots → data/history/nbn-{speed}.json
 * - nbnPlansCache → data/plans/nbn-{speed}.json
 * - nbnCisExtractions → data/terms/terms.json
 *
 * Output files are written to ./output/ ready for R2 upload via:
 *   wrangler r2 object put ismynbncooked-data/data/plans/nbn-100.json --file output/plans/nbn-100.json
 */

import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// --- Config ---
const PTRCKR_DB_PATH = process.env.PTRCKR_DB ?? join(import.meta.dirname, '../../ptrckr/data/ptrckr.db');
const OUTPUT_DIR = join(import.meta.dirname, 'output');

const SPEED_TIERS = [25, 50, 100, 250, 500, 750, 1000] as const;
type SpeedTier = (typeof SPEED_TIERS)[number];

const TIER_LABELS: Record<SpeedTier, string> = {
  25: 'NBN 25 (25/5 Mbps)',
  50: 'NBN 50 (50/20 Mbps)',
  100: 'NBN 100 (100/20 Mbps)',
  250: 'NBN 250 (250/25 Mbps)',
  500: 'NBN 500 (500/50 Mbps)',
  750: 'NBN 750 (750/50 Mbps)',
  1000: 'NBN 1000 (1000/50 Mbps)',
};

// --- Types ---
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
}

interface TierData {
  speed: SpeedTier;
  label: string;
  updatedAt: string;
  planCount: number;
  cheapest: number;
  average: number;
  plans: NBNPlan[];
}

interface DailySummary {
  date: string;
  cheapestPrice: number;
  averagePrice: number;
  planCount: number;
}

interface TierHistory {
  providers: Record<string, {
    current: { monthlyPrice: number; planName: string; yearlyCost: number };
    history: { date: string; monthlyPrice: number; yearlyCost: number }[];
  }>;
  daily: DailySummary[];
}

interface TermsEntry {
  minimumTerm: string | null;
  cancellationFees: string | null;
  noticePeriod: string | null;
  extractedAt: string;
}

// --- Helpers ---
function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function writeJSON(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`  ✓ ${path}`);
}

function tsToISO(ts: number | null): string {
  if (!ts) return new Date().toISOString();
  // ptrckr stores timestamps as Unix seconds (Drizzle timestamp mode)
  return new Date(ts * 1000).toISOString();
}

function tsToDate(ts: number | null): string {
  if (!ts) return new Date().toISOString().split('T')[0];
  return new Date(ts * 1000).toISOString().split('T')[0];
}

// --- Main ---
console.log(`\nMigrating ptrckr data from: ${PTRCKR_DB_PATH}\n`);

const db = new Database(PTRCKR_DB_PATH, { readonly: true });

// Set up output dirs
ensureDir(join(OUTPUT_DIR, 'plans'));
ensureDir(join(OUTPUT_DIR, 'history'));
ensureDir(join(OUTPUT_DIR, 'terms'));

// 1. Get watched speed → ID mapping
const watchedSpeeds = db.prepare('SELECT id, speed FROM watched_nbn_speeds').all() as { id: number; speed: number }[];
const speedIdMap = new Map<number, number>(); // speed → id
for (const ws of watchedSpeeds) {
  speedIdMap.set(ws.speed, ws.id);
}
console.log(`Found ${watchedSpeeds.length} watched speed tiers: ${watchedSpeeds.map(w => w.speed).join(', ')}\n`);

// 2. Export CIS extractions → terms.json
console.log('--- Exporting CIS extractions ---');
const cisRows = db.prepare(
  `SELECT cis_url, provider_name, minimum_term, cancellation_fees, notice_period, extracted_at
   FROM nbn_cis_extractions WHERE status = 'success'`
).all() as {
  cis_url: string;
  provider_name: string;
  minimum_term: string | null;
  cancellation_fees: string | null;
  notice_period: string | null;
  extracted_at: number | null;
}[];

const terms: Record<string, TermsEntry> = {};
for (const row of cisRows) {
  terms[row.cis_url] = {
    minimumTerm: row.minimum_term,
    cancellationFees: row.cancellation_fees,
    noticePeriod: row.notice_period,
    extractedAt: tsToISO(row.extracted_at),
  };
}
writeJSON(join(OUTPUT_DIR, 'terms', 'terms.json'), terms);
console.log(`  ${Object.keys(terms).length} CIS term entries\n`);

// 3. Export plans cache → plans/nbn-{speed}.json
console.log('--- Exporting plans cache ---');
for (const speed of SPEED_TIERS) {
  const cacheRows = db.prepare(
    `SELECT plan_data, provider_name, plan_name, monthly_price, yearly_cost, cached_at
     FROM nbn_plans_cache WHERE speed_tier = ? ORDER BY monthly_price ASC`
  ).all(speed) as {
    plan_data: string;
    provider_name: string;
    plan_name: string;
    monthly_price: number;
    yearly_cost: number;
    cached_at: number;
  }[];

  if (cacheRows.length === 0) {
    console.log(`  NBN ${speed}: no cached plans, skipping`);
    continue;
  }

  const plans: NBNPlan[] = cacheRows.map((row, idx) => {
    let parsed: any = {};
    try {
      parsed = JSON.parse(row.plan_data);
    } catch {}

    const monthlyPrice = row.monthly_price;
    const setupFee = parsed.setup_fee ?? 0;
    const promoValue = parsed.promo_value ?? null;
    const promoDuration = parsed.promo_duration ?? null;
    const contractLength = parsed.contract_length ?? 0;

    // Compute costs
    const promoMonths = Math.min(promoDuration ?? 0, 12);
    const fullMonths = 12 - promoMonths;
    const yearlyCost = promoMonths * (monthlyPrice - (promoValue ?? 0)) + fullMonths * monthlyPrice + setupFee;
    const effectiveMonthly = yearlyCost / 12;

    // Look up terms
    const cisUrl = parsed.cis_url ?? '';
    const t = terms[cisUrl];

    return {
      id: parsed.id?.toString() ?? `cache-${speed}-${idx}`,
      providerName: row.provider_name,
      planName: row.plan_name,
      monthlyPrice,
      yearlyCost: Math.round(yearlyCost * 100) / 100,
      effectiveMonthly: Math.round(effectiveMonthly * 100) / 100,
      setupFee,
      promoValue,
      promoDuration,
      typicalEveningSpeed: parsed.typical_evening_speed ?? null,
      contractLength,
      cisUrl,
      minimumTerm: t?.minimumTerm ?? null,
      cancellationFees: t?.cancellationFees ?? null,
      noticePeriod: t?.noticePeriod ?? null,
    };
  });

  const cheapest = Math.min(...plans.map(p => p.monthlyPrice));
  const average = Math.round((plans.reduce((s, p) => s + p.monthlyPrice, 0) / plans.length) * 100) / 100;

  const tierData: TierData = {
    speed: speed as SpeedTier,
    label: TIER_LABELS[speed as SpeedTier],
    updatedAt: tsToISO(cacheRows[0].cached_at),
    planCount: plans.length,
    cheapest,
    average,
    plans,
  };

  writeJSON(join(OUTPUT_DIR, 'plans', `nbn-${speed}.json`), tierData);
  console.log(`  NBN ${speed}: ${plans.length} plans, cheapest $${cheapest}`);
}
console.log();

// 4. Export speed snapshots → history/nbn-{speed}.json
console.log('--- Exporting speed snapshots to history ---');
for (const speed of SPEED_TIERS) {
  const watchedId = speedIdMap.get(speed);
  if (!watchedId) {
    console.log(`  NBN ${speed}: not watched, skipping`);
    continue;
  }

  const snapshots = db.prepare(
    `SELECT provider_name, plan_name, monthly_price, yearly_cost, scraped_at
     FROM nbn_speed_snapshots WHERE watched_speed_id = ?
     ORDER BY scraped_at ASC`
  ).all(watchedId) as {
    provider_name: string;
    plan_name: string;
    monthly_price: number;
    yearly_cost: number;
    scraped_at: number;
  }[];

  if (snapshots.length === 0) {
    console.log(`  NBN ${speed}: no snapshots, skipping`);
    continue;
  }

  // Build provider history
  const providerMap = new Map<string, {
    current: { monthlyPrice: number; planName: string; yearlyCost: number };
    history: { date: string; monthlyPrice: number; yearlyCost: number }[];
  }>();

  // Build daily summaries by grouping snapshots by date
  const dailyMap = new Map<string, { prices: number[]; count: number }>();

  for (const snap of snapshots) {
    const date = tsToDate(snap.scraped_at);

    // Provider history
    if (!providerMap.has(snap.provider_name)) {
      providerMap.set(snap.provider_name, {
        current: { monthlyPrice: 0, planName: '', yearlyCost: 0 },
        history: [],
      });
    }
    const prov = providerMap.get(snap.provider_name)!;
    prov.current = {
      monthlyPrice: snap.monthly_price,
      planName: snap.plan_name,
      yearlyCost: snap.yearly_cost,
    };

    // Only add one entry per day per provider
    const lastEntry = prov.history[prov.history.length - 1];
    if (!lastEntry || lastEntry.date !== date) {
      prov.history.push({
        date,
        monthlyPrice: snap.monthly_price,
        yearlyCost: snap.yearly_cost,
      });
    }

    // Daily summary
    if (!dailyMap.has(date)) dailyMap.set(date, { prices: [], count: 0 });
    const day = dailyMap.get(date)!;
    day.prices.push(snap.monthly_price);
    day.count++;
  }

  // Build daily array
  const daily: DailySummary[] = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { prices, count }]) => ({
      date,
      cheapestPrice: Math.round(Math.min(...prices) * 100) / 100,
      averagePrice: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
      planCount: count,
    }));

  // Keep 90 days daily, weekly rollup for older
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
  const recent = daily.filter(d => d.date >= ninetyDaysAgo);
  const older = daily.filter(d => d.date < ninetyDaysAgo);

  const weeklyMap2 = new Map<string, DailySummary>();
  for (const entry of older) {
    const d = new Date(entry.date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().split('T')[0];
    if (!weeklyMap2.has(key)) weeklyMap2.set(key, entry);
  }

  const rolledDaily = [...weeklyMap2.values(), ...recent].sort((a, b) => a.date.localeCompare(b.date));

  // Limit to top 20 providers by cheapest current price
  const topProviders = [...providerMap.entries()]
    .sort((a, b) => a[1].current.monthlyPrice - b[1].current.monthlyPrice)
    .slice(0, 20);

  const history: TierHistory = {
    providers: Object.fromEntries(topProviders),
    daily: rolledDaily,
  };

  writeJSON(join(OUTPUT_DIR, 'history', `nbn-${speed}.json`), history);
  console.log(`  NBN ${speed}: ${snapshots.length} snapshots, ${daily.length} days, ${providerMap.size} providers`);
}

// 5. Export meta
writeJSON(join(OUTPUT_DIR, 'meta.json'), {
  lastPriceSync: new Date().toISOString(),
  lastTermsSync: new Date().toISOString(),
  lastComparisonSync: new Date().toISOString(),
});

// 6. Export comparisons (default values)
writeJSON(join(OUTPUT_DIR, 'comparisons.json'), {
  updatedAt: new Date().toISOString(),
  units: {
    flatWhite:    { label: 'Flat Whites',           icon: '☕', price: 5.50,   per: 'month' },
    avo:          { label: 'Avocados',              icon: '🥑', price: 3.50,   per: 'month' },
    bunnings:     { label: 'Bunnings Snags',        icon: '🌭', price: 3.50,   per: 'month' },
    petrol:       { label: 'Litres of Petrol',      icon: '⛽', price: 2.10,   per: 'month' },
    opalTrip:     { label: 'Opal Card Trips',       icon: '🚂', price: 4.80,   per: 'month' },
    netflix:      { label: 'Netflix Months',        icon: '📺', price: 18.99,  per: 'month' },
    houseDeposit: { label: 'Years to a 5% Deposit', icon: '🏠', price: 44000,  per: 'total', note: '5% of $880k median' },
  },
});

db.close();
console.log(`\n✅ Migration complete! Output in: ${OUTPUT_DIR}`);
console.log('\nTo upload to R2:');
console.log('  for f in output/**/*.json; do');
console.log('    wrangler r2 object put ismynbncooked-data/data/${f#output/} --file "$f"');
console.log('  done');
