import crypto from 'crypto';

export type AssetType = 'domain' | 'webapp' | 'api' | 'service' | 'identity' | 'subnet';
export type OperationalAssetStatus = 'untested' | 'in_progress' | 'scanned' | 'vulnerable' | 'compromised';
export type AssetStatus = OperationalAssetStatus | 'out_of_scope';

export interface AssetRecord {
  id: string;
  key: string;
  type: AssetType;
  label: string;
  status: AssetStatus;
  properties: Record<string, string | number | boolean | string[]>;
  tags: string[];
  vulnCount: number;
  aiSummary?: string;
  firstSeen: string;
  lastUpdated: string;
}

export function createAssetRecord(
  type: AssetType,
  value: string,
  properties: AssetRecord['properties'] = {},
  tags: string[] = [],
): AssetRecord {
  const normalized = normalizeAssetValue(type, value);
  const now = new Date().toISOString();
  return {
    id: assetId(type, normalized),
    key: `${type}:${normalized}`,
    type,
    label: assetLabel(type, normalized),
    status: 'untested',
    properties: { ...properties, [type === 'webapp' ? 'url' : type]: normalized },
    tags: [...new Set(tags)],
    vulnCount: 0,
    firstSeen: now,
    lastUpdated: now,
  };
}

export function normalizeStoredAsset(value: unknown): AssetRecord | null {
  if (!isRecord(value) || !isAssetType(value.type) || typeof value.key !== 'string') return null;
  const keyPrefix = `${value.type}:`;
  if (!value.key.startsWith(keyPrefix)) return null;
  try {
    const normalized = normalizeAssetValue(value.type, value.key.slice(keyPrefix.length));
    const base = createAssetRecord(value.type, normalized);
    return {
      ...base,
      id: assetId(value.type, normalized),
      label: typeof value.label === 'string' && value.label.trim() ? value.label.slice(0, 300) : base.label,
      status: normalizeOperationalAssetStatus(value.status),
      properties: { ...base.properties, ...normalizeProperties(value.properties) },
      tags: Array.isArray(value.tags)
        ? value.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 50)
        : [],
      vulnCount: typeof value.vulnCount === 'number' && Number.isFinite(value.vulnCount)
        ? Math.max(0, Math.round(value.vulnCount)) : 0,
      aiSummary: typeof value.aiSummary === 'string' ? value.aiSummary.slice(0, 4_000) : undefined,
      firstSeen: typeof value.firstSeen === 'string' ? value.firstSeen : base.firstSeen,
      lastUpdated: typeof value.lastUpdated === 'string' ? value.lastUpdated : base.lastUpdated,
    };
  } catch {
    return null;
  }
}

export function normalizeDomain(value: string) {
  const input = value.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  let domain = input;
  try {
    domain = new URL(`http://${input}`).hostname;
  } catch {
    throw new Error(`Invalid domain asset: ${value}`);
  }
  const labels = domain.split('.');
  const validLabels = labels.length >= 2
    && labels[labels.length - 1].length >= 2
    && labels.every((label) => /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/i.test(label));
  if (domain.length > 253 || !validLabels) {
    throw new Error(`Invalid domain asset: ${value}`);
  }
  return domain;
}

export function parentDomain(value: string) {
  const labels = normalizeDomain(value).split('.');
  return labels.length > 2 ? labels.slice(1).join('.') : null;
}

function normalizeAssetValue(type: AssetType, value: string) {
  if (type === 'domain') return normalizeDomain(value);
  if (type === 'webapp') {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Web assets require HTTP(S)');
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.origin.toLowerCase();
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_000) throw new Error(`Invalid ${type} asset`);
  return normalized;
}

function assetId(type: AssetType, normalized: string) {
  return `AST-${type}-${crypto.createHash('sha1').update(`${type}:${normalized}`).digest('hex').slice(0, 16)}`;
}

function assetLabel(type: AssetType, normalized: string) {
  if (type === 'webapp') return new URL(normalized).host;
  return normalized;
}

function normalizeProperties(value: unknown): AssetRecord['properties'] {
  if (!isRecord(value)) return {};
  const properties: AssetRecord['properties'] = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') properties[key] = item.slice(0, 4_000);
    else if (typeof item === 'number' && Number.isFinite(item)) properties[key] = item;
    else if (typeof item === 'boolean') properties[key] = item;
    if (Array.isArray(item)) {
      properties[key] = item.filter((entry): entry is string => typeof entry === 'string').slice(0, 100);
    }
  }
  return properties;
}

function isAssetType(value: unknown): value is AssetType {
  return value === 'domain' || value === 'webapp' || value === 'api'
    || value === 'service' || value === 'identity' || value === 'subnet';
}

export function normalizeOperationalAssetStatus(value: unknown): OperationalAssetStatus {
  if (
    value === 'in_progress' || value === 'scanned'
    || value === 'vulnerable' || value === 'compromised'
  ) return value;
  return 'untested';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
