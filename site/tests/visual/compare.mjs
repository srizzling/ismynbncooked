/**
 * Diffs two folders of screenshots and writes an HTML report.
 *
 *   node tests/visual/compare.mjs --base visual-output/base --head visual-output/head --out visual-report
 *
 * Writes:
 *   index.html         self-contained report (images inlined), open it straight from the CI artifact
 *   summary.json       counts and the list of changed pages
 *   images/            base, head and diff PNGs of the pages shown in the comment, for publishing next to it
 *   comment.md         PR comment with the diffs embedded as images (only when something changed)
 *   comment-plain.md   the same without images, for when they could not be published
 *
 * The comments contain {{IMAGE_BASE}} and {{ARTIFACT_URL}}, which the workflow fills in once it knows them.
 *
 * Always exits 0. The workflow decides what to do with the result.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const { values: args } = parseArgs({
  options: {
    base: { type: 'string' },
    head: { type: 'string' },
    out: { type: 'string', default: 'visual-report' },
    // pixelmatch colour sensitivity: 0 is exact, 1 matches anything. 0.1 ignores anti-aliasing noise.
    threshold: { type: 'string', default: '0.1' },
    // Changed pixels tolerated before a page counts as changed
    'min-pixels': { type: 'string', default: '0' },
    // How many changed pages get their images embedded in the comment, biggest change first
    'max-inline': { type: 'string', default: '8' },
    'base-label': { type: 'string', default: 'base' },
    // One line under the heading that says what was compared
    note: { type: 'string', default: 'Same fixture data, built from the base branch and from this PR.' },
    'head-label': { type: 'string', default: 'this PR' },
  },
});
if (!args.base || !args.head) {
  console.error('Usage: compare.mjs --base <dir> --head <dir> [--out <dir>]');
  process.exit(2);
}
const threshold = Number(args.threshold);
const minPixels = Number(args['min-pixels']);

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.png')) yield p;
  }
}
const list = (dir) => new Map([...walk(dir)].map((p) => [relative(dir, p).split('\\').join('/'), p]));

/** Copy onto a canvas of the given size, transparent where the image is smaller. */
function pad(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}

const baseFiles = list(args.base);
const headFiles = list(args.head);
const names = [...new Set([...baseFiles.keys(), ...headFiles.keys()])].sort();

const results = [];
for (const name of names) {
  const b = baseFiles.get(name);
  const h = headFiles.get(name);
  if (!b) { results.push({ name, status: 'added', head: readFileSync(h) }); continue; }
  if (!h) { results.push({ name, status: 'removed', base: readFileSync(b) }); continue; }

  const baseBuf = readFileSync(b);
  const headBuf = readFileSync(h);
  if (baseBuf.equals(headBuf)) { results.push({ name, status: 'same' }); continue; }

  const base = PNG.sync.read(baseBuf);
  const head = PNG.sync.read(headBuf);
  const width = Math.max(base.width, head.width);
  const height = Math.max(base.height, head.height);
  const diff = new PNG({ width, height });
  const pixels = pixelmatch(pad(base, width, height).data, pad(head, width, height).data, diff.data, width, height, { threshold });
  const resized = base.width !== head.width || base.height !== head.height;

  if (pixels <= minPixels && !resized) { results.push({ name, status: 'same' }); continue; }
  results.push({
    name, status: 'changed', pixels, percent: (pixels / (width * height)) * 100, resized,
    baseSize: `${base.width}×${base.height}`, headSize: `${head.width}×${head.height}`,
    base: baseBuf, head: headBuf, diff: PNG.sync.write(diff),
  });
}

const changed = results.filter((r) => r.status === 'changed');
const added = results.filter((r) => r.status === 'added');
const removed = results.filter((r) => r.status === 'removed');
const same = results.filter((r) => r.status === 'same');
const differing = [...changed, ...added, ...removed];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const uri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const pct = (n) => (n < 0.01 ? '<0.01' : n.toFixed(2));

function card(r, i) {
  const title = `<h2 id="p${i}"><code>${esc(r.name)}</code> <span class="tag ${r.status}">${r.status}${r.status === 'changed' ? ` · ${pct(r.percent)}% of pixels` : ''}</span></h2>`;
  if (r.status === 'added') return `<section>${title}<img src="${uri(r.head)}" alt="new page"></section>`;
  if (r.status === 'removed') return `<section>${title}<img src="${uri(r.base)}" alt="removed page"></section>`;
  const note = r.resized ? `<p class="note">Size changed: ${r.baseSize} → ${r.headSize}</p>` : '';
  return `<section data-card>${title}${note}
    <div class="tabs" role="tablist">
      <button data-tab="side" class="on">Side by side</button><button data-tab="diff">Diff</button><button data-tab="swipe">Swipe</button>
    </div>
    <div class="pane side"><figure><figcaption>${esc(args['base-label'])}</figcaption><img src="${uri(r.base)}" loading="lazy"></figure>
      <figure><figcaption>${esc(args['head-label'])}</figcaption><img src="${uri(r.head)}" loading="lazy"></figure></div>
    <div class="pane diff" hidden><img src="${uri(r.diff)}" loading="lazy"></div>
    <div class="pane swipe" hidden>
      <input type="range" min="0" max="100" value="50" aria-label="Swipe between base and head">
      <div class="stack"><img src="${uri(r.base)}" loading="lazy"><img class="top" src="${uri(r.head)}" loading="lazy" style="clip-path: inset(0 50% 0 0)"></div>
    </div></section>`;
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visual diff report</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 24px; background: #0a0a0a; color: #e5e5e5; }
  h1 { margin: 0 0 4px; } h2 { font-size: 1rem; margin: 0 0 12px; }
  .summary { color: #a3a3a3; margin-bottom: 20px; }
  nav ul { columns: 2; padding-left: 18px; } nav a { color: #fb923c; }
  section { border: 1px solid #262626; border-radius: 12px; padding: 16px; margin: 20px 0; background: #141414; }
  .tag { font-size: .75rem; padding: 2px 8px; border-radius: 999px; margin-left: 8px; font-weight: 500; }
  .changed { background: #7c2d12; } .added { background: #14532d; } .removed { background: #7f1d1d; }
  .note { color: #facc15; font-size: .85rem; }
  .tabs button { background: #262626; color: inherit; border: 0; padding: 6px 12px; border-radius: 8px; cursor: pointer; margin-right: 6px; }
  .tabs button.on { background: #f97316; color: #fff; }
  .pane { margin-top: 12px; } .pane[hidden] { display: none; }
  .side { display: flex; gap: 12px; align-items: flex-start; } .side figure { flex: 1; margin: 0; min-width: 0; }
  figcaption { color: #a3a3a3; font-size: .8rem; margin-bottom: 6px; }
  img { max-width: 100%; display: block; border: 1px solid #262626; }
  .stack { position: relative; } .stack .top { position: absolute; inset: 0; }
  input[type=range] { width: 100%; }
  .clean { color: #4ade80; }
</style></head><body>
<h1>Visual diff report</h1>
<p class="summary">${esc(args['base-label'])} vs ${esc(args['head-label'])} · ${results.length} images ·
  <b>${changed.length}</b> changed · ${added.length} added · ${removed.length} removed · ${same.length} identical</p>
${differing.length === 0 ? '<p class="clean">No visual changes.</p>' : `<nav><ul>${differing.map((r, i) => `<li><a href="#p${i}">${esc(r.name)}</a> (${r.status})</li>`).join('')}</ul></nav>`}
${differing.map(card).join('\n')}
<script>
  for (const card of document.querySelectorAll('[data-card]')) {
    const tabs = card.querySelectorAll('[data-tab]');
    for (const t of tabs) t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('on', x === t));
      for (const p of card.querySelectorAll('.pane')) p.hidden = !p.classList.contains(t.dataset.tab);
    });
    const range = card.querySelector('input[type=range]');
    range.addEventListener('input', () => { card.querySelector('.top').style.clipPath = 'inset(0 ' + (100 - range.value) + '% 0 0)'; });
  }
</script></body></html>`;

mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, 'index.html'), html);

const summary = {
  total: results.length,
  changed: changed.map((r) => ({ name: r.name, pixels: r.pixels, percent: Number(r.percent.toFixed(3)), resized: r.resized })),
  added: added.map((r) => r.name),
  removed: removed.map((r) => r.name),
  identical: same.length,
};
writeFileSync(join(args.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

const slug = (name) => name.replace(/\.png$/, '').replace(/\//g, '-');

if (differing.length > 0) {
  const rows = [
    ...changed.map((r) => `| \`${r.name}\` | changed | ${pct(r.percent)}%${r.resized ? ` (size ${r.baseSize} → ${r.headSize})` : ''} |`),
    ...added.map((r) => `| \`${r.name}\` | added | |`),
    ...removed.map((r) => `| \`${r.name}\` | removed | |`),
  ];
  const head = [
    `### Visual changes: ${differing.length} of ${results.length} screenshots differ`,
    '',
    `${args.note} ${same.length} identical.`,
    '',
  ];
  const table = ['| Screenshot | Result | Pixels changed |', '|---|---|---|', ...rows, ''];
  // A big change (a shared stylesheet, say) touches every page; fold the list away so the images stay visible
  const listing = rows.length > 8
    ? ['<details>', `<summary>All ${rows.length} differing screenshots</summary>`, '', ...table, '</details>', '']
    : table;
  const link = [
    '**[Open the full HTML report]({{ARTIFACT_URL}})**: download the artifact and open `index.html` for side by side, diff and swipe views.',
    '',
  ];

  const inline = [...changed].sort((a, b) => b.percent - a.percent).slice(0, Number(args['max-inline']));
  // Only the pages shown in the comment are published; the HTML report carries all of them
  mkdirSync(join(args.out, 'images'), { recursive: true });
  for (const r of inline) {
    writeFileSync(join(args.out, 'images', `${slug(r.name)}.base.png`), r.base);
    writeFileSync(join(args.out, 'images', `${slug(r.name)}.head.png`), r.head);
    writeFileSync(join(args.out, 'images', `${slug(r.name)}.diff.png`), r.diff);
  }
  const img = (r, kind) => `![${kind}]({{IMAGE_BASE}}/${slug(r.name)}.${kind}.png)`;
  const shown = inline.flatMap((r) => [
    '<details>',
    `<summary><code>${r.name}</code> · ${pct(r.percent)}%</summary>`,
    '',
    '| Base | This PR | Diff |',
    '|---|---|---|',
    `| ${img(r, 'base')} | ${img(r, 'head')} | ${img(r, 'diff')} |`,
    '',
    '</details>',
    '',
  ]);
  const more = changed.length > inline.length
    ? [`_${changed.length - inline.length} more changed screenshots are in the HTML report._`, '']
    : [];

  writeFileSync(join(args.out, 'comment.md'), [...head, ...listing, ...shown, ...more, ...link].join('\n'));
  writeFileSync(join(args.out, 'comment-plain.md'), [...head, ...listing, ...link].join('\n'));
}

console.log(`${results.length} images: ${changed.length} changed, ${added.length} added, ${removed.length} removed, ${same.length} identical`);
for (const r of changed) console.log(`  changed  ${r.name}  ${pct(r.percent)}%`);
for (const r of added) console.log(`  added    ${r.name}`);
for (const r of removed) console.log(`  removed  ${r.name}`);
