import net from 'net';
import type { ScopeAdvisory, ScopeAnnotation, ScopeMode, SessionScopePayload } from '../contracts/session';
import { cidrContains, normalizeCidr, normalizeIpAddress } from './ip-address';

export interface ScopePolicy {
  mode: ScopeMode;
  allowRules: string[];
  excludeRules: string[];
}

export function normalizeScopePolicy(scope: Partial<ScopePolicy> | undefined): ScopePolicy {
  return {
    mode: scope?.mode === 'whitelist' ? 'whitelist' : 'blacklist',
    allowRules: uniqueRules(scope?.allowRules),
    excludeRules: uniqueRules(scope?.excludeRules),
  };
}

export function scopeAnnotationForValues(
  scope: ScopePolicy | undefined,
  values: Array<string | undefined>,
): ScopeAnnotation | undefined {
  const policy = normalizeScopePolicy(scope);
  const normalizedValues = values
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map(normalizeValue)
    .filter(Boolean);
  const rules = policy.mode === 'whitelist' ? policy.allowRules : policy.excludeRules;
  return normalizedValues.some((value) => rules.some((rule) => matchesRule(value, rule)))
    ? policy.mode === 'whitelist' ? 'authorized' : 'excluded'
    : undefined;
}

export function scopeAdvisoryForValues(
  scope: ScopePolicy | undefined,
  values: Array<string | undefined>,
): ScopeAdvisory {
  const policy = normalizeScopePolicy(scope);
  const annotation = scopeAnnotationForValues(policy, values);
  if (policy.mode === 'whitelist') return annotation === 'authorized' ? 'included' : 'unlisted';
  return annotation === 'excluded' ? 'excluded' : 'neutral';
}

export function isValueInScope(scope: ScopePolicy | undefined, value: string) {
  return scopeAnnotationForValues(scope, [value]) === 'authorized';
}

export function isValueExcluded(scope: ScopePolicy | undefined, value: string) {
  const policy = normalizeScopePolicy(scope);
  return policy.mode === 'blacklist' && scopeAnnotationForValues(policy, [value]) === 'excluded';
}

export function normalizeLegacyScope(value: {
  inScope?: string[];
  outOfScope?: string[];
  targets?: string[];
}): SessionScopePayload {
  const allowRules = uniqueRules([...(value.inScope ?? []), ...(value.targets ?? [])]);
  return {
    mode: allowRules.length ? 'whitelist' : 'blacklist',
    allowRules,
    excludeRules: uniqueRules(value.outOfScope),
  };
}

function uniqueRules(values: unknown) {
  return Array.isArray(values)
    ? [...new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))]
    : [];
}

function normalizeValue(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const hostname = new URL(trimmed).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    try { return normalizeIpAddress(hostname); } catch { return hostname; }
  } catch {
    if (trimmed.includes('/')) {
      try { return normalizeCidr(trimmed); } catch { return trimmed; }
    }
    const candidate = trimmed.replace(/^\*\./, '').replace(/\.$/, '').replace(/^\[|\]$/g, '');
    try { return normalizeIpAddress(candidate); } catch { return candidate; }
  }
}

function matchesRule(value: string, rawRule: string) {
  const rule = normalizeValue(rawRule);
  if (!rule) return false;
  if (rule.includes('/')) {
    if (!value.includes('/')) return cidrContains(rule, value);
    try {
      const normalizedRule = normalizeCidr(rule);
      const normalizedValue = normalizeCidr(value);
      const [candidateAddress, candidatePrefix] = normalizedValue.split('/');
      const [, rulePrefix] = normalizedRule.split('/');
      return Number(candidatePrefix) >= Number(rulePrefix) && cidrContains(normalizedRule, candidateAddress);
    } catch { return false; }
  }
  if (net.isIP(rule) || net.isIP(value)) return rule === value;
  return value === rule || value.endsWith(`.${rule}`);
}
