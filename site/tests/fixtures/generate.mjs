/**
 * Deterministic fixture data for the e2e and visual tests.
 *
 *   node tests/fixtures/generate.mjs
 *
 * Writes tests/fixtures/data/, which has the same layout as the R2 bucket's data/ prefix.
 * Everything is derived from the tables below with no randomness and no wall clock, so
 * re-running it produces byte-identical output. The tests freeze the browser clock at NOW.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data');
export const NOW = '2026-10-01T02:00:00Z';

const PROVIDERS = [
  // name, website, price factor against the tier base, promo $ off, promo months
  { name: 'Tangerine', website: 'https://www.tangerinetelecom.com.au', factor: 1.0, promo: 10, months: 6 },
  { name: 'Superloop', website: 'https://www.superloop.com', factor: 1.05, promo: 15, months: 6 },
  { name: 'Aussie Broadband', website: 'https://www.aussiebroadband.com.au', factor: 1.2, promo: 0, months: 0 },
  { name: 'Exetel', website: 'https://www.exetel.com.au', factor: 1.1, promo: 20, months: 3 },
  { name: 'TPG', website: 'https://www.tpg.com.au', factor: 1.35, promo: 25, months: 6 },
  { name: 'Telstra', website: 'https://www.telstra.com.au', factor: 1.8, promo: 0, months: 0 },
];

const TIERS = [
  { down: 25, up: 5, base: 49 },
  { down: 50, up: 20, base: 59 },
  { down: 100, up: 20, base: 69 },
  { down: 250, up: 25, base: 89 },
  { down: 1000, up: 50, base: 109 },
];

const r2 = (n) => Math.round(n * 100) / 100;
const key = (t) => `nbn-${t.down}-${t.up}`;
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function plansFor(t) {
  return PROVIDERS.map((p, i) => {
    const monthlyPrice = r2(Math.round(t.base * p.factor) - 0.1);
    const promoValue = p.promo || null;
    const promoDuration = p.months || null;
    const promoMonths = Math.min(promoDuration ?? 0, 12);
    const yearlyCost = r2(promoMonths * (monthlyPrice - (promoValue ?? 0)) + (12 - promoMonths) * monthlyPrice);
    return {
      id: `${key(t)}-${slug(p.name)}`,
      providerName: p.name,
      planName: `${p.name} NBN ${t.down}`,
      monthlyPrice,
      yearlyCost,
      effectiveMonthly: r2(yearlyCost / 12),
      setupFee: 0,
      promoValue,
      promoDuration,
      typicalEveningSpeed: Math.round(t.down * (0.85 + i * 0.01)),
      contractLength: 0,
      cisUrl: `${p.website}/cis/${key(t)}.pdf`,
      minimumTerm: 'No lock-in contract',
      cancellationFees: 'None',
      noticePeriod: '30 days',
      downloadSpeed: t.down,
      uploadSpeed: t.up,
      networkType: 'nbn',
      providerWebsite: p.website,
      promoEndDate: null,
    };
  });
}

const DAYS = 45;
const dateOf = (back) => new Date(Date.parse('2026-09-30T00:00:00Z') - back * 86400000).toISOString().slice(0, 10);

function historyFor(t, plans) {
  const providers = {};
  for (const p of plans) {
    // Every provider crept up $2 forty days ago except Tangerine, which dropped $2.
    const delta = p.providerName === 'Tangerine' ? 2 : -2;
    providers[p.providerName] = {
      current: { monthlyPrice: p.monthlyPrice, planName: p.planName, yearlyCost: p.yearlyCost },
      history: [
        { date: dateOf(DAYS), monthlyPrice: r2(p.monthlyPrice + delta), yearlyCost: r2(p.yearlyCost + delta * 12) },
        { date: dateOf(30), monthlyPrice: p.monthlyPrice, yearlyCost: p.yearlyCost },
      ],
    };
  }
  const cheapest = Math.min(...plans.map((p) => p.monthlyPrice));
  const avg = plans.reduce((s, p) => s + p.monthlyPrice, 0) / plans.length;
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const back = DAYS - 1 - i;
    const wobble = back > 30 ? 2 : 0;
    return { date: dateOf(back), cheapestPrice: r2(cheapest + wobble), averagePrice: r2(avg + wobble), planCount: plans.length };
  });
  return { providers, daily };
}

function write(rel, data) {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

rmSync(OUT, { recursive: true, force: true });

const tierInfos = [];
const byProvider = new Map(PROVIDERS.map((p) => [p.name, []]));

for (const t of TIERS) {
  const plans = plansFor(t);
  const sorted = [...plans].sort((a, b) => a.effectiveMonthly - b.effectiveMonthly);
  const cheapest = Math.min(...plans.map((p) => p.monthlyPrice));
  const average = r2(plans.reduce((s, p) => s + p.monthlyPrice, 0) / plans.length);
  const label = `NBN ${t.down}/${t.up}`;
  tierInfos.push({
    key: key(t), network: 'nbn', downloadSpeed: t.down, uploadSpeed: t.up, label,
    planCount: plans.length, cheapest, cheapestEffective: sorted[0].effectiveMonthly,
    cheapestProvider: plans.find((p) => p.monthlyPrice === cheapest).providerName, average,
  });
  write(`plans/${key(t)}.json`, {
    tierKey: key(t), network: 'nbn', downloadSpeed: t.down, uploadSpeed: t.up, label,
    updatedAt: NOW, planCount: plans.length, cheapest, average, plans,
  });
  const history = historyFor(t, plans);
  write(`history/${key(t)}.json`, history);
  for (const p of plans) {
    byProvider.get(p.providerName).push({
      tierKey: key(t), label, network: 'nbn', downloadSpeed: t.down, uploadSpeed: t.up, plan: p,
      rank: [...plans].sort((a, b) => a.monthlyPrice - b.monthlyPrice).findIndex((x) => x.id === p.id) + 1,
      planCount: plans.length, tierCheapest: cheapest, tierAverage: average,
      history: history.providers[p.providerName].history, lastSeen: '2026-09-30',
    });
  }
}

write('manifest.json', { updatedAt: NOW, tiers: tierInfos, providers: PROVIDERS.map((p) => p.name).sort() });
write('meta.json', { lastPriceSync: '2026-10-01T01:00:00Z', lastTermsSync: '2026-09-30T01:00:00Z', lastComparisonSync: '2026-09-29T01:00:00Z' });
write('comparisons.json', {
  updatedAt: '2026-09-29T01:00:00Z',
  units: {
    coffee: { label: 'Flat whites', icon: '☕', price: 5.5, per: 'month', note: 'Fixture price', source: 'Fixture', sourceUrl: 'https://example.com' },
    streaming: { label: 'Streaming subscriptions', icon: '📺', price: 18, per: 'month' },
    deposit: { label: 'House deposit', icon: '🏠', price: 120000, per: 'total' },
  },
});

const levelFor = (o) => (o >= 0.3 ? 'absolute-rort' : o >= 0.15 ? 'taking-the-piss' : o >= 0.05 ? 'bit-shit' : o >= 0 ? 'sweet-as' : 'winning');
const indexEntries = [];
for (const p of PROVIDERS) {
  const tiers = byProvider.get(p.name);
  const overpays = tiers.map((e) => (e.plan.monthlyPrice - e.tierCheapest) / e.tierCheapest).sort((a, b) => a - b);
  const median = overpays[Math.floor(overpays.length / 2)];
  const counts = { winning: 0, 'sweet-as': 0, 'bit-shit': 0, 'taking-the-piss': 0, 'absolute-rort': 0 };
  overpays.forEach((o) => counts[levelFor(o)]++);
  const lvl = levelFor(median);
  const label = { winning: 'Winning', 'sweet-as': 'Sweet As', 'bit-shit': 'Bit Shit', 'taking-the-piss': 'Taking the Piss', 'absolute-rort': 'Absolute F***ing Rort' }[lvl];
  write(`providers/${slug(p.name)}.json`, {
    slug: slug(p.name), name: p.name, website: p.website, updatedAt: NOW, planCount: tiers.length, tiers,
    rort: { medianOverpay: median, meanOverpay: overpays.reduce((s, v) => s + v, 0) / overpays.length, level: lvl, label, counts, tierCount: tiers.length },
  });
  indexEntries.push({
    slug: slug(p.name), name: p.name, website: p.website, planCount: tiers.length, tierCount: tiers.length,
    cheapest: Math.min(...tiers.map((e) => e.plan.monthlyPrice)), networks: ['nbn'],
    rortLevel: lvl, rortLabel: label, medianOverpay: median,
  });
}
write('providers/index.json', { updatedAt: NOW, providers: indexEntries });

// Two monthly reports: August is final, September is still in progress.
const report = (month, final, from, to) => {
  const tiers = tierInfos.map((t) => ({
    tierKey: t.key, label: t.label, network: 'nbn',
    planCountStart: t.planCount, planCountEnd: t.planCount,
    cheapestStart: r2(t.cheapest + from), cheapestEnd: r2(t.cheapest + to),
    averageStart: r2(t.average + from), averageEnd: r2(t.average + to),
    cheapestProvider: t.cheapestProvider,
    changes: [{ provider: 'Telstra', from: r2(t.average + from), to: r2(t.average + to), date: `${month}-12` }],
    newProviders: [], goneProviders: [],
  }));
  const change = { ...tiers[0].changes[0], tierKey: tiers[0].tierKey, label: tiers[0].label };
  return {
    month, generatedAt: NOW, final, partialTracking: false, tiers,
    summary: {
      rises: to > from ? tiers.length : 0, drops: to < from ? tiers.length : 0,
      tiersCheaper: to < from ? tiers.length : 0, tiersDearer: to > from ? tiers.length : 0,
      newProviders: [], goneProviders: [],
      biggestRise: to > from ? change : null, biggestDrop: to < from ? change : null,
    },
  };
};
write('reports/2026-08.json', report('2026-08', true, 0, 2));
write('reports/2026-09.json', report('2026-09', false, 2, 0));
write('reports/index.json', {
  updatedAt: NOW,
  reports: [
    { month: '2026-09', generatedAt: NOW, final: false, rises: 0, drops: TIERS.length, newProviders: 0 },
    { month: '2026-08', generatedAt: NOW, final: true, rises: TIERS.length, drops: 0, newProviders: 0 },
  ],
});
console.log(`Wrote fixtures to ${OUT}`);
