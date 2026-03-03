// Worker that serves R2 data at /data/* and falls through to static assets for everything else.
// This avoids CORS issues by serving data from the same origin as the site.

interface Env {
  ASSETS: Fetcher;
  DATA_BUCKET: R2Bucket;
}

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
  'Access-Control-Allow-Origin': '*',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve R2 data at /data/*
    if (url.pathname.startsWith('/data/')) {
      const key = url.pathname.slice('/data/'.length);
      if (!key) {
        return new Response('Not found', { status: 404 });
      }

      const object = await env.DATA_BUCKET.get(key);
      if (!object) {
        return new Response('Not found', { status: 404 });
      }

      return new Response(object.body, {
        headers: {
          'Content-Type': 'application/json',
          'ETag': object.httpEtag,
          ...CACHE_HEADERS,
        },
      });
    }

    // Everything else: serve static assets
    return env.ASSETS.fetch(request);
  },
};
