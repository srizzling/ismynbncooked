/**
 * Migration script: ptrckr API → ismynbncooked history JSON → R2
 *
 * Fetches historical snapshot data from ptrckr's API and transforms it
 * into the history format used by ismynbncooked, then uploads to R2.
 *
 * Prerequisites:
 *   - ptrckr running at PTRCKR_URL (default http://localhost:3000)
 *   - wrangler authenticated for R2 uploads
 *
 * Usage:
 *   npx tsx scripts/migrate-ptrckr.ts                    # write to ./output/
 *   npx tsx scripts/migrate-ptrckr.ts --upload            # write + upload to R2
 *   PTRCKR_URL=http://host:3000 npx tsx scripts/migrate-ptrckr.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// --- Config ---
const PTRCKR_URL = process.env.PTRCKR_URL ?? 'http://localhost:3000';
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const UPLOAD = process.argv.includes('--upload');

const SPEED_TIERS = [25, 50, 100, 250, 500, 750, 1000, 2000] as const;
type SpeedTier = (typeof SPEED_TIERS)[number];

// --- Types ---
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

interface PtrckrSnapshot {
  id: number;
  watchedSpeedId: number;
  providerName: string;
  planName: string;
  monthlyPrice: number;
  promoValue: number | null;
  promoDuration: number | null;
  yearlyCost: number;
  setupFee: number;
  typicalEveningSpeed: number | null;
  cisUrl: string | null;
  scrapedAt: string; // ISO timestamp
}

interface PtrckrWatchedSpeed {
  id: number;
  speed: number;
  label: string;
  snapshots: PtrckrSnapshot[];
}

// --- Helpers ---
function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function writeJSON(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`  ✓ ${path}`);
}

function snapshotDate(scrapedAt: string): string {
  return new Date(scrapedAt).toISOString().split('T')[0];
}

async function fetchJSON<T>(path: string): Promise<T> {
  const url = `${PTRCKR_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json() as Promise<T>;
}

// --- Main ---
console.log(`\nMigrating from ptrckr at: ${PTRCKR_URL}\n`);

ensureDir(join(OUTPUT_DIR, 'history'));

// 1. Fetch all watched speeds with full snapshot history
console.log('Fetching snapshot data from ptrckr API...');
const { speeds } = await fetchJSON<{ speeds: PtrckrWatchedSpeed[] }>('/api/nbn/snapshots');

const speedMap = new Map<number, PtrckrWatchedSpeed>();
for (const s of speeds) {
  speedMap.set(s.speed, s);
}
console.log(`Found ${speeds.length} watched tiers: ${speeds.map(s => s.speed).join(', ')}\n`);

// 2. Transform snapshots → history format
console.log('--- Building history files ---');
for (const speed of SPEED_TIERS) {
  const watched = speedMap.get(speed);
  if (!watched || watched.snapshots.length === 0) {
    console.log(`  NBN ${speed}: no data, skipping`);
    continue;
  }

  const snapshots = watched.snapshots;

  // Sort oldest first
  snapshots.sort((a, b) => new Date(a.scrapedAt).getTime() - new Date(b.scrapedAt).getTime());

  // Build provider history
  const providerMap = new Map<string, {
    current: { monthlyPrice: number; planName: string; yearlyCost: number };
    history: { date: string; monthlyPrice: number; yearlyCost: number }[];
  }>();

  // Build daily summaries by grouping snapshots by date
  const dailyMap = new Map<string, { prices: number[]; count: number }>();

  for (const snap of snapshots) {
    const date = snapshotDate(snap.scrapedAt);

    // Provider history
    if (!providerMap.has(snap.providerName)) {
      providerMap.set(snap.providerName, {
        current: { monthlyPrice: 0, planName: '', yearlyCost: 0 },
        history: [],
      });
    }
    const prov = providerMap.get(snap.providerName)!;
    prov.current = {
      monthlyPrice: snap.monthlyPrice,
      planName: snap.planName,
      yearlyCost: snap.yearlyCost,
    };

    // Only add one entry per day per provider
    const lastEntry = prov.history[prov.history.length - 1];
    if (!lastEntry || lastEntry.date !== date) {
      prov.history.push({
        date,
        monthlyPrice: snap.monthlyPrice,
        yearlyCost: snap.yearlyCost,
      });
    }

    // Daily summary
    if (!dailyMap.has(date)) dailyMap.set(date, { prices: [], count: 0 });
    const day = dailyMap.get(date)!;
    day.prices.push(snap.monthlyPrice);
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

  const weeklyMap = new Map<string, DailySummary>();
  for (const entry of older) {
    const d = new Date(entry.date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().split('T')[0];
    if (!weeklyMap.has(key)) weeklyMap.set(key, entry);
  }

  const rolledDaily = [...weeklyMap.values(), ...recent].sort((a, b) => a.date.localeCompare(b.date));

  // Limit to top 20 providers by cheapest current price
  const topProviders = [...providerMap.entries()]
    .sort((a, b) => a[1].current.monthlyPrice - b[1].current.monthlyPrice)
    .slice(0, 20);

  const history: TierHistory = {
    providers: Object.fromEntries(topProviders),
    daily: rolledDaily,
  };

  const filePath = join(OUTPUT_DIR, 'history', `nbn-${speed}.json`);
  writeJSON(filePath, history);
  console.log(`  NBN ${speed}: ${snapshots.length} snapshots, ${daily.length} days, ${providerMap.size} providers`);
}

// 3. Upload to R2 if --upload flag
if (UPLOAD) {
  console.log('\n--- Uploading to R2 ---');
  for (const speed of SPEED_TIERS) {
    const filePath = join(OUTPUT_DIR, 'history', `nbn-${speed}.json`);
    try {
      const r2Key = `ismynbncooked-data/data/history/nbn-${speed}.json`;
      execSync(`wrangler r2 object put ${r2Key} --file ${filePath} --content-type application/json`, {
        stdio: 'inherit',
      });
    } catch {
      console.log(`  Skipping NBN ${speed} (no file)`);
    }
  }
}

console.log(`\n✅ Migration complete! Output in: ${OUTPUT_DIR}`);
if (!UPLOAD) {
  console.log('\nTo upload to R2, re-run with --upload:');
  console.log('  npx tsx scripts/migrate-ptrckr.ts --upload');
}
