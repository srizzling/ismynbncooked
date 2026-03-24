import type { CookedLevel, TierManifest } from './types';
import { DEFAULT_UPLOAD_MAP } from './types';
import { LEVELS } from './cooked';
import { WORDS } from './wordlist';

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

const COOKED_LEVELS: CookedLevel[] = ['winning', 'sweet-as', 'bit-shit', 'taking-the-piss', 'absolute-rort'];
const HORIZONS = [3, 6, 12, 24];

/**
 * Encode bytes to words using 11-bits-per-word BIP39-style encoding.
 * 12 bytes (96 bits) → ceil(96/11) = 9 words (but we pad to align)
 * Actually: we pack bits into a big number and extract 11-bit chunks.
 */
function bytesToWords(bytes: Uint8Array): string[] {
  // Convert bytes to a bit string
  let bits = '';
  for (const b of bytes) {
    bits += b.toString(2).padStart(8, '0');
  }
  // Pad to multiple of 11
  while (bits.length % 11 !== 0) {
    bits += '0';
  }
  const words: string[] = [];
  for (let i = 0; i < bits.length; i += 11) {
    const idx = parseInt(bits.substring(i, i + 11), 2);
    words.push(WORDS[idx % WORDS.length]);
  }
  return words;
}

/**
 * Decode words back to bytes.
 */
function wordsToBytes(words: string[], byteCount: number): Uint8Array | null {
  let bits = '';
  for (const word of words) {
    const idx = WORDS.indexOf(word);
    if (idx < 0) return null;
    bits += idx.toString(2).padStart(11, '0');
  }
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    bytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

// --- V3: Word-based share encoding ---

// Binary layout (12 bytes → 9 words):
// [0]    tierIndex (uint8)
// [1-2]  priceCents (uint16LE)
// [3-4]  cheapestCents (uint16LE)
// [5]    levelIdx(3) | horizonIdx(2) | version(3)
// [6-7]  fullPriceCents (uint16LE)
// [8]    promoMonths (uint8)
// [9]    userProviderIdx (uint8)
// [10]   cheapestProviderIdx (uint8)
// [11]   checksum (uint8 — XOR of bytes 0-10)

const SHARE_V3_BYTES = 12;
const SHARE_V3_VERSION = 3;

export interface ShareManifests {
  tiers: TierManifest;
  providers: string[]; // provider name list for index lookup
}

function packShareV3(data: ShareData, manifests: ShareManifests): Uint8Array {
  const tierIdx = manifests.tiers.tiers.findIndex(t => t.key === data.s);
  if (tierIdx < 0 || tierIdx > 255) throw new Error(`Tier ${data.s} not in manifest`);

  const provIdx = Math.max(0, manifests.providers.indexOf(data.v));
  const cpIdx = Math.max(0, manifests.providers.indexOf(data.cp));
  const levelIdx = Math.max(0, COOKED_LEVELS.indexOf(data.l));
  const horizonIdx = Math.max(0, HORIZONS.indexOf(data.h));

  const buf = new Uint8Array(SHARE_V3_BYTES);
  const view = new DataView(buf.buffer);
  buf[0] = tierIdx;
  view.setUint16(1, Math.min(data.p, 65535), true);
  view.setUint16(3, Math.min(data.c, 65535), true);
  buf[5] = (levelIdx & 0x07) | ((horizonIdx & 0x03) << 3) | ((SHARE_V3_VERSION & 0x07) << 5);
  view.setUint16(6, Math.min(data.fp, 65535), true);
  buf[8] = Math.min(data.pd, 255);
  buf[9] = provIdx;
  buf[10] = cpIdx;

  // Checksum
  let xor = 0;
  for (let i = 0; i < 11; i++) xor ^= buf[i];
  buf[11] = xor;

  return buf;
}

function unpackShareV3(buf: Uint8Array, manifests: ShareManifests): ShareData | null {
  if (buf.length < SHARE_V3_BYTES) return null;

  // Verify checksum
  let xor = 0;
  for (let i = 0; i < 11; i++) xor ^= buf[i];
  if (buf[11] !== xor) return null;

  // Verify version
  const flags = buf[5];
  const version = (flags >> 5) & 0x07;
  if (version !== SHARE_V3_VERSION) return null;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tierIdx = buf[0];
  if (tierIdx >= manifests.tiers.tiers.length) return null;

  const levelIdx = flags & 0x07;
  const horizonIdx = (flags >> 3) & 0x03;
  const provIdx = buf[9];
  const cpIdx = buf[10];

  return {
    s: manifests.tiers.tiers[tierIdx].key,
    p: view.getUint16(1, true),
    v: manifests.providers[provIdx] ?? '',
    c: view.getUint16(3, true),
    l: COOKED_LEVELS[levelIdx] ?? 'sweet-as',
    cp: manifests.providers[cpIdx] ?? '',
    h: HORIZONS[horizonIdx] ?? 12,
    fp: view.getUint16(6, true),
    pd: buf[8],
  };
}

/** Encode share data as a hyphenated word string (requires manifests) */
export function encodeShareWords(data: ShareData, manifests: ShareManifests): string {
  const packed = packShareV3(data, manifests);
  return bytesToWords(packed).join('-');
}

/** Decode a hyphenated word string back to share data (requires manifests) */
export function decodeShareWords(wordStr: string, manifests: ShareManifests): ShareData | null {
  try {
    const words = wordStr.split('-');
    const buf = wordsToBytes(words, SHARE_V3_BYTES);
    if (!buf) return null;
    return unpackShareV3(buf, manifests);
  } catch {
    return null;
  }
}

// --- Legacy base64url encoding (v1/v2 backward compat) ---

/** Encode share data into a URL-safe base64 string (legacy) */
export function encodeShareData(data: ShareData): string {
  const json = JSON.stringify([data.s, data.p, data.v, data.c, data.l, data.cp, data.h, data.fp, data.pd]);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode share data from a base64url string (legacy) */
export function decodeShareData(encoded: string): ShareData | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const arr = JSON.parse(json);
    const [s, p, v, c, l, cp, h, fp, pd] = arr;

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

// --- Unified API ---

/** Build a share URL — word-based if manifests available, else base64 fallback */
export function buildShareUrl(origin: string, data: ShareData, manifests?: ShareManifests): string {
  if (manifests) {
    try {
      const words = encodeShareWords(data, manifests);
      return `${origin}/share/${words}`;
    } catch {
      // Tier or provider not in manifest — fall back to base64
    }
  }
  return `${origin}/share?d=${encodeShareData(data)}`;
}

/** Get the label and color for a cooked level */
export function getLevelInfo(level: CookedLevel): { label: string; color: string; description: string } {
  const match = LEVELS.find(l => l.level === level);
  return match ?? { label: 'Unknown', color: '#737373', description: '' };
}
