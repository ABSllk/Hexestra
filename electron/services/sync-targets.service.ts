import { sessionService } from './session.service';
import {
  createAssetRecord,
  normalizeDomain,
  parentDomain,
  type AssetRecord,
} from './asset-record';

interface DiscoveredHost {
  ip: string;
  hostname?: string;
  domains?: string[];
  ports?: Array<{
    port: number;
    protocol: string;
    state: string;
    service?: string;
    version?: string;
  }>;
  source: string;
  summary?: string;
  tags?: string[];
}

interface DiscoveredDomain {
  domain: string;
  source: string;
  summary?: string;
  tags?: string[];
}

interface DiscoveredWebApp {
  url: string;
  domain?: string;
  ip?: string;
  port: number;
  statusCode?: number;
  title?: string;
  technologies: string[];
  source: string;
  summary?: string;
  tags?: string[];
}

export type StructuredAssetRegistration =
  | {
    type: 'host';
    ip: string;
    hostname?: string;
    domains?: string[];
    ports?: Array<{
      port: number;
      protocol?: 'tcp' | 'udp';
      state?: 'open' | 'filtered' | 'closed';
      service?: string;
      version?: string;
    }>;
    summary?: string;
    tags?: string[];
  }
  | {
    type: 'domain';
    domain: string;
    summary?: string;
    tags?: string[];
  }
  | {
    type: 'webapp';
    url: string;
    ip?: string;
    domain?: string;
    statusCode?: number;
    title?: string;
    technologies?: string[];
    summary?: string;
    tags?: string[];
  };

export class SyncTargetsService {

  async registerAssets(
    sessionId: string,
    registrations: StructuredAssetRegistration[],
    sourceTargetId?: string,
  ) {
    const hosts: DiscoveredHost[] = [];
    const domains: DiscoveredDomain[] = [];
    const webApps: DiscoveredWebApp[] = [];
    const source = 'agent_register';

    for (const registration of registrations) {
      if (registration.type === 'host') {
        if (!isValidIPv4(registration.ip)) {
          throw new Error(`Invalid host IP: ${registration.ip}`);
        }
        hosts.push({
          ip: registration.ip,
          hostname: normalizeHostname(registration.hostname),
          domains: uniqueStrings((registration.domains ?? []).map(normalizeDomain)),
          ports: (registration.ports ?? []).map((port) => ({
            port: port.port,
            protocol: port.protocol ?? 'tcp',
            state: port.state ?? 'open',
            service: port.service,
            version: port.version,
          })),
          source,
          summary: registration.summary,
          tags: registration.tags,
        });
        continue;
      }

      if (registration.type === 'domain') {
        domains.push({
          domain: normalizeDomain(registration.domain),
          source,
          summary: registration.summary,
          tags: registration.tags,
        });
        continue;
      }

      const parsedUrl = normalizeWebAppRegistration(registration);
      webApps.push({
        ...parsedUrl,
        statusCode: registration.statusCode,
        title: registration.title,
        technologies: uniqueStrings(registration.technologies ?? []),
        source,
        summary: registration.summary,
        tags: registration.tags,
      });
      if (parsedUrl.ip) {
        hosts.push({
          ip: parsedUrl.ip,
          hostname: parsedUrl.domain,
          domains: parsedUrl.domain ? [parsedUrl.domain] : [],
          ports: [{
            port: parsedUrl.port,
            protocol: 'tcp',
            state: 'open',
            service: parsedUrl.url.startsWith('https:') ? 'https' : 'http',
          }],
          source,
          tags: registration.tags,
        });
      }
    }

    const result = await this.syncDiscovered(
      sessionId,
      source,
      hosts,
      domains,
      webApps,
      sourceTargetId,
    );
    const hostIps = new Set(result.addedIPs);
    const assetKeys = new Set(result.addedAssets);
    return {
      ...result,
      hosts: sessionService.listTargets(sessionId).filter((target) => hostIps.has(target.ip)),
      assets: sessionService.listAssets(sessionId).filter((asset) => assetKeys.has(asset.key)),
    };
  }

  private async syncDiscovered(
    sessionId: string,
    toolName: string,
    hosts: DiscoveredHost[],
    domains: DiscoveredDomain[],
    webApps: DiscoveredWebApp[],
    sourceTargetId?: string,
  ) {
    const beforeTargets = sessionService.listTargets(sessionId);
    const beforeAssets = sessionService.listAssets(sessionId);
    const result = sessionService.withGraphTransaction(sessionId, () => {
      const scanRunId = sessionService.recordScanRun(sessionId, toolName.toLowerCase(), sourceTargetId);
      const addedTargets = new Set<string>();
      const addedAssets = new Set<string>();
      let edgesUpdated = 0;
      for (const host of hosts) {
        try {
          const hostDomains = uniqueStrings([
            ...normalizeDomainCandidates(host.hostname ? [host.hostname] : []),
            ...(host.domains ?? []).map(normalizeDomain),
          ]);
          const target = sessionService.addTarget(sessionId, {
            id: `TGT-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`,
            ip: host.ip,
            hostname: host.hostname,
            domains: hostDomains,
            tags: uniqueStrings([host.source, ...(host.tags ?? [])]),
            status: host.ports && host.ports.length > 0 ? 'scanned' : 'untested',
            ports: (host.ports || []).map((p) => ({
              id: `${host.ip}:${p.port}/${p.protocol}`,
              port: p.port,
              protocol: p.protocol,
              state: p.state as 'open' | 'filtered' | 'closed',
              service: p.service,
              version: p.version,
              firstSeen: new Date().toISOString(),
              lastSeen: new Date().toISOString(),
            })),
            services: (host.ports || []).map((port) => ({
              port: port.port,
              protocol: port.protocol,
              name: port.service || 'unknown',
              version: port.version,
            })),
            vulnCount: 0,
            aiSummary: host.summary,
            firstSeen: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
          }, true);
          addedTargets.add(target.ip);
          if (sourceTargetId !== target.id) {
            const relation = sessionService.upsertNetMapEdge(
              sessionId, sourceTargetId, target.id, 'connected_to', { tool: host.source },
            );
            if (relation.edge) edgesUpdated += 1;
          }
          for (const domain of hostDomains) {
            const domainAsset = this.upsertDomain(
              sessionId,
              domain,
              host.source,
              undefined,
              host.tags,
            );
            if (!domainAsset) continue;
            addedAssets.add(domainAsset.key);
            const resolves = sessionService.upsertNetMapEdge(
              sessionId, domainAsset.id, target.id, 'resolves_to', { tool: host.source },
            );
            if (resolves.edge) edgesUpdated += 1;
          }
        } catch (e) {
          console.error(`[Sync] Failed to add target ${host.ip}:`, e);
        }
      }

      for (const discovered of domains) {
        const asset = this.upsertDomain(
          sessionId,
          discovered.domain,
          discovered.source,
          discovered.summary,
          discovered.tags,
        );
        if (!asset) continue;
        addedAssets.add(asset.key);
        const parent = parentDomain(discovered.domain);
        if (parent) {
          const parentAsset = this.upsertDomain(
            sessionId,
            parent,
            discovered.source,
            undefined,
            discovered.tags,
          );
          if (parentAsset) {
            addedAssets.add(parentAsset.key);
            const hierarchy = sessionService.upsertNetMapEdge(
              sessionId, asset.id, parentAsset.id, 'belongs_to', { tool: discovered.source },
            );
            if (hierarchy.edge) edgesUpdated += 1;
          }
        }
      }

      for (const webApp of webApps) {
        const properties: AssetRecord['properties'] = {
          url: webApp.url,
          scheme: new URL(webApp.url).protocol.replace(':', ''),
          port: webApp.port,
          ...(webApp.statusCode ? { statusCode: webApp.statusCode } : {}),
          ...(webApp.title ? { title: webApp.title } : {}),
          ...(webApp.technologies.length ? { technologies: webApp.technologies } : {}),
        };
        const webAsset = sessionService.upsertAsset(
          sessionId,
          {
            ...createAssetRecord(
              'webapp',
              webApp.url,
              properties,
              uniqueStrings([webApp.source, ...(webApp.tags ?? [])]),
            ),
            status: 'scanned',
            aiSummary: webApp.summary,
          },
        );
        addedAssets.add(webAsset.key);
        let domainId: string | undefined;
        let hostId: string | undefined;
        if (webApp.domain) {
          const domainAsset = this.upsertDomain(
            sessionId,
            webApp.domain,
            webApp.source,
            undefined,
            webApp.tags,
          );
          if (domainAsset) {
            addedAssets.add(domainAsset.key);
            domainId = domainAsset.id;
            const belongs = sessionService.upsertNetMapEdge(
              sessionId, webAsset.id, domainAsset.id, 'belongs_to', { tool: webApp.source },
            );
            if (belongs.edge) edgesUpdated += 1;
          }
        }
        if (webApp.ip) {
          const matchingHost = sessionService.listTargets(sessionId)
            .find((target) => target.ip === webApp.ip);
          if (matchingHost) hostId = matchingHost.id;
        }
        if (domainId && hostId) {
          const resolves = sessionService.upsertNetMapEdge(
            sessionId, domainId, hostId, 'resolves_to', { tool: webApp.source },
          );
          if (resolves.edge) edgesUpdated += 1;
        }
        if (hostId) {
          const connected = sessionService.upsertNetMapEdge(
            sessionId, webAsset.id, hostId, 'connected_to', { tool: webApp.source },
          );
          if (connected.edge) edgesUpdated += 1;
        }
      }

      const changes = detectAssetChanges(
        beforeTargets,
        beforeAssets,
        sessionService.listTargets(sessionId),
        sessionService.listAssets(sessionId),
      );
      for (const change of changes) sessionService.recordAssetChange(sessionId, scanRunId, change);

      return {
        hostsFound: hosts.length + addedAssets.size,
        targetsAdded: addedTargets.size,
        addedIPs: [...addedTargets],
        assetsAdded: addedAssets.size,
        addedAssets: [...addedAssets],
        edgesUpdated,
        scanRunId,
        changesRecorded: changes.length,
      };
    });
    sessionService.refreshGraphArtifacts(sessionId);
    return result;
  }

  private upsertDomain(
    sessionId: string,
    domain: string,
    source: string,
    summary?: string,
    tags: string[] = [],
  ) {
    try {
      return sessionService.upsertAsset(
        sessionId,
        {
          ...createAssetRecord(
            'domain',
            domain,
            { domain: normalizeDomain(domain) },
            uniqueStrings([source, ...tags]),
          ),
          status: 'scanned',
          aiSummary: summary,
        },
      );
    } catch {
      return null;
    }
  }
}

type TargetSnapshot = ReturnType<typeof sessionService.listTargets>[number];

function detectAssetChanges(
  beforeTargets: TargetSnapshot[],
  beforeAssets: AssetRecord[],
  afterTargets: TargetSnapshot[],
  afterAssets: AssetRecord[],
) {
  const changes: Array<{
    assetId?: string;
    kind: 'asset_added' | 'endpoint_added' | 'endpoint_changed' | 'asset_updated';
    field?: string;
    label: string;
    before?: string;
    after?: string;
  }> = [];
  const oldHosts = new Map(beforeTargets.map((target) => [target.ip, target]));
  for (const target of afterTargets) {
    const old = oldHosts.get(target.ip);
    if (!old) {
      changes.push({ assetId: target.id, kind: 'asset_added', label: `Host ${target.ip}` });
      for (const port of target.ports) {
        changes.push({
          assetId: target.id,
          kind: 'endpoint_added',
          field: `${port.port}/${port.protocol}`,
          label: `${target.ip} exposed ${port.port}/${port.protocol} ${port.service ?? ''}`.trim(),
          after: endpointFingerprint(port),
        });
      }
      continue;
    }
    const oldPorts = new Map(old.ports.map((port) => [`${port.port}/${port.protocol}`, port]));
    for (const port of target.ports) {
      const key = `${port.port}/${port.protocol}`;
      const previous = oldPorts.get(key);
      if (!previous) {
        changes.push({
          assetId: target.id,
          kind: 'endpoint_added',
          field: key,
          label: `${target.ip} exposed ${key} ${port.service ?? ''}`.trim(),
          after: endpointFingerprint(port),
        });
      } else if (endpointFingerprint(previous) !== endpointFingerprint(port)) {
        changes.push({
          assetId: target.id,
          kind: 'endpoint_changed',
          field: key,
          label: `${target.ip} changed ${key}`,
          before: endpointFingerprint(previous),
          after: endpointFingerprint(port),
        });
      }
    }
  }

  const oldAssets = new Map(beforeAssets.map((asset) => [asset.key, asset]));
  for (const asset of afterAssets) {
    const old = oldAssets.get(asset.key);
    if (!old) {
      changes.push({ assetId: asset.id, kind: 'asset_added', label: `${asset.type} ${asset.label}` });
      continue;
    }
    const before = JSON.stringify({ status: old.status, properties: old.properties });
    const after = JSON.stringify({ status: asset.status, properties: asset.properties });
    if (before !== after) {
      changes.push({ assetId: asset.id, kind: 'asset_updated', label: `${asset.type} ${asset.label}`, before, after });
    }
  }
  return changes;
}

function endpointFingerprint(port: { state: string; service?: string; version?: string }) {
  return [port.state, port.service ?? '', port.version ?? ''].join(' | ');
}

export const syncTargetsService = new SyncTargetsService();

function normalizeHostname(value?: string) {
  const hostname = value?.trim().toLowerCase().replace(/\.$/, '');
  if (!hostname) return undefined;
  if (hostname.length > 253 || !/^[a-z0-9.-]+$/i.test(hostname)) {
    throw new Error(`Invalid hostname: ${value}`);
  }
  return hostname;
}

function normalizeDomainCandidates(values: string[]) {
  return values.flatMap((value) => {
    try {
      return [normalizeDomain(value)];
    } catch {
      return [];
    }
  });
}

function normalizeWebAppRegistration(
  registration: Extract<StructuredAssetRegistration, { type: 'webapp' }>,
) {
  let parsed: URL;
  try {
    parsed = new URL(registration.url.trim());
  } catch {
    throw new Error(`Invalid Web App URL: ${registration.url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Web App URLs require HTTP(S)');
  }
  const inferredIp = isValidIPv4(parsed.hostname) ? parsed.hostname : undefined;
  const inferredDomain = inferredIp ? undefined : normalizeDomain(parsed.hostname);
  const explicitIp = registration.ip?.trim();
  if (explicitIp && !isValidIPv4(explicitIp)) {
    throw new Error(`Invalid Web App host IP: ${registration.ip}`);
  }
  const explicitDomain = registration.domain
    ? normalizeDomain(registration.domain)
    : undefined;
  if (inferredDomain && explicitDomain && inferredDomain !== explicitDomain) {
    throw new Error(`Web App domain ${explicitDomain} does not match URL host ${inferredDomain}`);
  }
  return {
    url: parsed.origin.toLowerCase(),
    domain: inferredDomain ?? explicitDomain,
    ip: explicitIp ?? inferredIp,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isValidIPv4(value: string) {
  const octets = value.split('.');
  return octets.length === 4 && octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const number = Number(octet);
    return number >= 0 && number <= 255;
  });
}
