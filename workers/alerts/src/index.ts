/**
 * Price and promo alerts.
 *
 *   POST /subscribe      { email, tierKey, monthlyPrice?, promoEndsAt?, provider? }
 *   GET  /confirm?t=     double opt-in, then redirects to the site
 *   GET  /unsubscribe?t= removes the subscriber, then redirects to the site
 *   cron daily           emails subscribers whose promo ends within 14 days, or
 *                        whose tier now has a plan at least 5% cheaper than they pay
 *
 * Subscribers live in R2 as data/alerts/subscribers/{id}.json (id = sha256 of the
 * lower-cased email) with a token index at data/alerts/tokens/{token}.json.
 * Emails go through Resend. Without RESEND_API_KEY they are logged instead.
 */

interface Env {
  DATA_BUCKET: R2Bucket;
  SITE_URL: string;
  ALERTS_FROM: string;
  RESEND_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
}

interface Subscriber {
  id: string;
  email: string;
  tierKey: string;
  /** What they pay now (ongoing), used for "cheaper plan" alerts */
  monthlyPrice: number | null;
  /** YYYY-MM-DD when their promo pricing ends */
  promoEndsAt: string | null;
  provider: string | null;
  confirmed: boolean;
  token: string;
  createdAt: string;
  confirmedAt: string | null;
  /** Cheapest price we last told them about, so we only email on a further drop */
  lastNotifiedCheapest: number | null;
  promoNotified: boolean;
  lastEmailAt: string | null;
}

interface NBNPlan {
  providerName: string;
  planName: string;
  monthlyPrice: number;
  effectiveMonthly: number;
  promoValue: number | null;
  promoDuration: number | null;
  typicalEveningSpeed: number | null;
}

interface TierData {
  tierKey: string;
  label: string;
  planCount: number;
  cheapest: number;
  plans: NBNPlan[];
}

const SUB_PREFIX = 'data/alerts/subscribers/';
const TOKEN_PREFIX = 'data/alerts/tokens/';
const TIER_KEY = /^(nbn|opticomm)-\d+-\d+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PROMO_WARNING_DAYS = 14;
const CHEAPER_THRESHOLD = 0.95;

// ─── helpers ─────────────────────────────────────────────────────────────────

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function corsHeaders(request: Request, env: Env): Record<string, string> | null {
  const origin = request.headers.get('Origin') ?? '';
  if (!env.ALLOWED_ORIGINS) return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  const allowed = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  if (!allowed.includes(origin)) return null;
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  try {
    const obj = await bucket.get(key);
    return obj ? (await obj.json() as T) : null;
  } catch {
    return null;
  }
}

async function saveSubscriber(bucket: R2Bucket, sub: Subscriber): Promise<void> {
  await bucket.put(`${SUB_PREFIX}${sub.id}.json`, JSON.stringify(sub), { httpMetadata: { contentType: 'application/json' } });
  await bucket.put(`${TOKEN_PREFIX}${sub.token}.json`, JSON.stringify({ id: sub.id }), { httpMetadata: { contentType: 'application/json' } });
}

async function findByToken(bucket: R2Bucket, token: string): Promise<Subscriber | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const ref = await readJson<{ id: string }>(bucket, `${TOKEN_PREFIX}${token}.json`);
  if (!ref) return null;
  const sub = await readJson<Subscriber>(bucket, `${SUB_PREFIX}${ref.id}.json`);
  return sub && sub.token === token ? sub : null;
}

async function deleteSubscriber(bucket: R2Bucket, sub: Subscriber): Promise<void> {
  await bucket.delete(`${SUB_PREFIX}${sub.id}.json`);
  await bucket.delete(`${TOKEN_PREFIX}${sub.token}.json`);
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ─── email ───────────────────────────────────────────────────────────────────

interface Mail { to: string; subject: string; text: string; html: string }

async function sendMail(env: Env, mail: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[alerts] (dry run, no RESEND_API_KEY) To: ${mail.to} | ${mail.subject}\n${mail.text}`);
    return true;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.ALERTS_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (!res.ok) {
    console.error(`[alerts] Resend error ${res.status}: ${await res.text()}`);
    return false;
  }
  return true;
}

function layout(env: Env, sub: Subscriber, title: string, bodyHtml: string, bodyText: string): Mail {
  const unsub = `${env.SITE_URL.replace(/\/$/, '')}`;
  const unsubUrl = `${workerBase(env)}/unsubscribe?t=${sub.token}`;
  const text = `${bodyText}\n\n—\nYou get this because you asked for ${sub.tierKey.toUpperCase()} price alerts at ${env.SITE_URL}.\nUnsubscribe: ${unsubUrl}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#0a0a0a;color:#e5e5e5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5">
<div style="max-width:560px;margin:0 auto">
<p style="font-size:12px;color:#737373;margin:0 0 16px"><a href="${unsub}" style="color:#f97316;text-decoration:none;font-weight:700">amigettingrorted.au</a></p>
<h1 style="font-size:22px;margin:0 0 16px;color:#fff">${escapeHtml(title)}</h1>
${bodyHtml}
<p style="font-size:12px;color:#737373;margin-top:32px;border-top:1px solid #262626;padding-top:12px">
You get this because you asked for ${escapeHtml(sub.tierKey.toUpperCase())} price alerts. Prices can be wrong; always check the provider's site.<br>
<a href="${unsubUrl}" style="color:#a3a3a3">Unsubscribe</a></p>
</div></body></html>`;
  return { to: sub.email, subject: title, text, html };
}

let WORKER_BASE = '';
function workerBase(env: Env): string {
  return WORKER_BASE || 'https://ismynbncooked-alerts.venksriram.workers.dev';
}

function plansTable(plans: NBNPlan[], siteUrl: string, tierKey: string): { html: string; text: string } {
  const rows = plans.map(p => {
    const promo = p.promoValue && p.promoDuration ? ` (${money(p.monthlyPrice - p.promoValue)} for the first ${p.promoDuration} months)` : '';
    return { name: `${p.providerName} — ${p.planName}`, price: `${money(p.monthlyPrice)}/mo${promo}` };
  });
  const html = `<table style="border-collapse:collapse;width:100%;margin:12px 0">${rows.map(r =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #262626">${escapeHtml(r.name)}</td><td style="padding:6px 0;border-bottom:1px solid #262626;text-align:right;white-space:nowrap;color:#fff">${escapeHtml(r.price)}</td></tr>`).join('')}</table>
<p><a href="${siteUrl}/${tierKey}" style="color:#f97316">See every ${escapeHtml(tierKey.toUpperCase())} plan →</a></p>`;
  const text = rows.map(r => `• ${r.name}: ${r.price}`).join('\n') + `\n\nSee every plan: ${siteUrl}/${tierKey}`;
  return { html, text };
}

// ─── alert rules ─────────────────────────────────────────────────────────────

function daysUntil(date: string, today: string): number {
  return Math.round((new Date(date).getTime() - new Date(today).getTime()) / 86400000);
}

async function processSubscriber(env: Env, sub: Subscriber, tier: TierData, today: string): Promise<Subscriber> {
  const site = env.SITE_URL.replace(/\/$/, '');
  const top = [...tier.plans].sort((a, b) => a.monthlyPrice - b.monthlyPrice).slice(0, 3);
  let changed = false;

  // Promo ending soon
  if (sub.promoEndsAt && !sub.promoNotified) {
    const days = daysUntil(sub.promoEndsAt, today);
    if (days <= PROMO_WARNING_DAYS) {
      const when = days <= 0 ? 'has ended' : days === 1 ? 'ends tomorrow' : `ends in ${days} days`;
      const table = plansTable(top, site, sub.tierKey);
      const title = `Your ${sub.provider ? sub.provider + ' ' : ''}promo ${when}`;
      const intro = `Your promo price ${when}${sub.monthlyPrice ? `, and the ongoing price is ${money(sub.monthlyPrice)}/mo` : ''}. ` +
        `This is the moment to churn. The cheapest ${tier.label} plans right now:`;
      const mail = layout(env, sub, title, `<p>${escapeHtml(intro)}</p>${table.html}<p>No lock-in means no excuses. Switch, take the new promo, set a reminder to do it again.</p>`, `${intro}\n\n${table.text}`);
      if (await sendMail(env, mail)) {
        sub.promoNotified = true;
        sub.lastEmailAt = new Date().toISOString();
        changed = true;
      }
    }
  }

  // Cheaper plan available
  const cheapest = top[0]?.monthlyPrice;
  if (cheapest != null) {
    const baseline = sub.monthlyPrice ?? sub.lastNotifiedCheapest;
    const meaningfullyCheaper = baseline != null && cheapest <= baseline * CHEAPER_THRESHOLD;
    const notAlreadyTold = sub.lastNotifiedCheapest == null || cheapest < sub.lastNotifiedCheapest - 0.5;
    if (meaningfullyCheaper && notAlreadyTold) {
      const saving = sub.monthlyPrice ? sub.monthlyPrice - cheapest : null;
      const table = plansTable(top, site, sub.tierKey);
      const title = saving
        ? `${tier.label}: a plan ${money(saving)}/mo cheaper than yours`
        : `${tier.label}: cheapest plan dropped to ${money(cheapest)}/mo`;
      const intro = saving
        ? `${top[0].providerName} now has a ${tier.label} plan at ${money(cheapest)}/mo ongoing. You told us you pay ${money(sub.monthlyPrice!)}/mo, so that's ${money(saving * 12)} a year.`
        : `The cheapest ${tier.label} plan is now ${money(cheapest)}/mo ongoing from ${top[0].providerName}.`;
      const mail = layout(env, sub, title, `<p>${escapeHtml(intro)}</p>${table.html}`, `${intro}\n\n${table.text}`);
      if (await sendMail(env, mail)) {
        sub.lastNotifiedCheapest = cheapest;
        sub.lastEmailAt = new Date().toISOString();
        changed = true;
      }
    } else if (sub.lastNotifiedCheapest == null) {
      // First run after confirming: record the baseline silently so we only email on real drops
      sub.lastNotifiedCheapest = cheapest;
      changed = true;
    }
  }

  return changed ? sub : sub;
}

// ─── handlers ────────────────────────────────────────────────────────────────

async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (!cors) return json({ ok: false, error: 'Forbidden' }, 403);

  let body: { email?: string; tierKey?: string; monthlyPrice?: number | string; promoEndsAt?: string; provider?: string; website?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400, cors);
  }

  // Honeypot field: real users never fill it
  if (body.website) return json({ ok: true }, 200, cors);

  const email = (body.email ?? '').trim().toLowerCase();
  const tierKey = (body.tierKey ?? '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return json({ ok: false, error: 'Enter a valid email address' }, 400, cors);
  if (!TIER_KEY.test(tierKey)) return json({ ok: false, error: 'Pick a speed tier' }, 400, cors);
  const monthlyPrice = body.monthlyPrice != null && body.monthlyPrice !== '' ? Number(body.monthlyPrice) : null;
  if (monthlyPrice != null && (!Number.isFinite(monthlyPrice) || monthlyPrice <= 0 || monthlyPrice > 1000)) {
    return json({ ok: false, error: 'Monthly price looks wrong' }, 400, cors);
  }
  const promoEndsAt = body.promoEndsAt && /^\d{4}-\d{2}-\d{2}$/.test(body.promoEndsAt) ? body.promoEndsAt : null;
  const provider = body.provider?.trim().slice(0, 80) || null;

  const id = await sha256(email);
  const existing = await readJson<Subscriber>(env.DATA_BUCKET, `${SUB_PREFIX}${id}.json`);
  const sub: Subscriber = existing
    ? { ...existing, tierKey, monthlyPrice, promoEndsAt, provider, promoNotified: false, lastNotifiedCheapest: null }
    : {
        id, email, tierKey, monthlyPrice, promoEndsAt, provider,
        confirmed: false, token: randomToken(), createdAt: new Date().toISOString(), confirmedAt: null,
        lastNotifiedCheapest: null, promoNotified: false, lastEmailAt: null,
      };

  await saveSubscriber(env.DATA_BUCKET, sub);

  if (!sub.confirmed) {
    const confirmUrl = `${new URL(request.url).origin}/confirm?t=${sub.token}`;
    const text = `Confirm your ${tierKey.toUpperCase()} price alerts by opening this link:\n${confirmUrl}\n\nIf you didn't ask for this, ignore it and nothing happens.`;
    const html = `<p>Confirm your ${escapeHtml(tierKey.toUpperCase())} price alerts:</p><p><a href="${confirmUrl}" style="display:inline-block;background:#f97316;color:#000;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none">Confirm alerts</a></p><p style="color:#a3a3a3;font-size:13px">If you didn't ask for this, ignore it and nothing happens.</p>`;
    await sendMail(env, layout(env, sub, 'Confirm your NBN price alerts', html, text));
  }

  return json({ ok: true, confirmed: sub.confirmed }, 200, cors);
}

async function handleConfirm(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const sub = await findByToken(env.DATA_BUCKET, token);
  const site = env.SITE_URL.replace(/\/$/, '');
  if (!sub) return Response.redirect(`${site}/alerts/invalid`, 302);
  if (!sub.confirmed) {
    sub.confirmed = true;
    sub.confirmedAt = new Date().toISOString();
    await saveSubscriber(env.DATA_BUCKET, sub);
  }
  return Response.redirect(`${site}/alerts/confirmed?tier=${encodeURIComponent(sub.tierKey)}`, 302);
}

async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const sub = await findByToken(env.DATA_BUCKET, token);
  const site = env.SITE_URL.replace(/\/$/, '');
  if (!sub) return Response.redirect(`${site}/alerts/invalid`, 302);
  await deleteSubscriber(env.DATA_BUCKET, sub);
  return Response.redirect(`${site}/alerts/unsubscribed`, 302);
}

async function runAlerts(env: Env): Promise<{ checked: number; emailed: number }> {
  const today = new Date().toISOString().split('T')[0];
  const tierCache = new Map<string, TierData | null>();
  let checked = 0;
  let emailed = 0;
  let cursor: string | undefined;

  do {
    const listed = await env.DATA_BUCKET.list({ prefix: SUB_PREFIX, cursor });
    for (const obj of listed.objects) {
      const sub = await readJson<Subscriber>(env.DATA_BUCKET, obj.key);
      if (!sub || !sub.confirmed) continue;
      checked++;

      if (!tierCache.has(sub.tierKey)) {
        tierCache.set(sub.tierKey, await readJson<TierData>(env.DATA_BUCKET, `data/plans/${sub.tierKey}.json`));
      }
      const tier = tierCache.get(sub.tierKey);
      if (!tier) continue;

      const before = sub.lastEmailAt;
      const updated = await processSubscriber(env, sub, tier, today);
      if (updated.lastEmailAt !== before) emailed++;
      await saveSubscriber(env.DATA_BUCKET, updated);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  console.log(`[alerts] checked ${checked} subscribers, sent ${emailed} emails`);
  return { checked, emailed };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    WORKER_BASE = url.origin;

    if (request.method === 'OPTIONS') {
      const cors = corsHeaders(request, env);
      return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    }
    if (url.pathname === '/subscribe' && request.method === 'POST') return handleSubscribe(request, env);
    if (url.pathname === '/confirm' && request.method === 'GET') return handleConfirm(request, env);
    if (url.pathname === '/unsubscribe' && request.method === 'GET') return handleUnsubscribe(request, env);
    if (url.pathname === '/run' && request.method === 'POST') {
      // Manual trigger for testing; only useful with the R2 data in place
      return json({ ok: true, ...(await runAlerts(env)) });
    }
    if (url.pathname === '/') return json({ name: 'amigettingrorted alerts', endpoints: ['POST /subscribe', 'GET /confirm?t=', 'GET /unsubscribe?t='] });
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await runAlerts(env);
  },
} satisfies ExportedHandler<Env>;
