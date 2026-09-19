/**
 * Remote MCP server for amigettingrorted.au.
 *
 * Exposes the NBN / Opticomm plan data in R2 to AI agents over the MCP
 * Streamable HTTP transport. Stateless: every request builds a fresh server,
 * so no Durable Objects or sessions are needed.
 *
 *   POST /mcp   JSON-RPC over Streamable HTTP (no auth)
 *   GET  /      Plain JSON description of the server and its tools
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

interface Env {
  DATA_BUCKET: R2Bucket;
}

type NetworkType = 'nbn' | 'opticomm';

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

interface TierData {
  tierKey: string;
  network: NetworkType;
  downloadSpeed: number;
  uploadSpeed: number;
  label: string;
  updatedAt: string;
  planCount: number;
  cheapest: number;
  average: number;
  plans: NBNPlan[];
}

interface TierInfo {
  key: string;
  network: NetworkType;
  downloadSpeed: number;
  uploadSpeed: number;
  label: string;
  planCount?: number;
  cheapest?: number;
  cheapestEffective?: number;
  cheapestProvider?: string;
  average?: number;
}

interface TierManifest {
  updatedAt: string;
  tiers: TierInfo[];
  providers: string[];
}

interface TierHistory {
  providers: Record<string, { current: { monthlyPrice: number; planName: string; yearlyCost: number }; history: { date: string; monthlyPrice: number; yearlyCost: number }[] }>;
  daily: { date: string; cheapestPrice: number; averagePrice: number; planCount: number }[];
}

const SITE = 'https://amigettingrorted.au';
const HORIZONS = [3, 6, 12, 24] as const;
type Horizon = (typeof HORIZONS)[number];

// Mirrors site/src/lib/cooked.ts — keep the thresholds in sync.
const LEVELS = [
  { threshold: 0.30, level: 'absolute-rort', label: 'Absolute Rort', description: "Mate. You're getting absolutely done." },
  { threshold: 0.15, level: 'taking-the-piss', label: 'Taking the Piss', description: 'Your provider is having a laugh.' },
  { threshold: 0.05, level: 'bit-shit', label: 'Bit Shit', description: "Not the end of the world, but money's money." },
  { threshold: 0, level: 'sweet-as', label: 'Sweet As', description: "You're on a fair deal. No worries." },
  { threshold: -Infinity, level: 'winning', label: 'Winning', description: "You're beating the cheapest plan we can find. Legend." },
];

function rate(userPrice: number, cheapestPrice: number) {
  const diff = userPrice - cheapestPrice;
  const overpayPercent = cheapestPrice > 0 ? diff / cheapestPrice : 0;
  const match = LEVELS.find(l => overpayPercent >= l.threshold) ?? LEVELS[LEVELS.length - 1];
  return {
    level: match.level,
    label: match.label,
    description: match.description,
    overpayPercent: Math.round(overpayPercent * 1000) / 10,
    monthlySavings: Math.max(0, Math.round(diff * 100) / 100),
    yearlySavings: Math.max(0, Math.round(diff * 12 * 100) / 100),
  };
}

// Mirrors site/src/lib/costs.ts
function calcCosts(plan: NBNPlan, months: Horizon) {
  const promoMonths = Math.min(plan.promoDuration ?? 0, months);
  const fullMonths = months - promoMonths;
  const promoDiscount = plan.promoValue ?? 0;
  const totalCost = promoMonths * (plan.monthlyPrice - promoDiscount) + fullMonths * plan.monthlyPrice + plan.setupFee;
  return {
    totalCost: Math.round(totalCost * 100) / 100,
    effectiveMonthly: Math.round((totalCost / months) * 100) / 100,
  };
}

// ─── Data access ─────────────────────────────────────────────────────────────

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  try {
    const obj = await bucket.get(key);
    return obj ? (await obj.json() as T) : null;
  } catch {
    return null;
  }
}

async function loadManifest(bucket: R2Bucket): Promise<TierManifest> {
  const manifest = await readJson<TierManifest>(bucket, 'data/manifest.json');
  if (!manifest) throw new Error('Plan data is temporarily unavailable');
  return manifest;
}

const TIER_KEY = /^(nbn|opticomm)-(\d+)(?:-(\d+))?$/;

/** Resolve a tier key (exact "nbn-100-20" or grouped "nbn-100") to the exact tier keys it covers. */
function resolveTierKeys(manifest: TierManifest, tier: string): string[] {
  const m = tier.toLowerCase().trim().match(TIER_KEY);
  if (!m) return [];
  const [, network, dl, ul] = m;
  if (ul) return manifest.tiers.some(t => t.key === `${network}-${dl}-${ul}`) ? [`${network}-${dl}-${ul}`] : [];
  return manifest.tiers
    .filter(t => t.network === network && t.downloadSpeed === parseInt(dl))
    .map(t => t.key);
}

async function loadPlans(bucket: R2Bucket, manifest: TierManifest, tier: string): Promise<{ keys: string[]; plans: NBNPlan[]; updatedAt: string | null }> {
  const keys = resolveTierKeys(manifest, tier);
  const tiers = await Promise.all(keys.map(k => readJson<TierData>(bucket, `data/plans/${k}.json`)));
  const plans: NBNPlan[] = [];
  let updatedAt: string | null = null;
  for (const t of tiers) {
    if (!t) continue;
    plans.push(...t.plans);
    if (!updatedAt || t.updatedAt > updatedAt) updatedAt = t.updatedAt;
  }
  return { keys, plans, updatedAt };
}

function summarisePlan(plan: NBNPlan, horizon: Horizon) {
  const costs = calcCosts(plan, horizon);
  return {
    id: plan.id,
    provider: plan.providerName,
    plan: plan.planName,
    tier: `${plan.networkType}-${plan.downloadSpeed}-${plan.uploadSpeed}`,
    downloadSpeed: plan.downloadSpeed,
    uploadSpeed: plan.uploadSpeed,
    typicalEveningSpeed: plan.typicalEveningSpeed,
    monthlyPrice: plan.monthlyPrice,
    promo: plan.promoValue && plan.promoDuration
      ? { discountPerMonth: plan.promoValue, months: plan.promoDuration, promoPrice: Math.round((plan.monthlyPrice - plan.promoValue) * 100) / 100 }
      : null,
    setupFee: plan.setupFee,
    contractLengthMonths: plan.contractLength,
    [`totalCost${horizon}Months`]: costs.totalCost,
    [`effectiveMonthly${horizon}Months`]: costs.effectiveMonthly,
    minimumTerm: plan.minimumTerm,
    cancellationFees: plan.cancellationFees,
    noticePeriod: plan.noticePeriod,
    cisUrl: plan.cisUrl,
  };
}

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

const horizonSchema = z.union([z.literal(3), z.literal(6), z.literal(12), z.literal(24)])
  .default(12)
  .describe('Months to cost the plan over. Promos and setup fees are spread across this window.');

const tierSchema = z.string().describe(
  'Tier key. Exact, e.g. "nbn-100-20" or "opticomm-500-50", or grouped by download speed, e.g. "nbn-100", which merges all upload variants. Use list_tiers to discover keys.',
);

// ─── Server ──────────────────────────────────────────────────────────────────

function buildServer(env: Env): McpServer {
  const server = new McpServer(
    { name: 'amigettingrorted', version: '1.0.0' },
    {
      instructions:
        'Australian NBN and Opticomm home internet plan prices, refreshed daily from NetBargains plus community-scraped providers. ' +
        'Prices are AUD per month. "monthlyPrice" is the ongoing price; promos are described separately. ' +
        'Start with list_tiers, then get_plans or find_cheapest. Use rate_plan to judge whether a price is fair. ' +
        `Human-readable pages live at ${SITE}/<tier-key>.`,
    },
  );

  server.registerTool(
    'list_tiers',
    {
      title: 'List speed tiers',
      description: 'List every NBN and Opticomm speed tier with plan counts, cheapest price and provider, and average price.',
      inputSchema: {
        network: z.enum(['nbn', 'opticomm']).optional().describe('Filter to one network. Omit for both.'),
      },
    },
    async ({ network }) => {
      const manifest = await loadManifest(env.DATA_BUCKET);
      const tiers = manifest.tiers
        .filter(t => !network || t.network === network)
        .map(t => ({
          key: t.key,
          label: t.label,
          network: t.network,
          downloadSpeed: t.downloadSpeed,
          uploadSpeed: t.uploadSpeed,
          planCount: t.planCount ?? 0,
          cheapestMonthly: t.cheapest ?? null,
          cheapestEffectiveMonthly12: t.cheapestEffective ?? null,
          cheapestProvider: t.cheapestProvider ?? null,
          averageMonthly: t.average ?? null,
          url: `${SITE}/${t.key}`,
        }));
      return text({ updatedAt: manifest.updatedAt, tierCount: tiers.length, tiers });
    },
  );

  server.registerTool(
    'get_plans',
    {
      title: 'Get plans for a tier',
      description: 'List plans in a speed tier, cheapest first by effective monthly cost over the chosen horizon. Optionally filter by provider.',
      inputSchema: {
        tier: tierSchema,
        horizon: horizonSchema,
        provider: z.string().optional().describe('Case-insensitive provider name filter, e.g. "superloop".'),
        limit: z.number().int().min(1).max(100).default(20).describe('Maximum plans to return.'),
      },
    },
    async ({ tier, horizon, provider, limit }) => {
      const manifest = await loadManifest(env.DATA_BUCKET);
      const { keys, plans, updatedAt } = await loadPlans(env.DATA_BUCKET, manifest, tier);
      if (keys.length === 0) return errorResult(`Unknown tier "${tier}". Call list_tiers for valid keys.`);
      const needle = provider?.toLowerCase().trim();
      const filtered = needle ? plans.filter(p => p.providerName.toLowerCase().includes(needle)) : plans;
      const sorted = [...filtered].sort((a, b) => calcCosts(a, horizon).effectiveMonthly - calcCosts(b, horizon).effectiveMonthly);
      return text({
        tier,
        tierKeys: keys,
        updatedAt,
        horizonMonths: horizon,
        totalPlans: filtered.length,
        plans: sorted.slice(0, limit).map(p => summarisePlan(p, horizon)),
      });
    },
  );

  server.registerTool(
    'find_cheapest',
    {
      title: 'Find cheapest plans for a speed',
      description: 'Find the cheapest plans at or above a download speed, across all matching tiers. Good for "what is the cheapest 100 Mbps plan".',
      inputSchema: {
        downloadSpeed: z.number().int().positive().describe('Minimum download speed in Mbps, e.g. 100.'),
        uploadSpeed: z.number().int().positive().optional().describe('Minimum upload speed in Mbps. Omit for any.'),
        network: z.enum(['nbn', 'opticomm']).default('nbn'),
        exact: z.boolean().default(true).describe('true: only the exact download speed. false: that speed or faster.'),
        horizon: horizonSchema,
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ downloadSpeed, uploadSpeed, network, exact, horizon, limit }) => {
      const manifest = await loadManifest(env.DATA_BUCKET);
      const tiers = manifest.tiers.filter(t =>
        t.network === network &&
        (exact ? t.downloadSpeed === downloadSpeed : t.downloadSpeed >= downloadSpeed) &&
        (!uploadSpeed || t.uploadSpeed >= uploadSpeed),
      );
      if (tiers.length === 0) return errorResult(`No ${network} tiers match ${downloadSpeed}${uploadSpeed ? '/' + uploadSpeed : ''} Mbps. Call list_tiers.`);
      const datas = await Promise.all(tiers.map(t => readJson<TierData>(env.DATA_BUCKET, `data/plans/${t.key}.json`)));
      const plans = datas.flatMap(d => d?.plans ?? []);
      const sorted = plans.sort((a, b) => calcCosts(a, horizon).effectiveMonthly - calcCosts(b, horizon).effectiveMonthly);
      return text({
        matchedTiers: tiers.map(t => t.key),
        horizonMonths: horizon,
        totalPlans: plans.length,
        plans: sorted.slice(0, limit).map(p => summarisePlan(p, horizon)),
      });
    },
  );

  server.registerTool(
    'rate_plan',
    {
      title: 'Rate a plan price (Rort Scale)',
      description:
        'Judge whether a monthly price is fair for a tier using the site\'s Rort Scale: winning, sweet-as, bit-shit, taking-the-piss, absolute-rort. ' +
        'Compares against the cheapest ongoing price and the cheapest effective price over the horizon, and suggests alternatives.',
      inputSchema: {
        tier: tierSchema,
        monthlyPrice: z.number().positive().describe('What the user pays per month in AUD.'),
        provider: z.string().optional().describe('Current provider, used to exclude it from suggestions.'),
        horizon: horizonSchema,
      },
    },
    async ({ tier, monthlyPrice, provider, horizon }) => {
      const manifest = await loadManifest(env.DATA_BUCKET);
      const { keys, plans } = await loadPlans(env.DATA_BUCKET, manifest, tier);
      if (keys.length === 0 || plans.length === 0) return errorResult(`Unknown or empty tier "${tier}". Call list_tiers for valid keys.`);
      const cheapestOngoing = plans.reduce((m, p) => Math.min(m, p.monthlyPrice), Infinity);
      const byEffective = [...plans].sort((a, b) => calcCosts(a, horizon).effectiveMonthly - calcCosts(b, horizon).effectiveMonthly);
      const cheapestEffective = calcCosts(byEffective[0], horizon).effectiveMonthly;
      const needle = provider?.toLowerCase().trim();
      const alternatives = byEffective
        .filter(p => !needle || !p.providerName.toLowerCase().includes(needle))
        .slice(0, 3)
        .map(p => summarisePlan(p, horizon));
      return text({
        tier,
        monthlyPrice,
        horizonMonths: horizon,
        againstOngoingPrice: { cheapest: cheapestOngoing, ...rate(monthlyPrice, cheapestOngoing) },
        againstEffectivePrice: { cheapest: cheapestEffective, ...rate(monthlyPrice, cheapestEffective) },
        alternatives,
        explanation: `${SITE}/how-it-works`,
      });
    },
  );

  server.registerTool(
    'get_price_history',
    {
      title: 'Price history for a tier',
      description: 'Daily cheapest and average price for an exact tier (e.g. "nbn-100-20"), and optionally one provider\'s price history in that tier.',
      inputSchema: {
        tier: z.string().describe('Exact tier key such as "nbn-100-20". Grouped keys are not supported here.'),
        provider: z.string().optional().describe('Provider name to include per-provider history for.'),
        days: z.number().int().min(1).max(730).default(90).describe('How many most-recent entries to return.'),
      },
    },
    async ({ tier, provider, days }) => {
      const key = tier.toLowerCase().trim();
      const history = await readJson<TierHistory>(env.DATA_BUCKET, `data/history/${key}.json`);
      if (!history) return errorResult(`No history for tier "${tier}". Use an exact key from list_tiers.`);
      const needle = provider?.toLowerCase().trim();
      const providerEntry = needle
        ? Object.entries(history.providers).find(([name]) => name.toLowerCase().includes(needle))
        : undefined;
      return text({
        tier: key,
        daily: history.daily.slice(-days),
        provider: providerEntry
          ? { name: providerEntry[0], current: providerEntry[1].current, history: providerEntry[1].history.slice(-days) }
          : needle ? `No tracked history for provider "${provider}" in this tier (only the 20 cheapest providers per tier are tracked).` : undefined,
      });
    },
  );

  server.registerTool(
    'get_provider_plans',
    {
      title: 'All plans from one provider',
      description: 'Every plan a provider offers across all tiers and both networks. Use list_providers-style names, e.g. "Superloop", "Aussie Broadband".',
      inputSchema: {
        provider: z.string().describe('Case-insensitive provider name or substring.'),
        horizon: horizonSchema,
      },
    },
    async ({ provider, horizon }) => {
      const manifest = await loadManifest(env.DATA_BUCKET);
      const needle = provider.toLowerCase().trim();
      const known = manifest.providers.filter(p => p.toLowerCase().includes(needle));
      if (known.length === 0) return errorResult(`No provider matches "${provider}". Known providers: ${manifest.providers.join(', ')}`);
      const datas = await Promise.all(manifest.tiers.map(t => readJson<TierData>(env.DATA_BUCKET, `data/plans/${t.key}.json`)));
      const plans = datas
        .flatMap(d => d?.plans ?? [])
        .filter(p => p.providerName.toLowerCase().includes(needle))
        .sort((a, b) => a.networkType.localeCompare(b.networkType) || a.downloadSpeed - b.downloadSpeed || a.uploadSpeed - b.uploadSpeed);
      return text({ matchedProviders: known, horizonMonths: horizon, plans: plans.map(p => summarisePlan(p, horizon)) });
    },
  );

  return server;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const TOOL_SUMMARY = [
  'list_tiers', 'get_plans', 'find_cheapest', 'rate_plan', 'get_price_history', 'get_provider_plans',
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/mcp') {
      const server = buildServer(env);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
        enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        const res = await transport.handleRequest(request);
        return withCors(res);
      } catch (err) {
        console.error('[mcp] request failed:', err);
        return withCors(new Response(JSON.stringify({ error: String(err) }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        }));
      } finally {
        request.signal.addEventListener('abort', () => { void transport.close(); }, { once: true });
      }
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return withCors(new Response(JSON.stringify({
        name: 'amigettingrorted MCP server',
        description: 'Australian NBN and Opticomm plan prices for AI agents. Data refreshed daily.',
        transport: 'streamable-http',
        endpoint: `${url.origin}/mcp`,
        auth: 'none',
        tools: TOOL_SUMMARY,
        site: SITE,
        example: {
          claudeCode: `claude mcp add --transport http amigettingrorted ${url.origin}/mcp`,
        },
      }, null, 2), { headers: { 'Content-Type': 'application/json' } }));
    }

    return withCors(new Response('Not found', { status: 404 }));
  },
} satisfies ExportedHandler<Env>;
