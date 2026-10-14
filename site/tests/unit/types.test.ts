import { describe, expect, it } from 'vitest';
import {
  buildGroupedTierKey, buildTierKey, buildTierLabel, DEFAULT_UPLOAD_MAP, parseGroupedTierKey, parseTierKey,
} from '../../src/lib/types';

describe('tier keys', () => {
  it('round-trips a full tier key', () => {
    const key = buildTierKey('nbn', 1000, 50);
    expect(key).toBe('nbn-1000-50');
    expect(parseTierKey(key)).toEqual({ network: 'nbn', download: 1000, upload: 50 });
  });

  it('parses opticomm keys', () => {
    expect(parseTierKey('opticomm-100-20')).toEqual({ network: 'opticomm', download: 100, upload: 20 });
  });

  it.each(['nbn-100', 'nbn-100-20-5', 'fttp-100-20', 'nbn-abc-20', '', 'NBN-100-20'])('rejects %j as a tier key', (key) => {
    expect(parseTierKey(key)).toBeNull();
  });

  it('round-trips a grouped key', () => {
    expect(buildGroupedTierKey('opticomm', 250)).toBe('opticomm-250');
    expect(parseGroupedTierKey('opticomm-250')).toEqual({ network: 'opticomm', download: 250 });
  });

  it('does not treat a full tier key as a grouped key, or the reverse', () => {
    expect(parseGroupedTierKey('nbn-100-20')).toBeNull();
    expect(parseTierKey('nbn-100')).toBeNull();
  });

  it('labels tiers by network', () => {
    expect(buildTierLabel('nbn', 100, 20)).toBe('NBN 100/20');
    expect(buildTierLabel('opticomm', 100, 20)).toBe('Opticomm 100/20');
  });

  it('maps every legacy download speed to a parseable tier key', () => {
    for (const [speed, key] of Object.entries(DEFAULT_UPLOAD_MAP)) {
      expect(parseTierKey(key)?.download).toBe(Number(speed));
    }
  });
});
