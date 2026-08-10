import { describe, expect, it } from 'vitest';
import { deriveScopedAssetStatus, isValueInScope } from '@electron/services/scope-policy';

describe('scope policy', () => {
  const scope = { inScope: ['example.com', '192.0.2.0/24'], outOfScope: ['auth.example.com', '192.0.2.200'] };

  it('matches domains, subdomains, URLs, and CIDRs with exclusions winning', () => {
    expect(isValueInScope(scope, 'api.example.com')).toBe(true);
    expect(isValueInScope(scope, 'https://shop.example.com/login')).toBe(true);
    expect(isValueInScope(scope, 'auth.example.com')).toBe(false);
    expect(isValueInScope(scope, '192.0.2.10')).toBe(true);
    expect(isValueInScope(scope, '192.0.2.200')).toBe(false);
    expect(isValueInScope(scope, '198.51.100.1')).toBe(false);
  });

  it('defaults to deny when scope is missing', () => {
    expect(isValueInScope(undefined, 'example.com')).toBe(false);
  });

  it('derives scope visibility without replacing the operational status', () => {
    expect(deriveScopedAssetStatus(scope, ['api.example.com'], 'scanned')).toBe('scanned');
    expect(deriveScopedAssetStatus(scope, ['other.example.net'], 'scanned')).toBe('out_of_scope');
    expect(deriveScopedAssetStatus(scope, ['api.example.com'], 'out_of_scope')).toBe('untested');
  });

  it('accepts explicitly listed scope targets while exclusions still win', () => {
    const targeted = { inScope: [], outOfScope: ['blocked.example.net'], targets: ['api.example.net'] };
    expect(isValueInScope(targeted, 'api.example.net')).toBe(true);
    expect(isValueInScope(targeted, 'blocked.example.net')).toBe(false);
    expect(deriveScopedAssetStatus(
      { inScope: ['192.0.2.0/24'], outOfScope: ['blocked.example.net'] },
      ['192.0.2.10', 'blocked.example.net'],
      'scanned',
    )).toBe('out_of_scope');
  });

  it('normalizes IPv4 and IPv6 CIDRs and applies exclusions first', () => {
    const dualStack = {
      inScope: ['192.0.2.129/24', '2001:0db8:1234::/48'],
      outOfScope: ['192.0.2.200', '2001:db8:1234::dead'],
    };
    expect(isValueInScope(dualStack, '192.0.2.10')).toBe(true);
    expect(isValueInScope(dualStack, '192.0.2.200')).toBe(false);
    expect(isValueInScope(dualStack, '2001:db8:1234:1::42')).toBe(true);
    expect(isValueInScope(dualStack, '2001:db8:1234:5678::/64')).toBe(true);
    expect(isValueInScope(dualStack, '192.0.2.128/25')).toBe(true);
    expect(isValueInScope(dualStack, 'https://[2001:db8:1234::dead]/')).toBe(false);
    expect(isValueInScope(dualStack, '2001:db8:9999::1')).toBe(false);
  });
});
