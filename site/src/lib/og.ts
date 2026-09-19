/**
 * Shared social-card renderer (satori → resvg → PNG). Used by the /og/*.png endpoints.
 * Cards are 1200×630 so they unfurl on Reddit, X, Slack, Discord and Facebook.
 */
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
// Bundled as a WebAssembly.Module by the Cloudflare adapter (cloudflareModules).
// Workers refuse to compile wasm fetched at runtime ("Wasm code generation disallowed by embedder").
// @ts-ignore - .wasm module import is resolved by the adapter's Vite plugin
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

export const OG_W = 1200;
export const OG_H = 630;

export const OG = {
  bg: '#0a0a0a',
  raised: '#141414',
  border: '#262626',
  accent: '#f97316',
  rise: '#ef4444',
  drop: '#22d3ee',
  text: '#ffffff',
  secondary: '#a3a3a3',
  muted: '#737373',
  faint: '#525252',
};

let wasmReady = false;
// Cache finished font bytes only. Caching a pending fetch across requests is not
// allowed on Workers ("Cannot perform I/O on behalf of a different request").
const fontCache = new Map<string, ArrayBuffer>();

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const key = `${family}:${weight}`;
  const cached = fontCache.get(key);
  if (cached) return cached;
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
  })).text();
  const match = css.match(/src:\s*url\(([^)]+)\)/);
  if (!match?.[1]) throw new Error(`Could not find font URL for ${key}`);
  const buf = await (await fetch(match[1])).arrayBuffer();
  fontCache.set(key, buf);
  return buf;
}

/** Minimal element helper so card code stays readable. */
export function el(type: string, style: Record<string, string | number>, children?: unknown): { type: string; props: Record<string, unknown> } {
  return { type, props: { style, ...(children !== undefined ? { children } : {}) } };
}

export const row = (style: Record<string, string | number>, children: unknown[]) => el('div', { display: 'flex', flexDirection: 'row', ...style }, children);
export const col = (style: Record<string, string | number>, children: unknown[]) => el('div', { display: 'flex', flexDirection: 'column', ...style }, children);
export const text = (value: string, style: Record<string, string | number> = {}) => el('div', { display: 'flex', ...style }, value);

/** Standard frame: brand line at the top, footer at the bottom, body in between. */
export function frame(kicker: string, body: unknown[], footerRight = 'amigettingrorted.au'): unknown {
  return col({ width: '100%', height: '100%', backgroundColor: OG.bg, padding: '52px 60px', fontFamily: 'Inter' }, [
    row({ justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px' }, [
      text(kicker, { color: OG.muted, fontSize: '24px' }),
      text('Am I Getting Rorted?', { color: OG.accent, fontSize: '24px', fontWeight: 700 }),
    ]),
    col({ flex: '1', justifyContent: 'center' }, body),
    row({ justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${OG.border}`, paddingTop: '18px' }, [
      text('Rankings by price only. No sponsored placements.', { color: OG.faint, fontSize: '20px' }),
      text(footerRight, { color: OG.faint, fontSize: '20px' }),
    ]),
  ]);
}

/** Initialise resvg once per isolate from the bundled wasm module. */
export async function ensureResvg(): Promise<void> {
  if (wasmReady) return;
  try {
    await initWasm(resvgWasm as unknown as WebAssembly.Module);
  } catch (err) {
    // A second init throws "Already initialized"; anything else is real
    if (!String(err).includes('lready')) throw err;
  }
  wasmReady = true;
}

export async function renderPng(node: unknown): Promise<Response> {
  try {
    return await renderPngInner(node);
  } catch (err) {
    console.error('[og] render failed:', err);
    return new Response(`Image render failed: ${err instanceof Error ? err.stack || err.message : String(err)}`, {
      status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

async function renderPngInner(node: unknown): Promise<Response> {
  const [bold, regular] = await Promise.all([loadGoogleFont('Inter', 700), loadGoogleFont('Inter', 400)]);
  const svg = await satori(node as any, {
    width: OG_W,
    height: OG_H,
    fonts: [
      { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      { name: 'Inter', data: regular, weight: 400, style: 'normal' },
    ],
  });
  await ensureResvg();
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: OG_W } }).render().asPng();
  return new Response(png, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  });
}

export const money = (n: number) => `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;
