import type { AssetRecord, GraphNode, SessionScope, Target } from '@/types';

export interface AssetRescanPlan {
  task: {
    id: string;
    title: string;
    status: 'in_progress';
    primaryTacticId: 'TA0007';
    techniqueIds: ['T1046'];
    targetAssetIds: string[];
    successCriteria: [{ id: string; text: string; completed: false }];
  };
  message: string;
}

export function assetPrimaryValue(node: GraphNode, target?: Target, asset?: AssetRecord): string {
  if (target?.ip) return target.ip;

  const properties = asset?.properties;
  const typedValue = asset ? typedAssetValue(asset) : undefined;
  const propertyValue = firstText(properties?.url, properties?.domain, properties?.ip, typedValue);
  return propertyValue ?? asset?.key ?? node.ip ?? node.hostname ?? node.key ?? node.label;
}

function typedAssetValue(asset: AssetRecord) {
  const value = asset.properties;
  if (asset.type === 'subnet') return firstText(value.cidr);
  if (asset.type === 'port' && typeof value.port === 'number') return `${value.port}/${firstText(value.protocol) ?? 'tcp'}`;
  if (asset.type === 'service') return [firstText(value.name), firstText(value.version)].filter(Boolean).join(' ');
  if (asset.type === 'endpoint') return [firstText(value.method), firstText(value.pathTemplate, value.path)].filter(Boolean).join(' ');
  if (asset.type === 'parameter') return [firstText(value.location), firstText(value.name)].filter(Boolean).join(':');
  if (asset.type === 'certificate') return firstText(value.fingerprintSha256);
  if (asset.type === 'identity') return [firstText(value.provider, value.realm), firstText(value.principal)].filter(Boolean).join(':');
  return undefined;
}

export function assetBrowserUrl(node: GraphNode, target?: Target, asset?: AssetRecord): string | undefined {
  const directUrl = firstText(asset?.properties.url, node.properties?.url);
  if (directUrl && /^https?:\/\//i.test(directUrl)) return directUrl;

  const domain = firstText(
    asset?.properties.domain,
    asset?.properties.hostname,
    node.properties?.domain,
    node.properties?.hostname,
  );
  const targetWebPort = target ? findWebPort(target) : undefined;
  if (domain && !isIpAddress(domain) && !targetWebPort) return `https://${domain}/`;

  const host = target?.hostname ?? target?.ip ?? firstText(asset?.properties.ip, node.ip);
  if (!host) return undefined;

  const webPort = targetWebPort;
  if (!webPort && target?.hostname && !isIpAddress(target.hostname)) return `https://${target.hostname}/`;
  if (!webPort) return undefined;
  const protocol = webPort.port === 443 || webPort.port === 8443 || webPort.service.includes('https') ? 'https' : 'http';
  const defaultPort = (protocol === 'https' && webPort.port === 443) || (protocol === 'http' && webPort.port === 80);
  return `${protocol}://${formatHost(host)}${defaultPort ? '' : `:${webPort.port}`}/`;
}

export function assetJsonPayload(node: GraphNode, target?: Target, asset?: AssetRecord): Target | AssetRecord | GraphNode {
  return target ?? asset ?? node;
}

export function buildAssetRescanPlan(node: GraphNode, target: Target | undefined, scope: SessionScope | undefined): AssetRescanPlan {
  return {
    task: {
      id: `asm-rescan-${node.id}`,
      title: `Rescan ${node.label}`,
      status: 'in_progress',
      primaryTacticId: 'TA0007',
      techniqueIds: ['T1046'],
      targetAssetIds: [node.id],
      successCriteria: [{ id: 'rescan-recorded', text: 'Record the scan result and reconcile the asset state', completed: false }],
    },
    message: `Rescan the selected asset ${node.label} (${target?.ip ?? node.key ?? node.id}). `
      + `Review the project's semantic Scope annotations ${JSON.stringify(scope ?? {})}, `
      + 'use the smallest appropriate scan action, then update the asset, change record, and task status.',
  };
}

function firstText(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isIpAddress(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':');
}

function formatHost(value: string): string {
  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
}

function findWebPort(target: Target): { port: number; service: string } | undefined {
  return target.ports
    .filter((port) => port.state === 'open' && [80, 443, 8080, 8443].includes(port.port))
    .map((port) => ({
      port: port.port,
      service: `${port.service ?? ''} ${target.services.find((service) => service.port === port.port)?.name ?? ''}`.toLowerCase(),
    }))
    .sort((left, right) => left.port - right.port)
    .find((port) => port.service.includes('http') || [80, 443, 8080, 8443].includes(port.port));
}
