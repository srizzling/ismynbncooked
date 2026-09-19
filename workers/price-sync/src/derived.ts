/**
 * Derived data written after each sync:
 *   data/providers/index.json, data/providers/{slug}.json   (provider pages)
 *   data/reports/index.json,   data/reports/{YYYY-MM}.json  (monthly price reports)
 */
import type {
  NBNPlan, TierData, TierHistory, HistoryEntry, NetworkType,
  ProviderData, ProviderIndex, ProviderIndexEntry, ProviderTierEntry,
  MonthlyReport, ReportIndex, ReportIndexEntry, ReportTier, ReportPriceChange,
} from './types';
import { summariseRort } from './cooked';

export function slugifyProvider(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const JSON_META = { httpMetadata: { contentType: 'application/json' } };

// ─── Provider files ──────────────────────────────────────────────────────────

export async function buildProviderFiles(
  bucket: R2Bucket,
  tiers: { data: TierData; history: TierHistory }[],
): Promise<number> {
  const updatedAt = new Date().toISOString();
  const byProvider = new Map<string, ProviderData>();

  for (const { data, history } of tiers) {
    // plans are already sorted by monthly price; rank = position of the provider's cheapest plan
    const seen = new Set<string>();
    data.plans.forEach((plan, i) => {
      if (seen.has(plan.providerName)) return;
      seen.add(plan.providerName);

      const slug = slugifyProvider(plan.providerName);
      let entry = byProvider.get(slug);
      if (!entry) {
        entry = { slug, name: plan.providerName, website: plan.providerWebsite ?? null, updatedAt, planCount: 0, tiers: [], rort: null };
        byProvider.set(slug, entry);
      }
      if (!entry.website && plan.providerWebsite) entry.website = plan.providerWebsite;

      const h = history.providers[plan.providerName];
      const tierEntry: ProviderTierEntry = {
        tierKey: data.tierKey,
        label: data.label,
        network: data.network,
        downloadSpeed: data.downloadSpeed,
        uploadSpeed: data.uploadSpeed,
        plan,
        rank: i + 1,
        planCount: data.planCount,
        tierCheapest: data.cheapest,
        tierAverage: data.average,
        history: h?.history ?? [],
        lastSeen: h?.current.lastSeen,
      };
      entry.tiers.push(tierEntry);
    });
    for (const plan of data.plans) {
      const entry = byProvider.get(slugifyProvider(plan.providerName));
      if (entry) entry.planCount++;
    }
  }

  const index: ProviderIndexEntry[] = [];
  for (const entry of byProvider.values()) {
    entry.tiers.sort((a, b) =>
      a.network.localeCompare(b.network) || a.downloadSpeed - b.downloadSpeed || a.uploadSpeed - b.uploadSpeed);
    entry.rort = summariseRort(entry.tiers.map(t => t.tierCheapest > 0 ? (t.plan.monthlyPrice - t.tierCheapest) / t.tierCheapest : 0));
    await bucket.put(`data/providers/${entry.slug}.json`, JSON.stringify(entry), JSON_META);
    index.push({
      slug: entry.slug,
      name: entry.name,
      website: entry.website,
      planCount: entry.planCount,
      tierCount: entry.tiers.length,
      cheapest: Math.min(...entry.tiers.map(t => t.plan.monthlyPrice)),
      networks: [...new Set(entry.tiers.map(t => t.network))] as NetworkType[],
      rortLevel: entry.rort?.level,
      rortLabel: entry.rort?.label,
      medianOverpay: entry.rort?.medianOverpay,
    });
  }
  index.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const providerIndex: ProviderIndex = { updatedAt, providers: index };
  await bucket.put('data/providers/index.json', JSON.stringify(providerIndex), JSON_META);
  return index.length;
}

// ─── Monthly reports ─────────────────────────────────────────────────────────

/**
 * Date the worker started tracking every provider's price (before this only the 20
 * cheapest per tier were tracked). First sightings on this date are not "new
 * providers", and a price difference recorded on this date against an entry from
 * before the gap cannot be dated, so it is left out of rises/drops.
 */
const FULL_TRACKING_SINCE = '2026-09-19';

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildReportForMonth(
  month: string,
  tiers: { data: TierData; history: TierHistory }[],
  today: string,
): MonthlyReport | null {
  const reportTiers: ReportTier[] = [];

  for (const { data, history } of tiers) {
    const daily = history.daily.filter(d => monthOf(d.date) === month).sort((a, b) => a.date.localeCompare(b.date));
    if (daily.length === 0) continue;
    const first = daily[0];
    const last = daily[daily.length - 1];

    // Was there any tracking before this month? Needed so the very first sync
    // of a provider isn't reported as "new" when tracking itself is new.
    const trackedBefore = history.daily.some(d => d.date < `${month}-01`);

    const changes: ReportPriceChange[] = [];
    const newProviders: string[] = [];
    const goneProviders: string[] = [];
    const currentProviders = new Set(data.plans.map(p => p.providerName));

    for (const [provider, entry] of Object.entries(history.providers)) {
      const h: HistoryEntry[] = entry.history;
      if (h.length === 0) continue;

      // Before full tracking, a first sighting usually just means the provider entered the 20 cheapest
      if (monthOf(h[0].date) === month && trackedBefore && h[0].date > first.date && h[0].date > FULL_TRACKING_SINCE) {
        newProviders.push(provider);
      }

      for (let i = 1; i < h.length; i++) {
        if (monthOf(h[i].date) !== month) continue;
        if (h[i].monthlyPrice === h[i - 1].monthlyPrice) continue;
        // A change spanning a tracking gap (previous entry more than 2 days earlier) can't be dated
        if (daysBetween(h[i].date, h[i - 1].date) > 2) continue;
        changes.push({ provider, from: h[i - 1].monthlyPrice, to: h[i].monthlyPrice, date: h[i].date });
      }

      const lastSeen = entry.current.lastSeen;
      if (lastSeen && monthOf(lastSeen) === month && lastSeen < today && lastSeen > FULL_TRACKING_SINCE && !currentProviders.has(provider)) {
        goneProviders.push(provider);
      }
    }

    changes.sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider));
    const cheapestPlan = data.plans[0];

    reportTiers.push({
      tierKey: data.tierKey,
      label: data.label,
      network: data.network,
      planCountStart: first.planCount,
      planCountEnd: last.planCount,
      cheapestStart: first.cheapestPrice,
      cheapestEnd: last.cheapestPrice,
      averageStart: first.averagePrice,
      averageEnd: last.averagePrice,
      cheapestProvider: cheapestPlan?.providerName ?? null,
      changes,
      newProviders: newProviders.sort(),
      goneProviders: goneProviders.sort(),
    });
  }

  if (reportTiers.length === 0) return null;

  let rises = 0, drops = 0, tiersCheaper = 0, tiersDearer = 0;
  let biggestRise: MonthlyReport['summary']['biggestRise'] = null;
  let biggestDrop: MonthlyReport['summary']['biggestDrop'] = null;
  const newSet = new Set<string>();
  const goneSet = new Set<string>();

  for (const t of reportTiers) {
    if (t.cheapestEnd < t.cheapestStart) tiersCheaper++;
    if (t.cheapestEnd > t.cheapestStart) tiersDearer++;
    t.newProviders.forEach(p => newSet.add(p));
    t.goneProviders.forEach(p => goneSet.add(p));
    for (const c of t.changes) {
      const delta = c.to - c.from;
      if (delta > 0) {
        rises++;
        if (!biggestRise || delta > biggestRise.to - biggestRise.from) biggestRise = { ...c, tierKey: t.tierKey, label: t.label };
      } else if (delta < 0) {
        drops++;
        if (!biggestDrop || delta < biggestDrop.to - biggestDrop.from) biggestDrop = { ...c, tierKey: t.tierKey, label: t.label };
      }
    }
  }

  return {
    month,
    generatedAt: new Date().toISOString(),
    final: month < monthOf(today),
    partialTracking: month <= monthOf(FULL_TRACKING_SINCE),
    tiers: reportTiers,
    summary: {
      rises, drops, tiersCheaper, tiersDearer,
      newProviders: [...newSet].sort(),
      goneProviders: [...goneSet].sort(),
      biggestRise, biggestDrop,
    },
  };
}

/** Every month from the earliest daily summary up to today. */
export function trackedMonths(tiers: { history: TierHistory }[], today: string): string[] {
  const dates = tiers.flatMap(t => t.history.daily.map(d => d.date)).sort();
  if (dates.length === 0) return [monthOf(today)];
  const months: string[] = [];
  let m = monthOf(dates[0]);
  const last = monthOf(today);
  while (m <= last) {
    months.push(m);
    const [y, mm] = m.split('-').map(Number);
    const d = new Date(Date.UTC(y, mm, 1));
    m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return months;
}

/**
 * Writes the report for the current month and, so it ends up final, the previous month.
 * Pass `opts.months` to (re)build specific months and `opts.force` to overwrite final ones.
 */
export async function buildMonthlyReports(
  bucket: R2Bucket,
  tiers: { data: TierData; history: TierHistory }[],
  today: string,
  opts: { months?: string[]; force?: boolean } = {},
): Promise<string[]> {
  const current = monthOf(today);
  const months = opts.months ?? [previousMonth(current), current];
  const written: string[] = [];

  let index: ReportIndex = { updatedAt: '', reports: [] };
  try {
    const existing = await bucket.get('data/reports/index.json');
    if (existing) index = await existing.json();
  } catch {}

  for (const month of months) {
    // Don't rewrite a report that is already final unless forced
    const known = index.reports.find(r => r.month === month);
    if (known?.final && !opts.force) continue;

    const report = buildReportForMonth(month, tiers, today);
    if (!report) continue;

    await bucket.put(`data/reports/${month}.json`, JSON.stringify(report), JSON_META);
    const entry: ReportIndexEntry = {
      month,
      generatedAt: report.generatedAt,
      final: report.final,
      rises: report.summary.rises,
      drops: report.summary.drops,
      newProviders: report.summary.newProviders.length,
    };
    index.reports = index.reports.filter(r => r.month !== month);
    index.reports.push(entry);
    written.push(month);
  }

  index.reports.sort((a, b) => b.month.localeCompare(a.month));
  index.updatedAt = new Date().toISOString();
  await bucket.put('data/reports/index.json', JSON.stringify(index), JSON_META);
  return written;
}
