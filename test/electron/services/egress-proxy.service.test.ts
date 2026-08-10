// @vitest-environment node
import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  root: '',
  executable: '',
  runtimeChild: null as FakeChild | null,
  validateFail: false,
  controllerPutFail: false,
  parsedVersion: '1.19.29' as string | null,
  handles: vi.fn(),
  state: null as any,
  spawn: vi.fn(),
  controller: vi.fn(),
  browserClose: vi.fn(async () => undefined),
  trafficInterrupt: vi.fn(),
  shellDisconnect: vi.fn(),
}));

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  kill = vi.fn(() => { this.exitCode = 0; queueMicrotask(() => this.emit('exit', 0, null)); return true; });
}

vi.mock('electron', () => ({
  app: { getPath: () => mocks.root, isReady: () => true },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: mocks.handles },
  webContents: { getAllWebContents: () => [] },
}));
vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@electron/services/app-settings.service', () => ({
  appSettingsService: { get: () => ({ mihomoPath: mocks.executable }), update: vi.fn() },
}));
vi.mock('@electron/services/session.service', () => ({
  sessionService: {
    getProjectState: () => structuredClone(mocks.state),
    updateProjectState: (_projectId: string, patch: any) => {
      mocks.state = { ...mocks.state, proxy: { ...mocks.state.proxy, ...patch.proxy } };
      return structuredClone(mocks.state);
    },
  },
}));
vi.mock('@electron/services/egress-proxy-vault', () => ({
  egressProxyVault: {
    list: () => [{ id: 'node-1', name: 'Exit', protocol: 'ss', tcp: true, udp: true, updatedAt: '2026-08-10T00:00:00.000Z' }],
    readNodes: async (ids: string[]) => ids.map((id) => ({
      id, name: id, protocol: 'ss', tcp: true, udp: true, updatedAt: '2026-08-10T00:00:00.000Z',
      proxy: { type: 'ss', server: `${id}.test`, port: 8388, cipher: 'aes-128-gcm', password: 'encrypted-source', udp: true },
    })),
    save: vi.fn(),
    importUriBatch: vi.fn(async () => [
      { id: 'node-batch', name: 'Batch', protocol: 'trojan', tcp: true, udp: false, updatedAt: '2026-08-11T00:00:00.000Z' },
    ]),
    delete: vi.fn(),
  },
}));
vi.mock('@electron/services/browser.service', () => ({ browserService: { closeProjectConnections: mocks.browserClose } }));
vi.mock('@electron/services/traffic.service', () => ({ trafficService: { interruptProjectFlows: mocks.trafficInterrupt } }));
vi.mock('@electron/services/shell.service', () => ({ shellService: { disconnectProjectSessions: mocks.shellDisconnect } }));
vi.mock('@electron/services/mihomo-controller', () => ({
  parseMihomoVersion: () => mocks.parsedVersion,
  requestMihomoController: mocks.controller,
}));

import { EgressProxyService } from '@electron/services/egress-proxy.service';
import { getProjectEgressRoute } from '@electron/services/project-egress';

describe('EgressProxyService lifecycle', () => {
  beforeEach(() => {
    mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-egress-service-'));
    mocks.executable = path.join(mocks.root, 'mihomo.exe');
    fs.writeFileSync(mocks.executable, 'fixture');
    mocks.runtimeChild = null;
    mocks.validateFail = false;
    mocks.controllerPutFail = false;
    mocks.parsedVersion = '1.19.29';
    mocks.state = {
      proxy: {
        enabled: true,
        activeChainId: 'chain-1',
        chains: [
          { id: 'chain-1', name: 'Current', nodeIds: ['node-1'] },
          { id: 'chain-2', name: 'Next', nodeIds: ['node-1', 'node-2'] },
        ],
      },
    };
    mocks.controller.mockReset();
    mocks.controller.mockImplementation(async (_runtime, method: string, requestPath: string) => {
      if (method === 'PUT' && mocks.controllerPutFail) throw new Error('reload rejected');
      if (requestPath === '/proxies') return { proxies: { 'hexestra-hop-1': { udp: true }, 'hexestra-hop-2': { udp: true } } };
      if (requestPath.includes('/delay?')) return { delay: requestPath.includes('hexestra-hop-2') ? 64 : 32 };
      return {};
    });
    mocks.spawn.mockReset();
    mocks.browserClose.mockClear();
    mocks.trafficInterrupt.mockClear();
    mocks.shellDisconnect.mockClear();
    mocks.spawn.mockImplementation((_executable: string, args: string[]) => {
      const child = new FakeChild();
      if (args.includes('-f') && !args.includes('-t')) mocks.runtimeChild = child;
      else queueMicrotask(() => {
        if (args.includes('-t') && mocks.validateFail) {
          child.stderr.emit('data', Buffer.from('invalid config'));
          child.exitCode = 1;
          child.emit('exit', 1, null);
        } else {
          child.stdout.emit('data', Buffer.from('Mihomo Meta v1.19.29'));
          child.exitCode = 0;
          child.emit('exit', 0, null);
        }
      });
      return child;
    });
  });

  afterEach(() => fs.rmSync(mocks.root, { recursive: true, force: true }));

  it('starts with restricted runtime config, publishes proxy routing, and fail-closes on stop/crash', async () => {
    const service = new EgressProxyService();
    const started = await service.start('project-1');
    expect(started.state).toBe('degraded');
    expect(started).toMatchObject({
      enabled: true, tcpReady: true, udpReady: true,
      chainLatencyMs: 32, nodeLatencyMs: { 'node-1': 32 },
    });
    expect(started.latencyCheckedAt).toEqual(expect.any(String));
    expect(getProjectEgressRoute('project-1')).toMatchObject({ mode: 'proxy', mixedPort: started.mixedPort });
    const files = fs.readdirSync(path.join(mocks.root, 'mihomo-runtime'));
    expect(files.filter((name) => name.startsWith('candidate-'))).toEqual([]);
    expect(files).toHaveLength(1);
    const runtimeConfig = fs.readFileSync(path.join(mocks.root, 'mihomo-runtime', files[0]), 'utf8');
    expect(runtimeConfig).toContain('allow-lan: false');
    expect(runtimeConfig).not.toContain('DIRECT');
    const runtimeSpawn = mocks.spawn.mock.calls.find(([, args]) => args.includes('-f') && !args.includes('-t'));
    expect(runtimeSpawn?.[1]).toEqual(['-d', path.join(mocks.root, 'mihomo-runtime'), '-f', expect.any(String)]);

    const stopped = await service.stop('project-1');
    expect(stopped).toMatchObject({ state: 'blocked', tcpReady: false, udpReady: false, mixedPort: null });
    expect(getProjectEgressRoute('project-1')).toMatchObject({ mode: 'blocked' });
    expect(fs.readdirSync(path.join(mocks.root, 'mihomo-runtime'))).toEqual([]);

    const restarted = await service.start('project-1');
    expect(restarted.mixedPort).toBe(started.mixedPort);
    mocks.runtimeChild!.exitCode = 17;
    mocks.runtimeChild!.emit('exit', 17, null);
    await Promise.resolve();
    expect((await service.status('project-1', false)).state).toBe('error');
    expect(getProjectEgressRoute('project-1')).toMatchObject({ mode: 'blocked' });
    expect(mocks.shellDisconnect).toHaveBeenCalledWith('project-1');
    expect(mocks.trafficInterrupt).toHaveBeenCalledWith('project-1', expect.stringContaining('Mihomo exited'));
  });

  it('accepts a runnable Mihomo with a different version without a compatibility warning', async () => {
    mocks.parsedVersion = '1.19.21';
    const service = new EgressProxyService();
    await expect(service.diagnoseRuntime()).resolves.toMatchObject({
      executable: true,
      version: '1.19.21',
      supported: true,
      error: null,
      warning: null,
    });
  });

  it('accepts a runnable Mihomo without warning when its version string cannot be identified', async () => {
    mocks.parsedVersion = null;
    const service = new EgressProxyService();
    await expect(service.diagnoseRuntime()).resolves.toMatchObject({
      executable: true,
      version: null,
      supported: true,
      error: null,
      warning: null,
    });
  });

  it('imports URI batches through the encrypted vault boundary', async () => {
    const service = new EgressProxyService();
    await expect(service.nodesImportBatch('trojan://secret@192.0.2.1:443#Batch')).resolves.toEqual([
      expect.objectContaining({ id: 'node-batch', name: 'Batch', protocol: 'trojan' }),
    ]);
  });

  it('tests saved nodes in an isolated runtime without requiring an active project chain', async () => {
    const service = new EgressProxyService();
    const probeDirectory = path.join(mocks.root, 'mihomo-runtime', 'node-probe');
    fs.mkdirSync(probeDirectory, { recursive: true });
    fs.writeFileSync(path.join(probeDirectory, 'stale-probe.yaml'), 'secret: stale');

    await expect(service.nodesTest()).resolves.toMatchObject({
      checkedAt: expect.any(String),
      nodeLatencyMs: { 'node-1': 32 },
    });

    const probeSpawn = mocks.spawn.mock.calls.find(([, args]) => args.includes('-f') && !args.includes('-t'));
    expect(probeSpawn?.[1]).toEqual(['-d', probeDirectory, '-f', expect.any(String)]);
    expect(mocks.runtimeChild?.kill).toHaveBeenCalled();
    expect(fs.readdirSync(probeDirectory).filter((name) => name.endsWith('.yaml'))).toEqual([]);
    expect(mocks.controller).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'node-probe' }),
      'GET',
      expect.stringContaining('/proxies/hexestra-node-probe-1/delay?'),
    );
  });

  it('retains the persisted active chain when an atomic controller reload fails', async () => {
    const projectId = 'project-atomic-reload';
    const service = new EgressProxyService();
    await service.start(projectId);
    mocks.controllerPutFail = true;
    await expect(service.chainActivate(projectId, 'chain-2')).rejects.toThrow('reload rejected');
    expect(mocks.state.proxy.activeChainId).toBe('chain-1');
    expect(getProjectEgressRoute(projectId).mode).toBe('proxy');
  });

  it('reports per-hop latency and marks the chain unreachable when its exit probe fails', async () => {
    mocks.state.proxy.activeChainId = 'chain-2';
    mocks.controller.mockImplementation(async (_runtime, _method: string, requestPath: string) => {
      if (requestPath === '/proxies') return { proxies: { 'hexestra-hop-1': { udp: true }, 'hexestra-hop-2': { udp: true } } };
      if (requestPath.includes('hexestra-hop-1') && requestPath.includes('/delay?')) return { delay: 28 };
      if (requestPath.includes('hexestra-hop-2') && requestPath.includes('/delay?')) throw new Error('Mihomo controller timed out');
      return {};
    });
    const service = new EgressProxyService();

    const started = await service.start('project-node-health');
    expect(started).toMatchObject({
      chainLatencyMs: null,
      nodeLatencyMs: { 'node-1': 28, 'node-2': null },
    });
    expect(started.latencyCheckedAt).toEqual(expect.any(String));

    const tested = await service.chainTest('project-node-health', 'chain-2');
    expect(tested).toMatchObject({
      latencyMs: null,
      nodeLatencyMs: { 'node-1': 28, 'node-2': null },
      error: 'One or more proxy hops are unreachable',
    });
  });

  it('does not report live latency for a chain that is not active', async () => {
    const service = new EgressProxyService();
    await service.start('project-inactive-health');

    await expect(service.chainTest('project-inactive-health', 'chain-2')).resolves.toMatchObject({
      latencyMs: null,
      nodeLatencyMs: {},
      error: 'Activate this chain and start Mihomo before testing its live latency',
    });
  });

  it('discards an older latency probe when a newer measurement finishes first', async () => {
    const service = new EgressProxyService();
    await service.start('project-latency-race');
    let releaseOlder!: (value: { delay: number }) => void;
    let markOlderStarted!: () => void;
    const olderStarted = new Promise<void>((resolve) => { markOlderStarted = resolve; });
    let delayCall = 0;
    mocks.controller.mockImplementation(async (_runtime, _method: string, requestPath: string) => {
      if (requestPath === '/proxies') return { proxies: { 'hexestra-hop-1': { udp: true } } };
      if (requestPath.includes('/delay?')) {
        delayCall += 1;
        if (delayCall === 1) {
          markOlderStarted();
          return new Promise<{ delay: number }>((resolve) => { releaseOlder = resolve; });
        }
        return { delay: 21 };
      }
      return {};
    });

    const older = service.chainTest('project-latency-race', 'chain-1');
    await olderStarted;
    const newer = await service.chainTest('project-latency-race', 'chain-1');
    releaseOlder({ delay: 99 });
    await older;

    expect(newer.latencyMs).toBe(21);
    await expect(service.status('project-latency-race', false)).resolves.toMatchObject({
      chainLatencyMs: 21,
      nodeLatencyMs: { 'node-1': 21 },
    });
  });

  it('always removes failed validation candidates and keeps the prior runtime route', async () => {
    const projectId = 'project-validation-failure';
    const service = new EgressProxyService();
    await service.start(projectId);
    mocks.validateFail = true;
    await expect(service.chainSave(projectId, { id: 'chain-2', name: 'Invalid', nodeIds: ['node-1', 'node-2'] })).rejects.toThrow('invalid config');
    const files = fs.readdirSync(path.join(mocks.root, 'mihomo-runtime'));
    expect(files.filter((name) => name.startsWith('candidate-'))).toEqual([]);
    expect(getProjectEgressRoute(projectId).mode).toBe('proxy');
  });

  it('fails closed instead of changing a stable project port after a conflict', async () => {
    const projectId = 'project-port-conflict';
    const service = new EgressProxyService();
    const started = await service.start(projectId);
    await service.stop(projectId);
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(started.mixedPort!, '127.0.0.1', resolve));
    try {
      const failed = await service.start(projectId);
      expect(failed).toMatchObject({ state: 'error', mixedPort: null });
      expect(failed.error).toContain('already in use');
      expect(getProjectEgressRoute(projectId).mode).toBe('blocked');
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it('cleans up the previous project runtime when the newly active project has enforcement off', async () => {
    const directExit = vi.fn(async () => '198.51.100.24');
    const service = new EgressProxyService({ proxied: vi.fn(async () => '203.0.113.9'), direct: directExit });
    await service.start('project-switch-old');
    const oldChild = mocks.runtimeChild!;
    mocks.state.proxy.enabled = false;
    const current = await service.status('project-switch-disabled', true);
    expect(current).toMatchObject({
      projectId: 'project-switch-disabled', state: 'off', enabled: false,
      exitIp: '198.51.100.24', lastCheckedAt: expect.any(String),
    });
    expect(directExit).toHaveBeenCalledOnce();
    expect(oldChild.kill).toHaveBeenCalled();
    expect(mocks.shellDisconnect).toHaveBeenCalledWith('project-switch-old');
  });

  it('keeps the off state when the direct exit IP lookup is unavailable', async () => {
    mocks.state.proxy.enabled = false;
    const service = new EgressProxyService({
      proxied: vi.fn(async () => '203.0.113.9'),
      direct: vi.fn(async () => { throw new Error('network unavailable'); }),
    });

    await expect(service.status('project-direct-unavailable', true)).resolves.toMatchObject({
      state: 'off', enabled: false, exitIp: null, error: null, lastCheckedAt: expect.any(String),
    });
  });

  it('resolves the local exit IP after enforcement is disabled', async () => {
    const service = new EgressProxyService({
      proxied: vi.fn(async () => '203.0.113.9'),
      direct: vi.fn(async () => '198.51.100.25'),
    });

    await expect(service.setEnforcement('project-disable', false)).resolves.toMatchObject({
      state: 'off', enabled: false, exitIp: '198.51.100.25', lastCheckedAt: expect.any(String),
    });
    expect(getProjectEgressRoute('project-disable')).toMatchObject({ mode: 'direct' });
  });
});
