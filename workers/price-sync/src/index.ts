import type { Env, NBNPlan, TierData, TierHistory, MetaData, DailySummary, NetworkType, TierInfo, TierManifest } from './types';
import { DOWNLOAD_SPEEDS, buildTierKey, buildTierLabel } from './types';
import { fetchPlansForTier } from './api-client';
import { applyCisOverrides } from './cis-overrides';
import { scrapeCommunityPlans, scrapeLeaptelRaw, scrapeOriginRaw, type ParsedPlan } from './community-scrapers';

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

    // --- Community scrapers: merge plans missing from NetBargains ---
    // Reads community-sources configs from R2 and scrapes each provider
    if (env.FIRECRAWL_API_KEY) {
      const { added } = await scrapeCommunityPlans(env.DATA_BUCKET, env.FIRECRAWL_API_KEY, allTierGroups);
      console.log(`[price-sync] Community scrapers: ${added} new plans merged`);
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

      const cheapestEffective = plans.length
        ? Math.min(...plans.map(p => p.effectiveMonthly))
        : cheapest;

      manifestTiers.push({
        key: tierKey,
        network,
        downloadSpeed,
        uploadSpeed,
        label,
        planCount: plans.length,
        cheapest,
        cheapestEffective: Math.min(cheapest, cheapestEffective),
        cheapestProvider: plans[0].providerName,
        average,
      });

      console.log(`[price-sync] ${tierKey}: ${plans.length} plans, cheapest $${cheapest}`);
    }

    // Sort manifest: NBN first, then by download speed, then upload speed
    manifestTiers.sort((a, b) => {
      if (a.network !== b.network) return a.network === 'nbn' ? -1 : 1;
      if (a.downloadSpeed !== b.downloadSpeed) return a.downloadSpeed - b.downloadSpeed;
      return a.uploadSpeed - b.uploadSpeed;
    });

    // Collect all unique provider names (sorted alphabetically for stable indices)
    const providerSet = new Set<string>();
    for (const plans of allTierGroups.values()) {
      for (const plan of plans) {
        providerSet.add(plan.providerName);
      }
    }
    const providers = [...providerSet].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

    // Write manifest
    const manifest: TierManifest = {
      updatedAt: new Date().toISOString(),
      tiers: manifestTiers,
      providers,
    };
    await env.DATA_BUCKET.put('data/manifest.json', JSON.stringify(manifest), {
      httpMetadata: { contentType: 'application/json' },
    });

    console.log(`[price-sync] Manifest: ${manifestTiers.length} tiers, ${providers.length} providers discovered`);

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

    // Migrate old history files: nbn-{speed}.json → nbn-{speed}-{upload}.json
    if (url.pathname === '/migrate-history') {
      const oldSpeeds: Record<number, number> = {
        25: 5, 50: 20, 100: 20, 250: 25, 500: 50, 750: 50, 1000: 50, 2000: 200,
      };
      const results: Record<string, string> = {};

      for (const [dl, ul] of Object.entries(oldSpeeds)) {
        const oldKey = `data/history/nbn-${dl}.json`;
        const newKey = `data/history/nbn-${dl}-${ul}.json`;

        try {
          const existing = await env.DATA_BUCKET.get(newKey);
          if (existing) {
            results[oldKey] = `skipped (${newKey} already exists)`;
            continue;
          }

          const old = await env.DATA_BUCKET.get(oldKey);
          if (!old) {
            results[oldKey] = 'not found';
            continue;
          }

          const data = await old.text();
          await env.DATA_BUCKET.put(newKey, data, {
            httpMetadata: { contentType: 'application/json' },
          });
          results[oldKey] = `migrated → ${newKey}`;
        } catch (err) {
          results[oldKey] = `error: ${err}`;
        }
      }

      return new Response(JSON.stringify({ ok: true, results }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Creates a JSON file in community-sources/ via a GitHub pull request
    if (url.pathname === '/submit-plan' && request.method === 'POST') {
      // Validate origin when ALLOWED_ORIGINS is configured
      const origin = request.headers.get('Origin') ?? '';
      const allowedOrigin = env.ALLOWED_ORIGINS
        ? (env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).includes(origin) ? origin : null)
        : '*';

      if (env.ALLOWED_ORIGINS && !allowedOrigin) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin ?? '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
      };

      if (!env.GITHUB_TOKEN) {
        return new Response(JSON.stringify({ ok: false, error: 'Submissions not configured' }), {
          status: 500, headers: corsHeaders,
        });
      }

      const ghHeaders = {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ismynbncooked-bot/1.0',
        'Content-Type': 'application/json',
      };
      const repo = 'srizzling/ismynbncooked';

      try {
        const body = await request.json() as {
          planUrl: string;
          cisUrl?: string;
          provider?: string;
          networkType?: string;
          downloadSpeed?: string;
          uploadSpeed?: string;
          notes?: string;
        };

        if (!body.planUrl?.trim()) {
          return new Response(JSON.stringify({ ok: false, error: 'Plan URL is required' }), {
            status: 400, headers: corsHeaders,
          });
        }

        let hostname = '';
        try { hostname = new URL(body.planUrl.trim()).hostname; } catch { hostname = 'unknown'; }
        const provider = body.provider?.trim() || hostname;
        const networkType = body.networkType === 'opticomm' ? 'opticomm' : 'nbn';
        const speedLabel = body.downloadSpeed
          ? `${body.downloadSpeed}${body.uploadSpeed ? '-' + body.uploadSpeed : ''}`
          : '';

        // Build the community source JSON
        const sourceData: Record<string, unknown> = {
          provider,
          url: body.planUrl.trim(),
          networkType,
        };
        if (body.cisUrl?.trim()) sourceData.cisUrl = body.cisUrl.trim();
        if (body.downloadSpeed) sourceData.downloadSpeed = parseInt(body.downloadSpeed);
        if (body.uploadSpeed) sourceData.uploadSpeed = parseInt(body.uploadSpeed);
        if (body.notes?.trim()) sourceData.notes = body.notes.trim();
        sourceData.submittedAt = new Date().toISOString();

        const slug = `${provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${networkType}${speedLabel ? '-' + speedLabel : ''}`;
        const filePath = `workers/price-sync/community-sources/${slug}.json`;
        const branchName = `plan-submission/${slug}-${Date.now()}`;
        const fileContent = btoa(unescape(encodeURIComponent(JSON.stringify(sourceData, null, 2))));

        // 0. Check for duplicate — does this file already exist on main?
        const existingFile = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=main`, { headers: ghHeaders });
        if (existingFile.ok) {
          return new Response(JSON.stringify({ ok: false, error: 'This plan has already been submitted. Thanks though!' }), {
            status: 409, headers: corsHeaders,
          });
        }

        // Check for open PRs that modify the same file
        const openPRs = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&labels=plan-submission`, { headers: ghHeaders });
        if (openPRs.ok) {
          const prs = await openPRs.json() as { title: string; number: number }[];
          const duplicate = prs.find(pr => pr.title.includes(provider) && pr.title.includes(networkType.toUpperCase()));
          if (duplicate) {
            return new Response(JSON.stringify({ ok: false, error: 'This plan is already pending review. Thanks though!' }), {
              status: 409, headers: corsHeaders,
            });
          }
        }

        // 1. Get main branch SHA
        const mainRef = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers: ghHeaders });
        if (!mainRef.ok) throw new Error('Failed to get main branch ref');
        const mainData = await mainRef.json() as { object: { sha: string } };
        const mainSha = mainData.object.sha;

        // 2. Create branch
        const branchRes = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
          method: 'POST', headers: ghHeaders,
          body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: mainSha }),
        });
        if (!branchRes.ok) throw new Error('Failed to create branch');

        // 3. Create file on branch
        const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
          method: 'PUT', headers: ghHeaders,
          body: JSON.stringify({
            message: `feat(submit): add ${provider} ${networkType.toUpperCase()} ${speedLabel || 'plan'}`,
            content: fileContent,
            branch: branchName,
          }),
        });
        if (!fileRes.ok) throw new Error('Failed to create file');

        // 4. Create PR
        const networkLabel = networkType === 'opticomm' ? 'Opticomm' : 'NBN';
        const prTitle = `[Plan Submission] ${provider}${speedLabel ? ' — ' + networkLabel + ' ' + speedLabel.replace('-', '/') : ''}`;

        const prBodyParts = [
          '## Plan Submission',
          '',
          '| Field | Value |',
          '|-------|-------|',
          `| **Provider** | ${provider} |`,
          `| **Network** | ${networkLabel} |`,
          `| **Download Speed** | ${body.downloadSpeed ? body.downloadSpeed + ' Mbps' : '_Not provided_'} |`,
          `| **Upload Speed** | ${body.uploadSpeed ? body.uploadSpeed + ' Mbps' : '_Not provided_'} |`,
          `| **Plan URL** | ${body.planUrl.trim()} |`,
          `| **CIS URL** | ${body.cisUrl?.trim() || '_Not provided_'} |`,
        ];
        if (body.notes?.trim()) {
          prBodyParts.push('', '## Notes', '', body.notes.trim());
        }
        prBodyParts.push('', '---', '*Submitted via the community plan submission form.*');

        const prRes = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
          method: 'POST', headers: ghHeaders,
          body: JSON.stringify({
            title: prTitle,
            body: prBodyParts.join('\n'),
            head: branchName,
            base: 'main',
          }),
        });
        if (!prRes.ok) throw new Error('Failed to create PR');
        const pr = await prRes.json() as { html_url: string; number: number };

        // 5. Add label and assign to PR
        await fetch(`https://api.github.com/repos/${repo}/issues/${pr.number}/labels`, {
          method: 'POST', headers: ghHeaders,
          body: JSON.stringify({ labels: ['plan-submission'] }),
        });

        await fetch(`https://api.github.com/repos/${repo}/issues/${pr.number}/assignees`, {
          method: 'POST', headers: ghHeaders,
          body: JSON.stringify({ assignees: ['srizzling'] }),
        });

        return new Response(JSON.stringify({ ok: true, prNumber: pr.number, prUrl: pr.html_url }), {
          headers: corsHeaders,
        });
      } catch (err) {
        console.error('[submit-plan] Error:', err);
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500, headers: corsHeaders,
        });
      }
    }

    // Verify a community plan submission by scraping the provider URL
    if (url.pathname === '/verify-plan' && request.method === 'POST') {
      if (!env.FIRECRAWL_API_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'Firecrawl not configured' }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }

      try {
        const body = await request.json() as {
          provider?: string;
          url: string;
          networkType?: string;
          downloadSpeed?: number;
          uploadSpeed?: number;
          cisUrl?: string;
        };

        if (!body.url?.trim()) {
          return new Response(JSON.stringify({ ok: false, error: 'URL is required' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }

        // Check if CIS URL is reachable
        let cisUrlReachable: boolean | null = null;
        if (body.cisUrl?.trim()) {
          try {
            const r = await fetch(body.cisUrl.trim(), { method: 'HEAD', redirect: 'follow' });
            cisUrlReachable = r.ok;
          } catch { cisUrlReachable = false; }
        }

        // Scrape plans — currently only Leaptel is supported
        // If scrape succeeds, the URL is reachable (firecrawl handles Cloudflare)
        const provider = (body.provider || '').toLowerCase();
        let scrapedPlans: ParsedPlan[] = [];
        let planUrlReachable = false;

        if (provider === 'leaptel' || body.url.includes('leaptel.com.au')) {
          scrapedPlans = await scrapeLeaptelRaw(env.FIRECRAWL_API_KEY);
          planUrlReachable = scrapedPlans.length > 0;
        } else if (provider === 'origin energy' || provider === 'origin' || body.url.includes('originenergy.com.au')) {
          scrapedPlans = await scrapeOriginRaw(env.FIRECRAWL_API_KEY);
          planUrlReachable = scrapedPlans.length > 0;
        } else {
          // Unsupported provider — just check if URL is reachable
          try {
            const r = await fetch(body.url.trim(), { method: 'HEAD', redirect: 'follow' });
            planUrlReachable = r.ok;
          } catch { /* unreachable */ }

          return new Response(JSON.stringify({
            ok: true,
            planUrl: { reachable: planUrlReachable },
            cisUrl: cisUrlReachable !== null ? { reachable: cisUrlReachable } : undefined,
            submittedPlan: null,
            missingPlans: [],
            note: `Automated scraping not yet supported for this provider. Manual review required.`,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        // Find submitted plan match (if speeds were provided)
        let submittedPlan: (ParsedPlan & { found: boolean }) | null = null;
        if (body.downloadSpeed && body.uploadSpeed) {
          const match = scrapedPlans.find(
            p => p.downloadSpeed === body.downloadSpeed && p.uploadSpeed === body.uploadSpeed
          );
          submittedPlan = match
            ? { ...match, found: true }
            : { found: false, name: '', downloadSpeed: body.downloadSpeed, uploadSpeed: body.uploadSpeed, typicalEveningSpeed: null, monthlyPrice: 0, promoValue: 0, promoDuration: 0, ongoingPrice: 0 };
        }

        // Cross-reference against R2 data to find plans missing from NetBargains
        const fallbackNetwork = body.networkType === 'opticomm' ? 'opticomm' : 'nbn';
        const missingPlans: ParsedPlan[] = [];

        for (const plan of scrapedPlans) {
          const planNetwork = (plan.networkType || fallbackNetwork) as 'nbn' | 'opticomm';
          const tierKey = buildTierKey(planNetwork, plan.downloadSpeed, plan.uploadSpeed);
          try {
            const tierObj = await env.DATA_BUCKET.get(`data/plans/${tierKey}.json`);
            if (tierObj) {
              const tierData = await tierObj.json() as TierData;
              const hasProvider = tierData.plans.some(
                p => p.providerName.toLowerCase() === (body.provider || 'leaptel').toLowerCase()
              );
              if (!hasProvider) missingPlans.push(plan);
            } else {
              // Entire tier is missing
              missingPlans.push(plan);
            }
          } catch {
            missingPlans.push(plan);
          }
        }

        return new Response(JSON.stringify({
          ok: true,
          planUrl: { reachable: planUrlReachable },
          cisUrl: cisUrlReachable !== null ? { reachable: cisUrlReachable } : undefined,
          submittedPlan,
          allScrapedPlans: scrapedPlans,
          missingPlans,
        }), { headers: { 'Content-Type': 'application/json' } });

      } catch (err) {
        console.error('[verify-plan] Error:', err);
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Handle CORS preflight for submit-plan
    if (url.pathname === '/submit-plan' && request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') ?? '';
      const allowedOrigin = env.ALLOWED_ORIGINS
        ? (env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).includes(origin) ? origin : null)
        : '*';
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin ?? '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    await this.scheduled({} as ScheduledEvent, env, ctx);
    return new Response('Sync complete', { status: 200 });
  },
} satisfies ExportedHandler<Env>;
