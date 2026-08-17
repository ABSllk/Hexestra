// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AssetRecord } from '@electron/services/asset-record';

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('AI asset registration', () => {
  let appData: string;
  let previousAppData: string | undefined;
  let previousHexestraHome: string | undefined;
  let sessionService: typeof import('@electron/services/session.service').sessionService;
  let syncTargetsService: typeof import('@electron/services/sync-targets.service').syncTargetsService;
  let sessionId: string;
  let projectPath: string;

  beforeAll(async () => {
    appData = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-ai-assets-'));
    previousAppData = process.env.APPDATA;
    previousHexestraHome = process.env.HEXESTRA_HOME;
    process.env.APPDATA = appData;
    process.env.HEXESTRA_HOME = appData;
    vi.resetModules();
    sessionService = (await import('@electron/services/session.service')).sessionService;
    syncTargetsService = (await import('@electron/services/sync-targets.service')).syncTargetsService;
    projectPath = path.join(appData, 'asset-project');
    fs.mkdirSync(projectPath, { recursive: true });
    sessionId = (await sessionService.openProjectPath(projectPath, {
      name: 'AI registration test',
      scope: 'example.com',
    })).id;
  });

  afterAll(async () => {
    sessionService.close();
    process.env.APPDATA = previousAppData;
    process.env.HEXESTRA_HOME = previousHexestraHome;
    fs.rmSync(appData, { recursive: true, force: true });
  });

  it('atomically registers shared hosts, domains, ports, services, and web apps', async () => {
    const result = await syncTargetsService.registerAssets(sessionId, [
      {
        type: 'host',
        ip: '192.0.2.10',
        hostname: 'api.example.com',
        domains: ['api.example.com', 'admin.example.com'],
        ports: [
          { port: 443, service: 'https', version: 'nginx 1.27' },
          { port: 22, service: 'ssh', version: 'OpenSSH 9.7' },
        ],
        summary: 'Shared public application host.',
        tags: ['confirmed'],
      },
      {
        type: 'webapp',
        url: 'https://api.example.com/v1',
        ip: '192.0.2.10',
        statusCode: 200,
        title: 'Example API',
        technologies: ['nginx', 'REST'],
        summary: 'Primary API application.',
      },
    ], 'local-operator');

    expect(result.hosts).toHaveLength(1);
    expect(result.hosts[0]).toMatchObject({
      id: expect.stringMatching(/^AST-host-/),
      ip: '192.0.2.10',
      domains: ['api.example.com', 'admin.example.com'],
      aiSummary: 'Shared public application host.',
      ports: [
        expect.objectContaining({ port: 22, service: 'ssh', version: 'OpenSSH 9.7' }),
        expect.objectContaining({ port: 443, service: 'https', version: 'nginx 1.27' }),
      ],
    });
    expect(result.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.any(String), key: 'domain:api.example.com' }),
      expect.objectContaining({ id: expect.any(String), key: 'domain:admin.example.com' }),
      expect.objectContaining({
        id: expect.any(String),
        key: 'webapp:https://api.example.com',
        aiSummary: 'Primary API application.',
      }),
    ]));

    const graph = await sessionService.getNetMap(sessionId);
    const host = result.hosts[0];
    const apiDomain = graph.assets.find((asset) => asset.key === 'domain:api.example.com');
    const webApp = graph.assets.find((asset) => asset.key === 'webapp:https://api.example.com');
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: apiDomain?.id, target: host.id, type: 'resolves_to' }),
      expect.objectContaining({ source: webApp?.id, target: apiDomain?.id, type: 'belongs_to' }),
      expect.objectContaining({ source: webApp?.id, target: host.id, type: 'connected_to' }),
    ]));
    expect(sessionService.listScanRuns(sessionId)[0].tool).toBe('agent_register');
    expect(sessionService.listEvidence(sessionId)).toEqual([]);
  });

  it('merges repeated AI registrations and preserves real IDs', async () => {
    const beforeHost = sessionService.listTargets(sessionId)[0];
    const beforeAssets = sessionService.listAssets(sessionId);

    const result = await syncTargetsService.registerAssets(sessionId, [{
      type: 'host',
      ip: '192.0.2.10',
      domains: ['api.example.com'],
      ports: [{ port: 443, service: 'https', version: 'nginx 1.28' }],
    }], 'local-operator');

    expect(sessionService.listTargets(sessionId)).toHaveLength(1);
    expect(result.hosts[0].id).toBe(beforeHost.id);
    expect(result.hosts[0].ports.find((port) => port.port === 443)?.version).toBe('nginx 1.28');
    expect(sessionService.listAssets(sessionId)).toHaveLength(beforeAssets.length);
  });

  it('rejects malformed structured assets before graph mutation', async () => {
    const beforeTargets = sessionService.listTargets(sessionId);
    const beforeAssets = sessionService.listAssets(sessionId);

    await expect(syncTargetsService.registerAssets(sessionId, [{
      type: 'webapp',
      url: 'https://api.example.com',
      domain: 'other.example.com',
    }])).rejects.toThrow('does not match URL host');

    expect(sessionService.listTargets(sessionId)).toEqual(beforeTargets);
    expect(sessionService.listAssets(sessionId)).toEqual(beforeAssets);
  });

  it('registers deterministic fine-grained API assets and keeps credentials plaintext with history', async () => {
    const identityPrincipal = ['alice', 'example.com'].join('@');
    const registerOne = async (asset: Parameters<typeof syncTargetsService.registerAssets>[1][number]) => {
      const result = await syncTargetsService.registerAssets(sessionId, [asset], 'local-operator');
      return result;
    };
    const hostRegistration = await registerOne({ type: 'host', ip: '2001:0db8::10', hostname: 'v6.example.com' });
    const host = hostRegistration.hosts[0];
    expect(hostRegistration.assets).toEqual([]);
    const port = (await registerOne({ type: 'port', hostAssetId: host.id, port: 8443, protocol: 'tcp' })).assets[0];
    const service = (await registerOne({ type: 'service', portAssetId: port.id, name: 'HTTPS', version: '1.0' })).assets[0];
    const webapp = (await registerOne({ type: 'webapp', url: 'https://api.example.com/login' })).assets[0];
    const api = (await registerOne({ type: 'api', baseUrl: 'https://api.example.com/v1/', webAppAssetId: webapp.id })).assets[0];
    const endpoint = (await registerOne({ type: 'endpoint', apiAssetId: api.id, method: 'get', path: '/users/123?expand=roles' })).assets[0];
    const parameter = (await registerOne({ type: 'parameter', endpointAssetId: endpoint.id, location: 'query', name: 'expand' })).assets[0];
    const certificate = (await registerOne({ type: 'certificate', fingerprintSha256: 'AA:'.repeat(31) + 'AA' })).assets[0] as AssetRecord;
    const identity = (await registerOne({
      type: 'identity', provider: 'OIDC', realm: 'Example', principal: identityPrincipal,
      credentials: [{ kind: 'token', value: 'first-token', observedAt: '2026-08-10T00:00:00.000Z' }],
    })).assets[0] as AssetRecord;

    expect(host).toMatchObject({ id: expect.stringMatching(/^AST-host-/), ip: '2001:db8::10' });
    expect(sessionService.getAssetContext(sessionId, host.id).asset).toMatchObject({
      id: host.id, type: 'host', key: 'host:2001:db8::10', properties: { ip: '2001:db8::10' },
    });
    expect(port).toMatchObject({ type: 'port', properties: { hostAssetId: host.id, port: 8443, protocol: 'tcp' } });
    expect(service).toMatchObject({ type: 'service', properties: { portAssetId: port.id, name: 'HTTPS', version: '1.0' } });
    expect(api).toMatchObject({ key: 'api:https://api.example.com/v1', properties: { basePath: '/v1' } });
    expect(endpoint).toMatchObject({ properties: { method: 'GET', pathTemplate: '/users/{id}' } });
    expect(parameter).toMatchObject({ properties: { location: 'query', name: 'expand' } });
    expect(certificate.type).toBe('certificate');
    expect(identity).toMatchObject({
      type: 'identity',
      status: 'scanned',
      properties: { credential_token: 'first-token' },
    });

    sessionService.upsertNetMapEdge(sessionId, identity.id, api.id, 'connected_to', {}, 'authenticates_to');
    expect(sessionService.getAssetContext(sessionId, identity.id).asset).toMatchObject({ status: 'scanned' });
    const updatedIdentity = (await registerOne({
      type: 'identity', provider: 'oidc', realm: 'example', principal: identityPrincipal.toUpperCase(),
      credentials: [{ kind: 'token', value: 'second-token', observedAt: '2026-08-11T00:00:00.000Z' }],
    })).assets[0] as AssetRecord;
    expect(updatedIdentity.id).toBe(identity.id);
    expect(updatedIdentity.properties).toMatchObject({ credential_token: 'second-token' });
    expect(sessionService.getAssetContext(sessionId, identity.id).asset).toMatchObject({
      properties: { credential_token: 'second-token' },
    });
    const plaintextProbe = new DatabaseSync(path.join(projectPath, '.hexestra', 'engagement.db'), { readOnly: true });
    const storedIdentity = plaintextProbe.prepare('SELECT properties_json FROM assets WHERE id = ?').get(identity.id) as { properties_json: string };
    plaintextProbe.close();
    expect(storedIdentity.properties_json).toContain('second-token');
    expect(sessionService.listEvidence(sessionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: identity.id, kind: 'credential-history', content: expect.stringContaining('first-token') }),
    ]));

    const repeatedEndpoint = (await registerOne({ type: 'endpoint', apiAssetId: api.id, method: 'GET', path: '/users/456' })).assets[0];
    expect(repeatedEndpoint.id).toBe(endpoint.id);

    const uuidEndpoint = (await registerOne({
      type: 'endpoint', apiAssetId: api.id, method: 'GET', path: '/jobs/550e8400-e29b-41d4-a716-446655440000',
    })).assets[0];
    const uuidRepeat = (await registerOne({
      type: 'endpoint', apiAssetId: api.id, method: 'GET', path: '/jobs/123e4567-e89b-12d3-a456-426614174000',
    })).assets[0];
    const malformedUuid = (await registerOne({
      type: 'endpoint', apiAssetId: api.id, method: 'GET', path: '/jobs/550e8400-e29b-41d4-a716-not-a-uuid',
    })).assets[0];
    expect(uuidRepeat.id).toBe(uuidEndpoint.id);
    expect(malformedUuid.id).not.toBe(uuidEndpoint.id);
  });

  it('rolls back a fine-grained batch when a parent asset is missing', async () => {
    const before = sessionService.listAssets(sessionId);
    await expect(syncTargetsService.registerAssets(sessionId, [
      { type: 'subnet', cidr: '2001:db8:abcd:1::7/64' },
      { type: 'endpoint', apiAssetId: 'missing-api', method: 'GET', path: '/health' },
    ])).rejects.toThrow(/missing-api/);
    expect(sessionService.listAssets(sessionId)).toEqual(before);
  });
});
