/**
 * Loads tests/fixtures/data into the local R2 bucket that `astro dev` and `astro preview` read from.
 *
 *   node tests/seed-r2.mjs [site-dir]
 *
 * workerd cannot see the host filesystem, so the public/data fallback in local-data.ts never
 * works under the Cloudflare adapter. The pages read DATA_BUCKET, so the fixtures go there.
 * `site-dir` defaults to this checkout; CI also passes a checkout of the base branch.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';

const testsDir = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(process.argv[2] ?? join(testsDir, '..'));
const fixtureDir = join(testsDir, 'fixtures', 'data');

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const { env, dispose } = await getPlatformProxy({
  configPath: join(siteDir, 'wrangler.jsonc'),
  // Miniflare keeps each binding type under <persist>/<type>; wrangler's own default is .wrangler/state/v3
  persist: { path: join(siteDir, '.wrangler', 'state', 'v3') },
});
let count = 0;
for (const file of walk(fixtureDir)) {
  const key = `data/${relative(fixtureDir, file).split('\\').join('/')}`;
  await env.DATA_BUCKET.put(key, readFileSync(file), { httpMetadata: { contentType: 'application/json' } });
  count++;
}
await dispose();
console.log(`Seeded ${count} fixture objects into ${siteDir}/.wrangler/state/v3`);
