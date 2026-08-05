import { normalizeOperationalAssetStatus, type AssetStatus } from './asset-record';

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
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^\*\./, '').replace(/\.$/, '').replace(/^\[|\]$/g, '');
  }
}

function matchesRule(value: string, rawRule: string) {
  const rule = normalizeValue(rawRule);
  if (!rule) return false;
  if (rule.includes('/')) return cidrContains(rule, value);
  if (isIPv4(rule) || isIPv4(value)) return rule === value;
  return value === rule || value.endsWith(`.${rule}`);
}

function cidrContains(cidr: string, value: string) {
  const [network, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  if (!isIPv4(network) || !isIPv4(value) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(network) & mask) === (ipv4Number(value) & mask);
}

function ipv4Number(value: string) {
  return value.split('.').reduce((result, octet) => ((result << 8) | Number(octet)) >>> 0, 0);
}

function isIPv4(value: string) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
