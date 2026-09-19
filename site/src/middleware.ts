import { defineMiddleware } from 'astro:middleware';

/**
 * Edge cache for rendered pages.
 *
 * Every page is server-rendered from R2 on each request, which costs 400 ms to
 * 1.8 s of server time. The data only changes at the daily sync, so public GET
 * pages are cached in Cloudflare's Cache API for ten minutes. Anything personal
 * or transactional (share cards with user data, alerts, submit, admin) is never
 * cached. Image endpoints keep their own Cache-Control.
 */
const CACHEABLE = new RegExp(
  '^/(' +
  [
    '',                               // home
    '(nbn|opticomm)-[0-9]+(-[0-9]+)?', // tier pages
    'providers',
    'provider/[a-z0-9-]+',
    'reports',
    'reports/[0-9]{4}-[0-9]{2}',
    'reports/feed\\.xml',
    'trends',
    'embed/trends',
    'how-it-works',
    'privacy',
    'sitemap\\.xml',
    'og/(cheapest|trends|tiers)\\.png',
    'og/(report|provider)/[a-z0-9-]+\\.png',
  ].join('|') +
  ')$',
);

const EDGE_TTL = 600;    // seconds a rendered page lives at the edge
const BROWSER_TTL = 60;  // seconds a browser may reuse it without asking

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, locals } = context;
  const runtime = (locals as any).runtime;
  const cache: Cache | undefined = runtime?.caches?.default;

  if (request.method !== 'GET' || !cache || !CACHEABLE.test(url.pathname)) {
    return next();
  }

  const key = new Request(url.toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('x-edge-cache', 'HIT');
    return new Response(hit.body, { status: hit.status, headers });
  }

  const response = await next();
  if (response.status !== 200) return response;

  const headers = new Headers(response.headers);
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', `public, max-age=${BROWSER_TTL}, s-maxage=${EDGE_TTL}`);
  }
  headers.set('x-edge-cache', 'MISS');
  const out = new Response(response.body, { status: response.status, headers });

  const store = cache.put(key, out.clone());
  if (runtime?.ctx?.waitUntil) runtime.ctx.waitUntil(store); else await store.catch(() => {});
  return out;
});
