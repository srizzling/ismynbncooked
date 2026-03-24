import type { CookedLevel } from './types';
import { DEFAULT_UPLOAD_MAP } from './types';
import { LEVELS } from './cooked';

export interface ShareData {
  /** Tier key (e.g. "nbn-100-20") */
  s: string;
  /** User's monthly price in cents */
  p: number;
  /** Provider name */
  v: string;
  /** Cheapest effective price in cents (at time of share) */
  c: number;
  /** Cooked level */
  l: CookedLevel;
  /** Cheapest provider name */
  cp: string;
  /** Horizon in months */
  h: number;
  /** User's full price after promo in cents (0 = no promo) */
  fp: number;
  /** User's promo months remaining */
  pd: number;
}

/** Encode share data into a URL-safe base64 string */
export function encodeShareData(data: ShareData): string {
  const json = JSON.stringify([data.s, data.p, data.v, data.c, data.l, data.cp, data.h, data.fp, data.pd]);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode share data from a base64url string */
export function decodeShareData(encoded: string): ShareData | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const arr = JSON.parse(json);
    const [s, p, v, c, l, cp, h, fp, pd] = arr;

    // Backward compat: old format had s as a number (download speed)
    let tierKey: string;
    if (typeof s === 'number') {
      tierKey = DEFAULT_UPLOAD_MAP[s] ?? `nbn-${s}-20`;
    } else if (typeof s === 'string') {
      tierKey = s;
    } else {
      return null;
    }

    if (typeof p !== 'number' || typeof c !== 'number') return null;
    return { s: tierKey, p, v: v ?? '', c, l: l ?? 'sweet-as', cp: cp ?? '', h: h ?? 12, fp: fp ?? 0, pd: pd ?? 0 };
  } catch {
    return null;
  }
}

/** Build a share URL */
export function buildShareUrl(origin: string, data: ShareData): string {
  return `${origin}/share?d=${encodeShareData(data)}`;
}

/** Get the label and color for a cooked level */
export function getLevelInfo(level: CookedLevel): { label: string; color: string; description: string } {
  const match = LEVELS.find(l => l.level === level);
  return match ?? { label: 'Unknown', color: '#737373', description: '' };
}
