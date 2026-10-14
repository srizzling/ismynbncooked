import { describe, expect, it } from 'vitest';
import {
  buildShareUrl, decodeShareData, decodeShareWords, encodeShareData, encodeShareWords, getLevelInfo,
  type ShareData, type ShareManifests,
} from '../../src/lib/share';
import { getFixtureManifest } from '../../src/lib/data';
import { WORDS } from '../../src/lib/wordlist';

const tiers = getFixtureManifest();
const manifests: ShareManifests = { tiers, providers: tiers.providers };

const data: ShareData = {
  s: 'nbn-100-20', p: 6990, v: 'Telstra', c: 5990, l: 'taking-the-piss', cp: 'Tangerine', h: 12, fp: 8990, pd: 3,
};

describe('word list', () => {
  it('has 2048 unique words so each word carries 11 bits', () => {
    expect(WORDS).toHaveLength(2048);
    expect(new Set(WORDS).size).toBe(2048);
  });

  it('only contains characters that survive a hyphen-separated URL', () => {
    for (const w of WORDS) expect(w).toMatch(/^[a-z]+$/);
  });
});

describe('word share links', () => {
  it('round-trips every field', () => {
    const words = encodeShareWords(data, manifests);
    expect(decodeShareWords(words, manifests)).toEqual(data);
  });

  it('produces a stable hyphenated word string', () => {
    const words = encodeShareWords(data, manifests);
    expect(words).toBe(encodeShareWords(data, manifests));
    expect(words.split('-').length).toBeGreaterThan(5);
    expect(words).toMatch(/^[a-z]+(-[a-z]+)+$/);
  });

  it('round-trips every level and horizon', () => {
    for (const l of ['winning', 'sweet-as', 'bit-shit', 'taking-the-piss', 'absolute-rort'] as const) {
      for (const h of [3, 6, 12, 24]) {
        const d = { ...data, l, h };
        expect(decodeShareWords(encodeShareWords(d, manifests), manifests)).toEqual(d);
      }
    }
  });

  it('refuses a tier that is not in the manifest', () => {
    expect(() => encodeShareWords({ ...data, s: 'nbn-9999-1' }, manifests)).toThrow(/not in manifest/);
  });

  it('rejects garbage', () => {
    expect(decodeShareWords('not-a-real-share', manifests)).toBeNull();
    expect(decodeShareWords('', manifests)).toBeNull();
  });

  it('rejects a link with a word swapped, via the checksum', () => {
    const parts = encodeShareWords(data, manifests).split('-');
    parts[1] = parts[1] === WORDS[0] ? WORDS[1] : WORDS[0];
    expect(decodeShareWords(parts.join('-'), manifests)).toBeNull();
  });
});

describe('legacy base64 share links', () => {
  it('round-trips', () => {
    expect(decodeShareData(encodeShareData(data))).toEqual(data);
  });

  it('is URL safe', () => {
    expect(encodeShareData(data)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('upgrades a numeric v1 speed to a tier key', () => {
    const v1 = btoa(JSON.stringify([100, 6990, 'Telstra', 5990, 'bit-shit', 'Tangerine', 12, 0, 0]))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeShareData(v1)?.s).toBe('nbn-100-20');
  });

  it('rejects data that is not a share link', () => {
    expect(decodeShareData('%%%')).toBeNull();
    expect(decodeShareData(btoa('{}').replace(/=+$/, ''))).toBeNull();
    expect(decodeShareData(btoa(JSON.stringify(['nbn-100-20', 'x', 'y'])))).toBeNull();
  });
});

describe('buildShareUrl', () => {
  it('uses the word form when the tier is known', () => {
    expect(buildShareUrl('https://x.test', data, manifests)).toMatch(/^https:\/\/x\.test\/share\/[a-z-]+$/);
  });

  it('falls back to the base64 form without manifests', () => {
    expect(buildShareUrl('https://x.test', data)).toBe(`https://x.test/share?d=${encodeShareData(data)}`);
  });

  it('falls back to the base64 form when the tier is missing from the manifest', () => {
    expect(buildShareUrl('https://x.test', { ...data, s: 'nbn-9999-1' }, manifests)).toContain('/share?d=');
  });
});

describe('getLevelInfo', () => {
  it('returns the display info for a level', () => {
    expect(getLevelInfo('sweet-as').label).toBe('Sweet As');
  });

  it('has a neutral fallback for an unknown level', () => {
    expect(getLevelInfo('nope' as never).label).toBe('Unknown');
  });
});
