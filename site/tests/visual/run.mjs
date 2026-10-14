/**
 * Captures screenshots of two versions of the site and writes the diff report.
 *
 * Against fixture data, building the base and this checkout locally:
 *   node tests/visual/run.mjs --base-ref origin/main        # makes a temporary worktree of the ref
 *   node tests/visual/run.mjs --base-dir ../../base/site    # or a base checkout that already exists (CI)
 *
 * Against two deployments of the site, such as production and a PR preview. Both read the same data, so any
 * difference comes from the code:
 *   node tests/visual/run.mjs --base-url https://amigettingrorted.au --head-url https://pr-12-....workers.dev
 *
 * Output goes to visual-output/{base,head} and visual-report/.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { values } = parseArgs({
  options: {
    'base-ref': { type: 'string' },
    'base-dir': { type: 'string' },
    'base-url': { type: 'string' },
    'head-url': { type: 'string' },
    'base-label': { type: 'string' },
    'head-label': { type: 'string' },
    out: { type: 'string', default: 'visual-report' },
    note: { type: 'string' },
  },
});
const urlMode = Boolean(values['base-url'] || values['head-url']);
if (urlMode && !(values['base-url'] && values['head-url'])) {
  console.error('Pass both --base-url and --head-url');
  process.exit(2);
}
if (!urlMode && !values['base-ref'] && !values['base-dir']) {
  console.error('Pass --base-ref <git ref>, --base-dir <path to a base site checkout>, or --base-url and --head-url');
  process.exit(2);
}

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: siteDir, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
};
const git = (...a) => run('git', a);

const capture = (label, env) => {
  rmSync(join(siteDir, 'visual-output', label), { recursive: true, force: true });
  run('node_modules/.bin/playwright', ['test', '--project=visual'], {
    env: { ...process.env, SHOTS_DIR: join('visual-output', label), ...env },
  });
};

let worktree = null;
let baseLabel = values['base-label'];
let headLabel = values['head-label'];
let note = values.note;

try {
  if (urlMode) {
    const strip = (u) => u.replace(/\/$/, '');
    const base = strip(values['base-url']);
    const head = strip(values['head-url']);
    // Both sides share the clock, the cache-buster and the list of pages
    const shared = { DISCOVER_URL: base, FREEZE_TIME: new Date().toISOString(), VD_BUST: String(Date.now()) };
    capture('base', { ...shared, BASE_URL: base });
    capture('head', { ...shared, BASE_URL: head });
    baseLabel ??= 'production';
    headLabel ??= 'preview';
    note ??= 'Production and the preview read the same data, so differences come from the code. Commits on `main` that the PR branch lacks also show up.';
  } else {
    let baseSite = values['base-dir'] ? resolve(values['base-dir']) : null;
    if (!baseSite) {
      worktree = join(mkdtempSync(join(tmpdir(), 'visual-base-')), 'repo');
      git('worktree', 'add', '--detach', worktree, values['base-ref']);
      baseSite = join(worktree, 'site');
      // pnpm 9 matches CI's lockfile. Override with PNPM="npx --yes pnpm@9" if pnpm is a different major locally.
      const [pnpm, ...pnpmArgs] = (process.env.PNPM ?? 'pnpm').split(' ');
      run(pnpm, [...pnpmArgs, 'install', '--frozen-lockfile'], { cwd: worktree });
    }
    if (!existsSync(join(baseSite, 'node_modules'))) throw new Error(`${baseSite} has no node_modules. Install dependencies there first.`);
    capture('base', { SITE_DIR: baseSite, PORT: '4322' });
    capture('head', { SITE_DIR: siteDir, PORT: '4321' });
    baseLabel ??= values['base-ref'] ?? 'base';
  }

  run('node', [
    'tests/visual/compare.mjs', '--base', 'visual-output/base', '--head', 'visual-output/head', '--out', values.out,
    '--base-label', baseLabel,
    ...(headLabel ? ['--head-label', headLabel] : []),
    ...(note ? ['--note', note] : []),
  ]);
  console.log(`\nReport: ${join(siteDir, values.out, 'index.html')}`);
} finally {
  if (worktree) spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: siteDir, stdio: 'inherit' });
}
