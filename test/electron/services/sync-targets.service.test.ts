// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  let sessionService: typeof import('@electron/services/session.service').sessionService;
  let syncTargetsService: typeof import('@electron/services/sync-targets.service').syncTargetsService;
  let sessionId: string;

  beforeAll(async () => {
    appData = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-ai-assets-'));
    previousAppData = process.env.APPDATA;
    process.env.APPDATA = appData;
    vi.resetModules();
    sessionService = (await import('@electron/services/session.service')).sessionService;
    syncTargetsService = (await import('@electron/services/sync-targets.service')).syncTargetsService;
    const projectPath = path.join(appData, 'asset-project');
    fs.mkdirSync(projectPath, { recursive: true });
    sessionId = (await sessionService.openProjectPath(projectPath, {
      name: 'AI registration test',
      scope: 'example.com',
    })).id;
  });

  afterAll(async () => {
    sessionService.close();
    process.env.APPDATA = previousAppData;
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
      id: expect.stringMatching(/^TGT-/),
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
});
