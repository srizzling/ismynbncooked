# Tests

There are four kinds of test.

| Kind | Where | Command (from `site/`) | Runs in |
|---|---|---|---|
| Unit tests for `src/lib` | `tests/unit` | `pnpm exec vitest run` | `test.yml` |
| End to end tests on fixture data | `tests/e2e` | `pnpm exec playwright test --project=e2e` | `test.yml` |
| Smoke tests against a deployed site | `tests/live` | `BASE_URL=<site> pnpm exec playwright test --project=live` | `preview.yml` |
| Visual diff | `tests/visual` | see below | `preview.yml`, and `test.yml` for PRs with no preview |

If `pnpm test` fails with a dependency check error, call the binaries directly as shown above. pnpm 11 tries to reinstall without a terminal.

The first time, install the browser with `pnpm exec playwright install chromium`.

## Fixture data

The site reads its data from an R2 bucket. The tests use a fixed set of data in `tests/fixtures/data` instead, so results never depend on live prices.

- `tests/fixtures/generate.mjs` writes that folder. Edit the tables at the top of the script and run `pnpm fixtures` to change the data. The output has no randomness, so running it twice gives the same files.
- `tests/serve.mjs` builds the site, loads the fixtures into the local R2 bucket (`tests/seed-r2.mjs`) and starts `astro preview`. It wipes `.wrangler/state` first because the edge cache middleware would otherwise serve old pages.
- The browser clock is frozen at 2026-10-01 so "3d ago" labels and saved plan ages do not move.

The `public/data` fallback in `local-data.ts` does not work under the Cloudflare adapter, because workerd cannot read the host disk. That is why the fixtures go through R2.

## Visual diffs

`tests/visual/run.mjs` builds the base and this checkout against the same fixtures, screenshots every page in `tests/pages.ts` at desktop and mobile widths, and compares the two sets with pixelmatch. It writes `visual-report/index.html`, which has side by side, diff and swipe views for every page that changed.

No screenshots are committed. Both sides are rendered on the same machine in the same run, so a font or Chromium update cannot cause false diffs.

To add a page, add it to `PAGES` in `tests/pages.ts`. It is then covered by the smoke test and by the visual diff.

### On pull requests

Most PRs get a preview deployment from `preview.yml`: a second version of the site running beside production and reading the same data bucket. The `test-preview` job there runs the `live` smoke tests against the preview, then diffs screenshots of the preview against production:

    node tests/visual/run.mjs --base-url https://amigettingrorted.au --head-url <preview url>

Both sides read the same data, so any difference comes from the code. Both are rendered with the clock frozen at the start of the run and a cache-busting query on every URL, so the edge cache cannot serve one side an older render. Pages are picked from production's sitemap (tier pages, providers and the latest report). `/submit` is left out because a preview is deployed with submissions off. Commits on `main` that the PR branch does not have also show up as diffs.

PRs from forks and Dependabot, and plan submission PRs, get no preview because they have no Cloudflare secrets. For those, the `visual` job in `test.yml` builds the base and the PR against the fixtures instead and diffs those.

Either way the HTML report is uploaded as an artifact. If anything differs, a comment on the PR shows the biggest changes as base, PR and diff images. The comment is edited on each push, and edited again to say "none" if a later push removes the diffs. No comment is posted when nothing has ever differed.

The images live on a branch called `visual-diffs`, written by `.github/actions/visual-report`. It holds one commit that is rewritten each run, and a PR's folder is removed when the PR closes. A token without write access (forks, Dependabot) gets a table and a link to the report instead of images.
