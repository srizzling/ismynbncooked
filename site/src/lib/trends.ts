import type { TierManifest, TierHistory, ReportIndex } from './types';
import { loadData } from './load';
import { getFixtureManifest } from './data';

export interface TrendSeries {
  key: string;
  label: string;
  points: { date: string; cheapest: number; average: number; planCount: number }[];
}

/** Every tier's daily summary series (weekly rollups beyond 90 days), plus totals from the report index. */
export async function loadTrends(locals: any) {
  const manifest = (await loadData<TierManifest>(locals, 'manifest.json')) ?? getFixtureManifest();
  const histories = await Promise.all(manifest.tiers.map(t => loadData<TierHistory>(locals, `history/${t.key}.json`)));
  const series: TrendSeries[] = manifest.tiers.map((t, i) => ({
    key: t.key,
    label: t.label,
    points: (histories[i]?.daily ?? [])
      .filter(d => d.cheapestPrice > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ date: d.date, cheapest: Math.round(d.cheapestPrice * 100) / 100, average: Math.round(d.averagePrice * 100) / 100, planCount: d.planCount })),
  })).filter(s => s.points.length > 1);

  const reports = (await loadData<ReportIndex>(locals, 'reports/index.json'))?.reports ?? [];
  const totals = reports.reduce((acc, r) => ({ rises: acc.rises + r.rises, drops: acc.drops + r.drops }), { rises: 0, drops: 0 });
  const busiest = reports.length ? reports.reduce((b, r) => (r.rises + r.drops) > (b.rises + b.drops) ? r : b) : null;
  const firstDate = series.reduce((min, s) => s.points[0].date < min ? s.points[0].date : min, '9999');
  const lastDate = series.reduce((max, s) => s.points[s.points.length - 1].date > max ? s.points[s.points.length - 1].date : max, '');

  return { manifest, series, totals, busiest, firstDate, lastDate, months: reports.length };
}
