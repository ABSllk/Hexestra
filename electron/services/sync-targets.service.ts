import { sessionService } from './session.service';
import {
  createAssetRecord,
  hostAssetId,
  normalizeApiBase,
  normalizeDomain,
  parentDomain,
  type AssetRecord,
} from './asset-record';
import { normalizeCidr, normalizeIpAddress } from './ip-address';

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
  }
  | {
    type: 'subnet';
    cidr: string;
    summary?: string;
    tags?: string[];
  }
  | {
    type: 'port';
    hostAssetId: string;
    port: number;
    protocol?: 'tcp' | 'udp';
    state?: 'open' | 'filtered' | 'closed';
    summary?: string;
    tags?: string[];
  }
  | {
    type: 'service';
    portAssetId: string;
    name: string;
    version?: string;
    product?: string;
    extra?: string;
    summary?: string;
    tags?: string[];
  }
  | {
    type: 'api';
    baseUrl: string;
    webAppAssetId?: string;
    summary?: string;
    tags?: string[];
  }
  | {
    type: 'endpoint';
    apiAssetId: string;
    method: string;
    path: string;
    pathTemplate?: string;
    summary?: string;
    tags?: string[];
  }
  | {
    type: 'parameter';
    endpointAssetId: string;
    location: 'path' | 'query' | 'header' | 'cookie' | 'body';
    name: string;
    dataType?: string;
    required?: boolean;
    summary?: string;
    tags?: string[];
  }
  | {
    type: 'certificate';
    fingerprintSha256: string;
    subject?: string;
    issuer?: string;
    san?: string[];
    validFrom?: string;
    validTo?: string;
    summary?: string;
    tags?: string[];
  }
  | {
    type: 'identity';
    provider: string;
    realm: string;
    principal: string;
    identityKind?: string;
    credentials?: Array<{
      kind: 'password' | 'token' | 'cookie' | 'private_key';
      value: string;
      observedAt?: string;
    }>;
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
    const fineGrained: Array<Exclude<StructuredAssetRegistration, { type: 'host' | 'domain' | 'webapp' }>> = [];
    const source = 'agent_register';

    for (const registration of registrations) {
      if (registration.type === 'host') {
        const ip = normalizeIpAddress(registration.ip);
        hosts.push({
          ip,
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

      if (registration.type !== 'webapp') {
        fineGrained.push(registration);
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
    }

    const result = await this.syncDiscovered(
      sessionId,
      source,
      hosts,
      domains,
      webApps,
      fineGrained,
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
    fineGrained: Array<Exclude<StructuredAssetRegistration, { type: 'host' | 'domain' | 'webapp' }>>,
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
          const linkedDomains = uniqueStrings((host.domains ?? []).map(normalizeDomain));
          const observedDomains = uniqueStrings([
            ...normalizeDomainCandidates(host.hostname ? [host.hostname] : []),
            ...linkedDomains,
          ]);
          const target = sessionService.addTarget(sessionId, {
            id: hostAssetId(host.ip),
            ip: host.ip,
            hostname: host.hostname,
            domains: observedDomains,
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
          for (const domain of linkedDomains) {
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
              sessionId, domainAsset.id, target.id, 'resolves_to', { tool: host.source }, 'dns_resolves',
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
          const parentAsset = sessionService.listAssets(sessionId)
            .find((candidate) => candidate.key === `domain:${parent}`);
          if (parentAsset) {
            const hierarchy = sessionService.upsertNetMapEdge(
              sessionId, asset.id, parentAsset.id, 'belongs_to', { tool: discovered.source }, 'subdomain_of',
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
          const domainAsset = sessionService.listAssets(sessionId)
            .find((candidate) => candidate.key === `domain:${webApp.domain}`);
          if (domainAsset) {
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
            sessionId, domainId, hostId, 'resolves_to', { tool: webApp.source }, 'dns_resolves',
          );
          if (resolves.edge) edgesUpdated += 1;
        }
        if (hostId) {
          const connected = sessionService.upsertNetMapEdge(
            sessionId, webAsset.id, hostId, 'connected_to', { tool: webApp.source }, 'served_by',
          );
          if (connected.edge) edgesUpdated += 1;
        }
      }

      for (const registration of fineGrained) {
        const registered = this.upsertFineGrained(sessionId, registration, toolName);
        addedAssets.add(registered.asset.key);
        edgesUpdated += registered.edgesUpdated;
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

  private upsertFineGrained(
    sessionId: string,
    registration: Exclude<StructuredAssetRegistration, { type: 'host' | 'domain' | 'webapp' }>,
    source: string,
  ) {
    const tags = uniqueStrings([source, ...(registration.tags ?? [])]);
    if (registration.type === 'port') {
      const host = requireHost(sessionId, registration.hostAssetId);
      const protocol = registration.protocol ?? 'tcp';
      if (!Number.isInteger(registration.port) || registration.port < 1 || registration.port > 65_535) {
        throw new Error(`Invalid port: ${registration.port}`);
      }
      if (protocol !== 'tcp' && protocol !== 'udp') throw new Error(`Invalid port protocol: ${protocol}`);
      sessionService.addTarget(sessionId, {
        ...host,
        ports: [{
          id: `${host.ip}:${registration.port}/${protocol}`,
          port: registration.port,
          protocol,
          state: registration.state ?? 'open',
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        }],
        services: [],
        tags: uniqueStrings([...host.tags, ...tags]),
      }, true);
      const key = createAssetRecord('port', `${host.id}:${protocol}:${registration.port}`).key;
      const asset = requireNonHostAssetByKey(sessionId, key);
      if (registration.summary) sessionService.updateAsset(sessionId, asset.id, { aiSummary: registration.summary });
      return { asset: requireNonHostAssetByKey(sessionId, key), edgesUpdated: 1 };
    }

    if (registration.type === 'service') {
      const portAsset = requireNonHostAsset(sessionId, registration.portAssetId, 'port');
      const hostId = stringProperty(portAsset, 'hostAssetId');
      const host = requireHost(sessionId, hostId);
      const port = numberProperty(portAsset, 'port');
      const protocol = stringProperty(portAsset, 'protocol');
      sessionService.addTarget(sessionId, {
        ...host,
        ports: [{
          id: `${host.ip}:${port}/${protocol}`,
          port,
          protocol,
          state: 'open',
          service: registration.name,
          version: registration.version,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        }],
        services: [{
          port,
          protocol,
          name: registration.name,
          version: registration.version,
          product: registration.product,
          extra: registration.extra,
        }],
        tags: uniqueStrings([...host.tags, ...tags]),
      }, true);
      const key = createAssetRecord('service', `${portAsset.id}:${registration.name.trim().toLowerCase()}`).key;
      const asset = requireNonHostAssetByKey(sessionId, key);
      if (registration.summary) sessionService.updateAsset(sessionId, asset.id, { aiSummary: registration.summary });
      return { asset: requireNonHostAssetByKey(sessionId, key), edgesUpdated: 1 };
    }

    let asset: AssetRecord;
    let parentId: string | undefined;
    let semantic: 'api_of' | 'endpoint_of' | 'parameter_of' | undefined;
    if (registration.type === 'subnet') {
      const cidr = normalizeCidr(registration.cidr);
      asset = createAssetRecord('subnet', cidr, { cidr }, tags);
    } else if (registration.type === 'api') {
      const baseUrl = normalizeApiBase(registration.baseUrl);
      if (registration.webAppAssetId) requireNonHostAsset(sessionId, registration.webAppAssetId, 'webapp');
      const parsed = new URL(baseUrl);
      asset = createAssetRecord('api', baseUrl, {
        url: baseUrl,
        origin: parsed.origin,
        basePath: parsed.pathname,
      }, tags);
      parentId = registration.webAppAssetId;
      semantic = parentId ? 'api_of' : undefined;
    } else if (registration.type === 'endpoint') {
      requireNonHostAsset(sessionId, registration.apiAssetId, 'api');
      const method = normalizeHttpMethod(registration.method);
      const pathTemplate = normalizeEndpointPath(registration.pathTemplate ?? registration.path);
      asset = {
        ...createAssetRecord('endpoint', `${registration.apiAssetId}:${method}:${pathTemplate}`, {
          apiAssetId: registration.apiAssetId,
          method,
          path: registration.path,
          pathTemplate,
        }, tags),
        label: `${method} ${pathTemplate}`,
      };
      parentId = registration.apiAssetId;
      semantic = 'endpoint_of';
    } else if (registration.type === 'parameter') {
      requireNonHostAsset(sessionId, registration.endpointAssetId, 'endpoint');
      const name = registration.name.trim();
      if (!name) throw new Error('Parameter name is required');
      asset = {
        ...createAssetRecord('parameter', `${registration.endpointAssetId}:${registration.location}:${name.toLowerCase()}`, {
          endpointAssetId: registration.endpointAssetId,
          location: registration.location,
          name,
          ...(registration.dataType ? { dataType: registration.dataType } : {}),
          ...(registration.required !== undefined ? { required: registration.required } : {}),
        }, tags),
        label: `${registration.location}:${name}`,
      };
      parentId = registration.endpointAssetId;
      semantic = 'parameter_of';
    } else if (registration.type === 'certificate') {
      asset = {
        ...createAssetRecord('certificate', registration.fingerprintSha256, {
          fingerprintSha256: registration.fingerprintSha256.replace(/[^a-f0-9]/gi, '').toUpperCase(),
          ...(registration.subject ? { subject: registration.subject } : {}),
          ...(registration.issuer ? { issuer: registration.issuer } : {}),
          ...(registration.san?.length ? { san: uniqueStrings(registration.san) } : {}),
          ...(registration.validFrom ? { validFrom: registration.validFrom } : {}),
          ...(registration.validTo ? { validTo: registration.validTo } : {}),
        }, tags),
        label: registration.subject?.trim() || registration.fingerprintSha256.replace(/[^a-f0-9]/gi, '').toUpperCase().slice(0, 16),
      };
    } else {
      const provider = registration.provider.trim().toLowerCase();
      const realm = registration.realm.trim().toLowerCase();
      const principal = registration.principal.trim();
      if (!provider || !realm || !principal) throw new Error('Identity provider, realm, and principal are required');
      const credentialProperties = Object.fromEntries((registration.credentials ?? []).flatMap((credential) => [
        [`credential_${credential.kind}`, credential.value],
        [`credential_${credential.kind}_observedAt`, credential.observedAt ?? new Date().toISOString()],
      ]));
      asset = {
        ...createAssetRecord('identity', `${provider}:${realm}:${principal.toLowerCase()}`, {
          provider,
          realm,
          principal,
          ...(registration.identityKind ? { identityKind: registration.identityKind } : {}),
          ...credentialProperties,
        }, tags),
        label: principal,
      };
    }

    const previous = asset.type === 'identity'
      ? sessionService.listAssets(sessionId).find((candidate) => candidate.key === asset.key)
      : undefined;
    const stored = sessionService.upsertAsset(sessionId, {
      ...asset,
      status: 'scanned',
      aiSummary: registration.summary,
    });
    let edgesUpdated = 0;
    if (parentId && semantic) {
      const relation = sessionService.upsertNetMapEdge(
        sessionId, stored.id, parentId, 'belongs_to', { tool: source }, semantic,
      );
      if (relation.edge) edgesUpdated += 1;
    }
    if (previous && registration.type === 'identity') {
      for (const credential of registration.credentials ?? []) {
        const key = `credential_${credential.kind}`;
        const oldValue = previous.properties[key];
        if (typeof oldValue !== 'string' || oldValue === credential.value) continue;
        sessionService.upsertEvidence(sessionId, {
          assetId: stored.id,
          title: `Previous ${credential.kind.replace('_', ' ')} credential`,
          tool: source,
          kind: 'credential-history',
          observedAt: typeof previous.properties[`${key}_observedAt`] === 'string'
            ? String(previous.properties[`${key}_observedAt`])
            : previous.lastUpdated,
          content: JSON.stringify({ kind: credential.kind, value: oldValue }),
        });
      }
    }
    return { asset: stored, edgesUpdated };
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
  const inferredIp = tryNormalizeIp(parsed.hostname);
  const inferredDomain = inferredIp ? undefined : normalizeDomain(parsed.hostname);
  const explicitIp = registration.ip ? normalizeIpAddress(registration.ip) : undefined;
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

function tryNormalizeIp(value: string) {
  try {
    return normalizeIpAddress(value);
  } catch {
    return undefined;
  }
}

function requireHost(sessionId: string, assetId: string) {
  const host = sessionService.listTargets(sessionId).find((candidate) => candidate.id === assetId);
  if (!host) throw new Error(`Host asset ${assetId} not found`);
  return host;
}

function requireNonHostAsset(sessionId: string, assetId: string, expectedType?: AssetRecord['type']) {
  const asset = sessionService.listAssets(sessionId).find((candidate) => candidate.id === assetId);
  if (!asset || (expectedType && asset.type !== expectedType)) {
    throw new Error(`${expectedType ?? 'Asset'} ${assetId} not found`);
  }
  return asset;
}

function requireNonHostAssetByKey(sessionId: string, key: string) {
  const asset = sessionService.listAssets(sessionId).find((candidate) => candidate.key === key);
  if (!asset) throw new Error(`Asset ${key} not found after registration`);
  return asset;
}

function stringProperty(asset: AssetRecord, key: string) {
  const value = asset.properties[key];
  if (typeof value !== 'string') throw new Error(`${asset.type} ${asset.id} is missing ${key}`);
  return value;
}

function numberProperty(asset: AssetRecord, key: string) {
  const value = asset.properties[key];
  if (typeof value !== 'number') throw new Error(`${asset.type} ${asset.id} is missing ${key}`);
  return value;
}

function normalizeHttpMethod(value: string) {
  const method = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{0,19}$/.test(method)) throw new Error(`Invalid HTTP method: ${value}`);
  return method;
}

function normalizeEndpointPath(value: string) {
  const raw = value.trim().split(/[?#]/, 1)[0] || '/';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path
    .replace(/\/[0-9]+(?=\/|$)/g, '/{id}')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/{uuid}')
    .replace(/\/{2,}/g, '/');
}
