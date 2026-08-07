import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrafficFlow } from '@electron/contracts/traffic';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  sessionPath: '',
  projectState: {} as Record<string, unknown>,
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.sessionPath) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: mocks.handle },
}));

vi.mock('@electron/services/browser.service', () => ({
  browserService: { setProjectProxy: vi.fn(async () => undefined) },
}));

vi.mock('@electron/services/session.service', () => ({
  sessionService: {
    getSessionPath: vi.fn(() => mocks.sessionPath),
    getProjectState: vi.fn(() => mocks.projectState),
    updateProjectState: vi.fn((_projectId: string, patch: Record<string, unknown>) => { mocks.projectState = { ...mocks.projectState, ...patch }; }),
    valueIsInScope: vi.fn(() => true),
    upsertEvidence: vi.fn(),
  },
}));

import { connectOptionalBurpMcp, TrafficService } from '@electron/services/traffic.service';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  mocks.projectState = {};
  vi.clearAllMocks();
});

function pausedFlow(): TrafficFlow {
  return {
    id: 'paused-orphan',
    projectId: 'project-1',
    revision: 3,
    state: 'request_paused',
    scopeState: 'out_of_scope',
    source: 'browser',
    request: {
      method: 'GET', url: 'https://example.test/orphan', httpVersion: 'http/1.1',
      headers: [], body: { encoding: 'utf8', data: '', byteLength: 0 },
    },
    timing: { startedAt: '2026-08-03T00:00:00.000Z' },
    route: { burpEnabled: false, burpRouted: false },
  };
}

function completedFlow(): TrafficFlow {
  return {
    ...pausedFlow(),
    id: 'completed-mirror',
    state: 'completed',
    revision: 0,
    response: {
      statusCode: 200, httpVersion: 'http/1.1', headers: [],
      body: { encoding: 'utf8', data: 'ok', byteLength: 2 },
    },
    timing: { startedAt: '2026-08-03T00:00:00.000Z', completedAt: '2026-08-03T00:00:00.010Z', durationMs: 10 },
  };
}

describe('TrafficService deletion', () => {
  it('marks an ownerless persisted pause interrupted and deletes it without a ready proxy', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-traffic-service-'));
    roots.push(root);
    mocks.sessionPath = root;
    const service = new TrafficService();
    const flow = pausedFlow();
    service['repository']('project-1').upsert(flow);
    const replaySession = service['replayRepository']('project-1').open(flow);

    await expect(service.delete('project-1', 'paused-orphan')).resolves.toEqual({
      flowId: 'paused-orphan', deleted: true, droppedIntercepted: true,
      clearedReplaySessionIds: [replaySession.id],
    });
    expect(service['repository']('project-1').read('paused-orphan')).toBeNull();
    expect(service['replayRepository']('project-1').read(replaySession.id)).toBeNull();
    await service.close();
  });

  it('continues retaining Repeater sources during project-wide clear', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-traffic-service-'));
    roots.push(root);
    mocks.sessionPath = root;
    const service = new TrafficService();
    const flow = { ...pausedFlow(), id: 'retained-source', state: 'completed' as const };
    service['repository']('project-1').upsert(flow);
    const replaySession = service['replayRepository']('project-1').open(flow);

    await expect(service.clear('project-1')).resolves.toMatchObject({
      deleted: 0, retainedActive: 0, retainedRepeaterSources: 1, droppedIntercepted: 0,
    });
    expect(service['repository']('project-1').read(flow.id)).not.toBeNull();
    expect(service['replayRepository']('project-1').read(replaySession.id)).not.toBeNull();
    await service.close();
  });
});

describe('TrafficService optional Burp MCP startup', () => {
  it('keeps Bridge mirroring independent when MCP discovery fails', async () => {
    const connect = vi.fn(async () => { throw new Error('MCP SSE endpoint was not found'); });
    const close = vi.fn(async () => undefined);
    const status = vi.fn((proxyReachable: boolean, error?: string) => ({
      proxyReachable,
      mcpReachable: false,
      edition: 'unknown' as const,
      tools: [],
      ...(error ? { error } : {}),
    }));

    await expect(connectOptionalBurpMcp({ connect, close, status }, 'http://127.0.0.1:9876/sse')).resolves.toMatchObject({
      proxyReachable: false,
      mcpReachable: false,
      error: 'MCP SSE endpoint was not found',
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('ignores Proxy Intercept state because mirroring is outside the live route', async () => {
    const connect = vi.fn(async () => ({
      proxyReachable: true,
      mcpReachable: true,
      edition: 'community' as const,
      tools: ['proxy_intercept_status'],
      interceptEnabled: true,
    }));
    const close = vi.fn(async () => undefined);
    const status = vi.fn(() => ({
      proxyReachable: true,
      mcpReachable: false,
      edition: 'unknown' as const,
      tools: [],
    }));

    await expect(connectOptionalBurpMcp({ connect, close, status }, 'http://127.0.0.1:9876/sse')).resolves.toMatchObject({
      proxyReachable: false,
      mcpReachable: true,
      interceptEnabled: true,
    });
    expect(close).not.toHaveBeenCalled();
  });
});

describe('TrafficService Burp mirror queue', () => {
  it('keeps capture ready on Bridge failure and retries the durable Flow only on explicit reconnect', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-traffic-service-'));
    roots.push(root);
    mocks.sessionPath = root;
    const mirror = vi.fn()
      .mockRejectedValueOnce(new Error('Bridge offline'))
      .mockResolvedValueOnce({ accepted: true, duplicate: false, siteMap: true, organizer: true });
    const client = { health: vi.fn(), mirror };
    const service = new TrafficService(() => client as never);
    const profile = {
      ...service['persistedProfile']('project-1'),
      enabled: true,
      burp: {
        ...service['persistedProfile']('project-1').burp,
        enabled: true,
        bridgeToken: 'x'.repeat(32),
      },
    };
    const runtime = {
      sidecar: { stop: vi.fn(async () => undefined) },
      profile,
      state: 'ready' as const,
      mirrorClient: client,
      mirrorCapabilities: ['site_map', 'organizer'],
      burpStatus: {
        proxyReachable: false, mcpReachable: false, bridgeReachable: true,
        bridgeCapabilities: ['site_map', 'organizer'], edition: 'unknown' as const, tools: [],
      },
      mirrorDrain: undefined as Promise<void> | undefined,
    };
    service['runtimes'].set('project-1', runtime as never);

    service['ingest']('project-1', completedFlow());
    await runtime['mirrorDrain'];
    expect(runtime.state).toBe('ready');
    expect(service.read('project-1', 'completed-mirror').route).toMatchObject({
      burpMode: 'mirror', burpMirrorState: 'failed', burpMirrorError: 'Bridge offline',
    });
    expect(mirror).toHaveBeenCalledTimes(1);

    runtime.burpStatus.bridgeReachable = true;
    service['prepareMirrorBackfill']('project-1', true);
    service['scheduleMirrorDrain']('project-1', runtime as never);
    await runtime['mirrorDrain'];
    const syncedRoute = service.read('project-1', 'completed-mirror').route;
    expect(syncedRoute).toMatchObject({ burpMode: 'mirror', burpMirrorState: 'synced' });
    expect(syncedRoute.burpMirrorError).toBeUndefined();
    expect(mirror).toHaveBeenCalledTimes(2);

    service['runtimes'].delete('project-1');
    await service.close();
  });
});
