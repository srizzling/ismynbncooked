/**
 * Builds a site checkout, seeds its local R2 bucket with the fixtures and serves it with `astro preview`.
 *
 *   SITE_DIR=../base/site PORT=4322 node tests/serve.mjs
 *
 * `--ignore-lock` keeps the server in the foreground (Astro backgrounds it when it detects an agent)
 * and lets the base and head servers run side by side.
 *
 * The edge cache middleware stores rendered pages in the local Cache API, so the wrangler state is wiped
 * first. Otherwise a page rendered against yesterday's data could be served for today's run.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(process.env.SITE_DIR ?? join(testsDir, '..'));
const port = process.env.PORT ?? '4321';
const astro = join(siteDir, 'node_modules', '.bin', 'astro');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: siteDir, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!existsSync(astro)) {
  console.error(`No astro binary at ${astro}. Run pnpm install in that checkout first.`);
  process.exit(1);
}

// Call the astro binary directly: `pnpm build` runs a deps check that wants a TTY under pnpm 11.
if (process.env.SKIP_BUILD !== '1') run(astro, ['build']);

rmSync(join(siteDir, '.wrangler', 'state'), { recursive: true, force: true });
run('node', [join(testsDir, 'seed-r2.mjs'), siteDir], { cwd: testsDir });

const server = spawn(astro, ['preview', '--port', port, '--host', '127.0.0.1', '--ignore-lock'], { stdio: 'inherit', cwd: siteDir });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
