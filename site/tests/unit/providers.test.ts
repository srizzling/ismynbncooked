import { describe, expect, it } from 'vitest';
import { displayProviderName, PROVIDER_LINKS, referralProviders, resolveProviderLink, slugifyProvider } from '../../src/lib/providers';

describe('resolveProviderLink', () => {
  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(resolveProviderLink('  SUPERLOOP ')?.url).toBe('https://www.superloop.com/nbn');
  });

  it('matches alternative names', () => {
    expect(resolveProviderLink('Tangerine Telecom')?.url).toBe(resolveProviderLink('Tangerine')?.url);
  });

  it('only labels a link as a referral when a referral URL is configured', () => {
    for (const link of PROVIDER_LINKS) {
      const resolved = resolveProviderLink(link.match[0])!;
      expect(resolved.isReferral).toBe(link.referral != null);
      expect(resolved.url).toBe(link.referral ?? link.site);
    }
  });

  it('falls back to the website from the data, adding a scheme if it is missing', () => {
    expect(resolveProviderLink('Nobody ISP', 'nobody.example')?.url).toBe('https://nobody.example');
    expect(resolveProviderLink('Nobody ISP', 'http://nobody.example')?.url).toBe('http://nobody.example');
  });

  it('returns null when there is nothing to link to', () => {
    expect(resolveProviderLink('Nobody ISP')).toBeNull();
    expect(resolveProviderLink('Nobody ISP', null)).toBeNull();
  });

  it('prefers the configured site over the website in the data', () => {
    expect(resolveProviderLink('Telstra', 'other.example')?.url).toBe('https://www.telstra.com.au/internet/nbn');
  });
});

describe('PROVIDER_LINKS', () => {
  it('has lowercase match names so lookups work', () => {
    for (const link of PROVIDER_LINKS) for (const m of link.match) expect(m).toBe(m.toLowerCase());
  });

  it('has no name matched by two entries', () => {
    const seen = new Map<string, string>();
    for (const link of PROVIDER_LINKS) {
      for (const m of link.match) {
        expect(seen.has(m), `${m} is listed twice`).toBe(false);
        seen.set(m, link.site);
      }
    }
  });

  it('lists the providers that earn a referral', () => {
    const names = referralProviders();
    expect(names).toHaveLength(PROVIDER_LINKS.filter((l) => l.referral).length);
  });
});

describe('slugifyProvider', () => {
  it.each([
    ['Aussie Broadband', 'aussie-broadband'],
    ['Dodo & Co', 'dodo-and-co'],
    ['  --TPG--  ', 'tpg'],
    ['iPrimus - 1300 Fibre 1', 'iprimus-1300-fibre-1'],
  ])('%j becomes %j', (name, slug) => {
    expect(slugifyProvider(name)).toBe(slug);
  });
});

describe('displayProviderName', () => {
  it('leaves already-mixed-case names alone', () => {
    expect(displayProviderName('iiNet')).toBe('iiNet');
    expect(displayProviderName('Aussie Broadband')).toBe('Aussie Broadband');
  });

  it('title-cases ALL CAPS names', () => {
    expect(displayProviderName('AUSSIE BROADBAND')).toBe('Aussie Broadband');
  });

  it('keeps known acronyms upper case', () => {
    expect(displayProviderName('TPG')).toBe('TPG');
    expect(displayProviderName('AGL TELECOMMUNICATIONS')).toBe('AGL Telecommunications');
  });

  it('capitalises after hyphens and slashes', () => {
    expect(displayProviderName('SOUTH-WEST/NORTH')).toBe('South-West/North');
  });
});
