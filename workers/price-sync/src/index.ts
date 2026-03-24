import type { Env, NBNPlan, TierData, TierHistory, MetaData, DailySummary, NetworkType, TierInfo, TierManifest } from './types';
import { DOWNLOAD_SPEEDS, buildTierKey, buildTierLabel } from './types';
import { fetchPlansForTier } from './api-client';
import { applyCisOverrides } from './cis-overrides';

function normalizeNetworkType(raw: string): NetworkType {
  const lower = raw.toLowerCase();
  if (lower === 'opticomm') return 'opticomm';
  return 'nbn';
}

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
    downloadSpeed: raw.download_speed,
    uploadSpeed: raw.upload_speed,
    networkType: normalizeNetworkType(raw.network_type),
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
  tierKey: string,
  plans: NBNPlan[],
  today: string
): Promise<void> {
  let history: TierHistory = { providers: {}, daily: [] };

  try {
    const existing = await bucket.get(`data/history/${tierKey}.json`);
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

  await bucket.put(`data/history/${tierKey}.json`, JSON.stringify(history), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/** Group plans by (network, download, upload) and return a map of tierKey -> plans */
function groupPlansByTier(plans: NBNPlan[]): Map<string, NBNPlan[]> {
  const groups = new Map<string, NBNPlan[]>();
  for (const plan of plans) {
    const key = buildTierKey(plan.networkType, plan.downloadSpeed, plan.uploadSpeed);
    const group = groups.get(key);
    if (group) {
      group.push(plan);
    } else {
      groups.set(key, [plan]);
    }
  }
  return groups;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    console.log(`[price-sync] Starting sync for ${today}`);

    const allTierGroups = new Map<string, NBNPlan[]>();

    // Fetch plans for each download speed and group by (network, download, upload)
    for (const downloadSpeed of DOWNLOAD_SPEEDS) {
      try {
        console.log(`[price-sync] Fetching ${downloadSpeed} Mbps plans...`);
        const rawPlans = await fetchPlansForTier(env.NETBARGAINS_API_KEY, downloadSpeed);
        let plans = rawPlans.map(transformPlan);

        // Apply CIS URL overrides for known-bad URLs
        plans = applyCisOverrides(plans);

        // Merge existing terms data
        plans = await mergeTerms(plans, env.DATA_BUCKET);

        // Group by tier key
        const groups = groupPlansByTier(plans);
        for (const [tierKey, tierPlans] of groups) {
          const existing = allTierGroups.get(tierKey);
          if (existing) {
            existing.push(...tierPlans);
          } else {
            allTierGroups.set(tierKey, tierPlans);
          }
        }

        console.log(`[price-sync] ${downloadSpeed} Mbps: ${plans.length} plans across ${groups.size} tier(s)`);
      } catch (err) {
        console.error(`[price-sync] Failed for ${downloadSpeed} Mbps:`, err);
      }
    }

    // Store each discovered tier
    const manifestTiers: TierInfo[] = [];

    for (const [tierKey, plans] of allTierGroups) {
      // Sort by monthly price
      plans.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

      const firstPlan = plans[0];
      const network = firstPlan.networkType;
      const downloadSpeed = firstPlan.downloadSpeed;
      const uploadSpeed = firstPlan.uploadSpeed;
      const label = buildTierLabel(network, downloadSpeed, uploadSpeed);

      const cheapest = plans[0].monthlyPrice;
      const average = Math.round((plans.reduce((s, p) => s + p.monthlyPrice, 0) / plans.length) * 100) / 100;

      const tierData: TierData = {
        tierKey,
        network,
        downloadSpeed,
        uploadSpeed,
        label,
        updatedAt: new Date().toISOString(),
        planCount: plans.length,
        cheapest,
        average,
        plans,
      };

      await env.DATA_BUCKET.put(`data/plans/${tierKey}.json`, JSON.stringify(tierData), {
        httpMetadata: { contentType: 'application/json' },
      });

      // Update history
      await updateHistory(env.DATA_BUCKET, tierKey, plans, today);

      manifestTiers.push({
        key: tierKey,
        network,
        downloadSpeed,
        uploadSpeed,
        label,
      });

      console.log(`[price-sync] ${tierKey}: ${plans.length} plans, cheapest $${cheapest}`);
    }

    // Sort manifest: NBN first, then by download speed, then upload speed
    manifestTiers.sort((a, b) => {
      if (a.network !== b.network) return a.network === 'nbn' ? -1 : 1;
      if (a.downloadSpeed !== b.downloadSpeed) return a.downloadSpeed - b.downloadSpeed;
      return a.uploadSpeed - b.uploadSpeed;
    });

    // Write manifest
    const manifest: TierManifest = {
      updatedAt: new Date().toISOString(),
      tiers: manifestTiers,
    };
    await env.DATA_BUCKET.put('data/manifest.json', JSON.stringify(manifest), {
      httpMetadata: { contentType: 'application/json' },
    });

    console.log(`[price-sync] Manifest: ${manifestTiers.length} tiers discovered`);

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

        const manifestObj = await env.DATA_BUCKET.get('data/manifest.json');
        const manifest = manifestObj ? await manifestObj.json() as TierManifest : null;

        const tierChecks: Record<string, { planCount: number; cheapest: number; updatedAt: string }> = {};

        if (manifest) {
          for (const tier of manifest.tiers) {
            try {
              const obj = await env.DATA_BUCKET.get(`data/plans/${tier.key}.json`);
              if (obj) {
                const data = await obj.json() as TierData;
                tierChecks[tier.key] = { planCount: data.planCount, cheapest: data.cheapest, updatedAt: data.updatedAt };
              }
            } catch {}
          }
        }

        return new Response(JSON.stringify({ ok: true, meta, tierCount: manifest?.tiers.length ?? 0, tiers: tierChecks }, null, 2), {
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
