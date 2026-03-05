import type { SpeedTier, CookedLevel } from './types';
import { LEVELS } from './cooked';

export interface ShareData {
  /** Speed tier */
  s: SpeedTier;
  /** User's monthly price in cents */
  p: number;
  /** Provider name */
  v: string;
  /** Cheapest price in cents (at time of share) */
  c: number;
  /** Cooked level */
  l: CookedLevel;
  /** Cheapest provider name */
  cp: string;
}

/** Encode share data into a URL-safe base64 string */
export function encodeShareData(data: ShareData): string {
  const json = JSON.stringify([data.s, data.p, data.v, data.c, data.l, data.cp]);
  // Use base64url encoding (no padding, URL-safe chars)
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode share data from a base64url string */
export function decodeShareData(encoded: string): ShareData | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const [s, p, v, c, l, cp] = JSON.parse(json);
    if (typeof s !== 'number' || typeof p !== 'number' || typeof c !== 'number') return null;
    return { s, p, v: v ?? '', c, l: l ?? 'sweet-as', cp: cp ?? '' };
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
