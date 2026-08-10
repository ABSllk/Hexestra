import net from 'net';
import { normalizeOperationalAssetStatus, type AssetStatus } from './asset-record';
import { cidrContains, normalizeCidr, normalizeIpAddress } from './ip-address';

export interface ScopePolicy {
  inScope: string[];
  outOfScope: string[];
  targets?: string[];
}

export function isValueInScope(scope: ScopePolicy | undefined, value: string) {
  if (!scope || (scope.inScope.length === 0 && (scope.targets?.length ?? 0) === 0)) return false;
  const normalized = normalizeValue(value);
  if (!normalized) return false;
  if (isValueExcluded(scope, normalized)) return false;
  return [...scope.inScope, ...(scope.targets ?? [])].some((rule) => matchesRule(normalized, rule));
}

export function isValueExcluded(scope: ScopePolicy | undefined, value: string) {
  if (!scope) return false;
  const normalized = normalizeValue(value);
  if (!normalized) return false;
  return scope.outOfScope.some((rule) => matchesRule(normalized, rule));
}

export function deriveScopedAssetStatus(
  scope: ScopePolicy | undefined,
  values: Array<string | undefined>,
  operationalStatus: unknown,
): AssetStatus {
  const normalizedValues = values.filter((value): value is string => Boolean(value));
  if (normalizedValues.some((value) => isValueExcluded(scope, value))) return 'out_of_scope';
  const inScope = normalizedValues.some((value) => isValueInScope(scope, value));
  return inScope ? normalizeOperationalAssetStatus(operationalStatus) : 'out_of_scope';
}

function normalizeValue(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const hostname = new URL(trimmed).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    try {
      return normalizeIpAddress(hostname);
    } catch {
      return hostname;
    }
  } catch {
    if (trimmed.includes('/')) {
      try {
        return normalizeCidr(trimmed);
      } catch {
        return trimmed;
      }
    }
    const candidate = trimmed.replace(/^\*\./, '').replace(/\.$/, '').replace(/^\[|\]$/g, '');
    try {
      return normalizeIpAddress(candidate);
    } catch {
      return candidate;
    }
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
    } catch {
      return false;
    }
  }
  if (net.isIP(rule) || net.isIP(value)) return rule === value;
  return value === rule || value.endsWith(`.${rule}`);
}
