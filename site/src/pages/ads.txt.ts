import type { APIRoute } from 'astro';
import { ADSENSE_CLIENT } from '../lib/site';

// Google AdSense requires /ads.txt to list the publisher ID.
// Publisher ID comes from PUBLIC_ADSENSE_CLIENT or the default in lib/site.ts.
export const GET: APIRoute = () => {
  const client = ADSENSE_CLIENT;
  if (!client) return new Response('Not found', { status: 404 });
  const publisherId = client.replace(/^ca-/, '');
  return new Response(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
};
