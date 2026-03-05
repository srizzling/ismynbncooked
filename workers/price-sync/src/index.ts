import type { Env, SpeedTier, NBNPlan, TierData, TierHistory, MetaData, DailySummary } from './types';
import { SPEED_TIERS } from './types';
import { fetchPlansForTier } from './api-client';
import { applyCisOverrides } from './cis-overrides';

const TIER_LABELS: Record<SpeedTier, string> = {
  25: 'NBN 25 (25/5 Mbps)',
  50: 'NBN 50 (50/20 Mbps)',
  100: 'NBN 100 (100/20 Mbps)',
  250: 'NBN 250 (250/25 Mbps)',
  500: 'NBN 500 (500/50 Mbps)',
  750: 'NBN 750 (750/50 Mbps)',
  1000: 'NBN 1000 (1000/50 Mbps)',
  2000: 'NBN 2000 (2000/200 Mbps)',
};

function transformPlan(raw: import('./types').NetBargainsPlan): NBNPlan {
  const monthlyPrice = raw.monthly_price;
  const promoValue = raw.promo_value ?? 0;
  const promoDuration = raw.promo_duration ?? 0;

  // Yearly cost accounts for promo: promo months at discounted rate + remaining months at full price
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
  };
}

async function mergeTerms(plans: NBNPlan[], bucket: R2Bucket): Promise<NBNPlan[]> {
  try {
    const termsObj = await bucket.get('data/terms/terms.json');
    if (!termsObj) return plans;
    const terms: Record<string, { minimumTerm?: string; cancellationFees?: string; noticePeriod?: string }> =
      await termsObj.json();

    return plans.map((plan) => {
      const t = terms[plan.cisUrl];
      if (!t) return plan;
      return {
        ...plan,
        minimumTerm: t.minimumTerm ?? null,
        cancellationFees: t.cancellationFees ?? null,
        noticePeriod: t.noticePeriod ?? null,
      };
    });
  } catch {
    return plans;
  }
}

async function updateHistory(
  bucket: R2Bucket,
  speed: SpeedTier,
  plans: NBNPlan[],
  today: string
): Promise<void> {
  let history: TierHistory = { providers: {}, daily: [] };

  try {
    const existing = await bucket.get(`data/history/nbn-${speed}.json`);
    if (existing) history = await existing.json();
  } catch {
    // Start fresh
  }

  // Update provider history (top 20 by cheapest price)
  const byProvider = new Map<string, NBNPlan>();
  for (const plan of plans) {
    const existing = byProvider.get(plan.providerName);
    if (!existing || plan.monthlyPrice < existing.monthlyPrice) {
      byProvider.set(plan.providerName, plan);
    }
  }

  const topProviders = [...byProvider.entries()]
    .sort((a, b) => a[1].monthlyPrice - b[1].monthlyPrice)
    .slice(0, 20);

  for (const [name, plan] of topProviders) {
    if (!history.providers[name]) {
      history.providers[name] = { current: { monthlyPrice: 0, planName: '', yearlyCost: 0 }, history: [] };
    }
    history.providers[name].current = {
      monthlyPrice: plan.monthlyPrice,
      planName: plan.planName,
      yearlyCost: plan.yearlyCost,
    };
    // Avoid duplicate entries for today
    if (!history.providers[name].history.some((h) => h.date === today)) {
      history.providers[name].history.push({
        date: today,
        monthlyPrice: plan.monthlyPrice,
        yearlyCost: plan.yearlyCost,
      });
    }
  }

  // Update daily summary
  const cheapestPrice = plans.length ? Math.min(...plans.map((p) => p.monthlyPrice)) : 0;
  const averagePrice = plans.length
    ? plans.reduce((sum, p) => sum + p.monthlyPrice, 0) / plans.length
    : 0;

  if (!history.daily.some((d) => d.date === today)) {
    history.daily.push({
      date: today,
      cheapestPrice: Math.round(cheapestPrice * 100) / 100,
      averagePrice: Math.round(averagePrice * 100) / 100,
      planCount: plans.length,
    });
  }

  // Keep 90 days of daily data, then weekly rollups
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
  const recent = history.daily.filter((d) => d.date >= ninetyDaysAgo);
  const older = history.daily.filter((d) => d.date < ninetyDaysAgo);

  // Weekly rollup for older data — keep one entry per week (Sunday)
  const weeklyMap = new Map<string, DailySummary>();
  for (const entry of older) {
    const d = new Date(entry.date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().split('T')[0];
    if (!weeklyMap.has(key)) weeklyMap.set(key, entry);
  }

  history.daily = [...weeklyMap.values(), ...recent].sort((a, b) => a.date.localeCompare(b.date));

  // Trim provider histories too
  for (const prov of Object.values(history.providers)) {
    if (prov.history.length > 365) {
      prov.history = prov.history.slice(-365);
    }
  }

  await bucket.put(`data/history/nbn-${speed}.json`, JSON.stringify(history), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    console.log(`[price-sync] Starting sync for ${today}`);

    for (const speed of SPEED_TIERS) {
      try {
        console.log(`[price-sync] Fetching NBN ${speed} plans...`);
        const rawPlans = await fetchPlansForTier(env.NETBARGAINS_API_KEY, speed);
        let plans = rawPlans.map(transformPlan);

        // Apply CIS URL overrides for known-bad URLs
        plans = applyCisOverrides(plans);

        // Merge existing terms data
        plans = await mergeTerms(plans, env.DATA_BUCKET);

        // Sort by monthly price
        plans.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

        const cheapest = plans.length ? plans[0].monthlyPrice : 0;
        const average = plans.length
          ? Math.round((plans.reduce((s, p) => s + p.monthlyPrice, 0) / plans.length) * 100) / 100
          : 0;

        const tierData: TierData = {
          speed,
          label: TIER_LABELS[speed],
          updatedAt: new Date().toISOString(),
          planCount: plans.length,
          cheapest,
          average,
          plans,
        };

        await env.DATA_BUCKET.put(`data/plans/nbn-${speed}.json`, JSON.stringify(tierData), {
          httpMetadata: { contentType: 'application/json' },
        });

        // Update history
        await updateHistory(env.DATA_BUCKET, speed, plans, today);

        console.log(`[price-sync] NBN ${speed}: ${plans.length} plans, cheapest $${cheapest}`);
      } catch (err) {
        console.error(`[price-sync] Failed for NBN ${speed}:`, err);
      }
    }

    // Update meta
    let meta: MetaData = { lastPriceSync: '', lastTermsSync: '', lastComparisonSync: '' };
    try {
      const existing = await env.DATA_BUCKET.get('data/meta.json');
      if (existing) meta = await existing.json();
    } catch {}
    meta.lastPriceSync = new Date().toISOString();
    await env.DATA_BUCKET.put('data/meta.json', JSON.stringify(meta), {
      httpMetadata: { contentType: 'application/json' },
    });

    console.log('[price-sync] Sync complete');
  },

  // Allow manual trigger + status check via HTTP
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      try {
        const metaObj = await env.DATA_BUCKET.get('data/meta.json');
        const meta = metaObj ? await metaObj.json() as MetaData : null;
        const tierChecks: Record<string, { planCount: number; cheapest: number; updatedAt: string }> = {};

        for (const speed of SPEED_TIERS) {
          try {
            const obj = await env.DATA_BUCKET.get(`data/plans/nbn-${speed}.json`);
            if (obj) {
              const data = await obj.json() as TierData;
              tierChecks[`nbn-${speed}`] = { planCount: data.planCount, cheapest: data.cheapest, updatedAt: data.updatedAt };
            }
          } catch {}
        }

        return new Response(JSON.stringify({ ok: true, meta, tiers: tierChecks }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    await this.scheduled({} as ScheduledEvent, env, ctx);
    return new Response('Sync complete', { status: 200 });
  },
} satisfies ExportedHandler<Env>;
