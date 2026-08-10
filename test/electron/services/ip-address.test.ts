import { describe, expect, it } from 'vitest';
import { cidrContains, normalizeCidr, normalizeIpAddress } from '@electron/services/ip-address';

describe('IP address normalization', () => {
  it('canonicalizes IPv4 and IPv6 addresses and network prefixes', () => {
    expect(normalizeIpAddress(' 192.0.2.10 ')).toBe('192.0.2.10');
    expect(normalizeIpAddress('[2001:0db8:0:0:0:0:0:1]')).toBe('2001:db8::1');
    expect(normalizeCidr('192.0.2.129/24')).toBe('192.0.2.0/24');
    expect(normalizeCidr('2001:0db8:1234:5678::1/48')).toBe('2001:db8:1234::/48');
  });

  it('checks containment without crossing address families', () => {
    expect(cidrContains('2001:db8::/32', '2001:db8:1::9')).toBe(true);
    expect(cidrContains('2001:db8::/32', '192.0.2.1')).toBe(false);
    expect(cidrContains('192.0.2.0/24', '192.0.3.1')).toBe(false);
  });
});
