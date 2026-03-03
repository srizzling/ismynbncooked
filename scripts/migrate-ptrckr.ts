/**
 * One-time migration script: ptrckr SQLite → ismynbncooked history JSON
 *
 * Reads ptrckr's SQLite DB and exports speed snapshots to history files.
 * Only history data is exported — the price-sync worker handles fresh plans,
 * terms, comparisons, and meta.
 *
 * Output files are written to ./output/ ready for R2 upload via:
 *   wrangler r2 object put ismynbncooked-data/data/history/nbn-100.json --file output/history/nbn-100.json
 */

import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// --- Config ---
const PTRCKR_DB_PATH = process.env.PTRCKR_DB ?? join(import.meta.dirname, '../../ptrckr/data/ptrckr.db');
const OUTPUT_DIR = join(import.meta.dirname, 'output');

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

// --- Helpers ---
function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function writeJSON(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`  ✓ ${path}`);
}

function tsToDate(ts: number | null): string {
  if (!ts) return new Date().toISOString().split('T')[0];
  return new Date(ts * 1000).toISOString().split('T')[0];
}

// --- Main ---
console.log(`\nMigrating ptrckr history data from: ${PTRCKR_DB_PATH}\n`);

const db = new Database(PTRCKR_DB_PATH, { readonly: true });

// Set up output dirs
ensureDir(join(OUTPUT_DIR, 'history'));

// 1. Get watched speed → ID mapping
const watchedSpeeds = db.prepare('SELECT id, speed FROM watched_nbn_speeds').all() as { id: number; speed: number }[];
const speedIdMap = new Map<number, number>(); // speed → id
for (const ws of watchedSpeeds) {
  speedIdMap.set(ws.speed, ws.id);
}
console.log(`Found ${watchedSpeeds.length} watched speed tiers: ${watchedSpeeds.map(w => w.speed).join(', ')}\n`);

// 2. Export speed snapshots → history/nbn-{speed}.json
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

  writeJSON(join(OUTPUT_DIR, 'history', `nbn-${speed}.json`), history);
  console.log(`  NBN ${speed}: ${snapshots.length} snapshots, ${daily.length} days, ${providerMap.size} providers`);
}

db.close();
console.log(`\n✅ Migration complete! Output in: ${OUTPUT_DIR}`);
console.log('\nTo upload history to R2:');
console.log('  for f in output/history/*.json; do');
console.log('    wrangler r2 object put ismynbncooked-data/data/history/$(basename "$f") --file "$f"');
console.log('  done');
