import { describe, expect, it } from 'vitest';
import { isValueExcluded, isValueInScope, scopeAdvisoryForValues, scopeAnnotationForValues } from '@electron/services/scope-policy';

describe('scope policy annotations', () => {
  it('matches whitelist domains, URLs, and CIDRs as authorized', () => {
    const scope = { mode: 'whitelist' as const, allowRules: ['example.com', '192.0.2.0/24'], excludeRules: ['auth.example.com'] };
    expect(scopeAnnotationForValues(scope, ['api.example.com'])).toBe('authorized');
    expect(isValueInScope(scope, 'https://shop.example.com/login')).toBe(true);
    expect(isValueInScope(scope, 'auth.example.com')).toBe(true);
    expect(isValueInScope(scope, '192.0.2.10')).toBe(true);
    expect(isValueExcluded(scope, 'auth.example.com')).toBe(false);
  });

  it('matches blacklist exclusions without changing authorization semantics', () => {
    const scope = { mode: 'blacklist' as const, allowRules: ['example.com'], excludeRules: ['auth.example.com', '192.0.2.200'] };
    expect(scopeAnnotationForValues(scope, ['auth.example.com'])).toBe('excluded');
    expect(scopeAnnotationForValues(scope, ['api.example.com'])).toBeUndefined();
    expect(isValueExcluded(scope, 'auth.example.com')).toBe(true);
    expect(isValueInScope(scope, 'api.example.com')).toBe(false);
  });

  it('defaults to an empty blacklist when scope is missing', () => {
    expect(scopeAnnotationForValues(undefined, ['example.com'])).toBeUndefined();
    expect(isValueInScope(undefined, 'example.com')).toBe(false);
  });

  it('normalizes IPv4 and IPv6 CIDRs', () => {
    const scope = {
      mode: 'whitelist' as const,
      allowRules: ['192.0.2.129/24', '2001:0db8:1234::/48'],
      excludeRules: [],
    };
    expect(isValueInScope(scope, '192.0.2.10')).toBe(true);
    expect(isValueInScope(scope, '2001:db8:1234:1::42')).toBe(true);
    expect(isValueInScope(scope, '2001:db8:9999::1')).toBe(false);
  });

  it('returns advisory labels without turning scope into an execution gate', () => {
    const whitelist = { mode: 'whitelist' as const, allowRules: ['example.com'], excludeRules: [] };
    expect(scopeAdvisoryForValues(whitelist, ['api.example.com'])).toBe('included');
    expect(scopeAdvisoryForValues(whitelist, ['other.test'])).toBe('unlisted');

    const blacklist = { mode: 'blacklist' as const, allowRules: [], excludeRules: ['blocked.example.com'] };
    expect(scopeAdvisoryForValues(blacklist, ['blocked.example.com'])).toBe('excluded');
    expect(scopeAdvisoryForValues(blacklist, ['other.example.com'])).toBe('neutral');
  });
});
