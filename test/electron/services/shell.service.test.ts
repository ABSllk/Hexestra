// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  spawn: vi.fn(),
  projectPath: '',
  state: { shells: { profiles: [] as unknown[], listeners: [] as unknown[] } },
  target: null as null | { id: string; status: string },
  inScope: true,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
    fromId: vi.fn(),
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: { handle: mocks.handle },
  app: { getPath: vi.fn(() => mocks.projectPath) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value)),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false })),
  },
}));

vi.mock('@lydell/node-pty', () => ({ spawn: mocks.spawn }));
vi.mock('ssh2', () => ({ Client: class {} }));
vi.mock('@electron/services/terminal.service', () => ({ terminatePtyProcessTree: vi.fn() }));
vi.mock('@electron/services/shell-vault', () => ({
  shellVault: {
    list: vi.fn(() => []),
    save: vi.fn(),
    delete: vi.fn(),
    readSecret: vi.fn(),
  },
}));
vi.mock('@electron/services/session.service', () => ({
  sessionService: {
    getSessionPath: vi.fn(() => mocks.projectPath),
    getProjectState: vi.fn(() => mocks.state),
    updateProjectState: vi.fn((_projectId: string, patch: { shells?: unknown }) => {
      if (patch.shells) mocks.state.shells = patch.shells as typeof mocks.state.shells;
      return mocks.state;
    }),
    getTarget: vi.fn(() => mocks.target),
    listAssets: vi.fn(() => []),
    valueIsInScope: vi.fn(() => mocks.inScope),
    upsertEvidence: vi.fn(),
  },
}));

import { ShellService } from '@electron/services/shell.service';
import { LOCAL_OPERATOR_ASSET_ID } from '@electron/contracts/shell';

function fakePty() {
  const dataListeners: Array<(data: string) => void> = [];
  const exitListeners: Array<() => void> = [];
  return {
    pid: 42,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((listener: (data: string) => void) => { dataListeners.push(listener); }),
    onExit: vi.fn((listener: () => void) => { exitListeners.push(listener); }),
    emitData: (data: string) => dataListeners.forEach((listener) => listener(data)),
    emitExit: () => exitListeners.forEach((listener) => listener()),
  };
}

describe('ShellService local session and Agent lease', () => {
  let service: ShellService;
  let pty: ReturnType<typeof fakePty>;

  beforeEach(() => {
    mocks.projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-shell-service-'));
    mocks.state.shells = { profiles: [], listeners: [] };
    mocks.target = null;
    mocks.inScope = true;
    pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    service = new ShellService(false);
  });

  afterEach(() => {
    service.destroyAll();
    fs.rmSync(mocks.projectPath, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('uses one visible transport lease, parses a sentinel, and audits full output', async () => {
    const profile = service.saveProfile('project-1', {
      name: 'Local PowerShell', kind: 'local', assetRole: 'target', shellFlavor: 'powershell',
    });
    const session = await service.connect('project-1', profile.id, 1, 'terminal-1');
    expect(session.state).toBe('ready');
    expect(session.revision).toBe(1);

    const resultPromise = service.executeCommand({
      projectId: 'project-1', sessionId: session.id,
      command: 'Write-Output hello', timeoutMs: 5_000,
    }, 'default');
    const wrapped = String(pty.write.mock.calls.at(-1)?.[0]);
    const nonce = wrapped.match(/__HEXESTRA_([a-f0-9]+)__/)?.[1];
    expect(nonce).toBeTruthy();
    pty.emitData(`hello\r\n__HEXESTRA_${nonce}__:0\r\n`);

    const result = await resultPromise;
    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, command: 'Write-Output hello' });
    expect(result.output).toContain('hello');
    expect(result.output).not.toContain('__HEXESTRA_');
    expect(service.listAudits('project-1')).toMatchObject([{ id: result.id, outcome: 'completed' }]);
  });

  it('quarantines a raw reverse connection until it is bound to an in-scope asset', async () => {
    mocks.target = { id: 'target-1', status: 'active' };
    const port = await getFreePort();
    const listener = service.saveListener('project-1', {
      name: 'Loopback reverse', bindAddress: '127.0.0.1', port, shellFlavor: 'raw',
    });
    await service.startListener('project-1', listener.id);

    const socket = net.createConnection({ host: '127.0.0.1', port });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write('reverse-banner\n');
    await waitFor(() => service.listSessions('project-1').length === 1);
    const quarantined = service.listSessions('project-1')[0];
    await waitFor(() => service.listSessions('project-1')[0]?.preview?.includes('reverse-banner') ?? false);
    expect(quarantined.state).toBe('quarantined');
    expect(() => service.write('project-1', quarantined.id, 'blocked')).toThrow(/bound/);
    expect(service.readTranscript('project-1', quarantined.id).content).toBe('');

    const bound = service.bindReverseSession('project-1', quarantined.id, 'target-1');
    expect(bound.state).toBe('ready');
    expect(service.readTranscript('project-1', quarantined.id).content).toContain('reverse-banner');
    const received = new Promise<string>((resolve) => socket.once('data', (data) => resolve(data.toString())));
    service.write('project-1', quarantined.id, 'whoami\r');
    await expect(received).resolves.toBe('whoami\r');

    await expect(service.stopListener('project-1', listener.id)).resolves.toBe(true);
    service.disconnect('project-1', quarantined.id);
    socket.destroy();
  });

  it('allows only a loopback reverse connection to bind to this Hexestra device', async () => {
    const port = await getFreePort();
    const listener = service.saveListener('project-1', {
      name: 'Self test', bindAddress: '127.0.0.1', port, shellFlavor: 'raw',
    });
    await service.startListener('project-1', listener.id);
    const socket = net.createConnection({ host: '127.0.0.1', port });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    await waitFor(() => service.listSessions('project-1').length === 1);
    const quarantined = service.listSessions('project-1')[0];

    const bound = service.bindReverseSession('project-1', quarantined.id, LOCAL_OPERATOR_ASSET_ID);
    expect(bound).toMatchObject({ state: 'ready', assetId: LOCAL_OPERATOR_ASSET_ID });
    const received = new Promise<string>((resolve) => socket.once('data', (data) => resolve(data.toString())));
    service.write('project-1', quarantined.id, 'self-test\r');
    await expect(received).resolves.toBe('self-test\r');

    service.disconnect('project-1', quarantined.id);
    await service.stopListener('project-1', listener.id);
    socket.destroy();
  });

  it('builds connection commands from current listener coordinates', () => {
    const listener = service.saveListener('project-1', {
      name: 'Connect Builder fixture', bindAddress: '127.0.0.1', port: 4444, shellFlavor: 'raw',
    });
    expect(service.listConnectTemplates()).toHaveLength(6);
    expect(service.buildConnectCommand({
      projectId: 'project-1', listenerId: listener.id, templateId: 'python3',
      callbackAddress: listener.bindAddress, callbackPort: listener.port,
    })).toMatchObject({
      listenerId: listener.id,
      callbackAddress: '127.0.0.1',
      callbackPort: 4444,
      localOnly: true,
      obfuscation: 'none',
      template: { id: 'python3' },
    });
    // A different callback address is allowed (e.g. public IP behind NAT)
    expect(service.buildConnectCommand({
      projectId: 'project-1', listenerId: listener.id, templateId: 'python3',
      callbackAddress: '203.0.113.5', callbackPort: listener.port,
    })).toMatchObject({ callbackAddress: '203.0.113.5', localOnly: false });
    expect(() => service.buildConnectCommand({
      projectId: 'project-1', listenerId: listener.id, templateId: 'python3',
      callbackAddress: listener.bindAddress, callbackPort: 5555,
    })).toThrow('Reverse listener port changed');
    expect(() => service.buildConnectCommand({
      projectId: 'project-1', listenerId: 'listener-missing', templateId: 'python3',
      callbackAddress: '127.0.0.1', callbackPort: 4444,
    })).toThrow('Reverse listener profile not found');
  });

  it('tracks multiple raw reverse sessions independently on one listener', async () => {
    mocks.target = { id: 'target-1', status: 'active' };
    const port = await getFreePort();
    const listener = service.saveListener('project-1', {
      name: 'Multi-session reverse', bindAddress: '127.0.0.1', port, shellFlavor: 'raw',
    });
    await service.startListener('project-1', listener.id);

    const firstSocket = net.createConnection({ host: '127.0.0.1', port });
    const secondSocket = net.createConnection({ host: '127.0.0.1', port });
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        firstSocket.once('connect', resolve);
        firstSocket.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        secondSocket.once('connect', resolve);
        secondSocket.once('error', reject);
      }),
    ]);
    await waitFor(() => service.listSessions('project-1').length === 2);
    const [firstSession, secondSession] = service.listSessions('project-1');

    service.bindReverseSession('project-1', firstSession.id, 'target-1');
    expect(() => service.write('project-1', secondSession.id, 'blocked')).toThrow(/bound/);
    service.bindReverseSession('project-1', secondSession.id, 'target-1');

    const firstReceived = new Promise<string>((resolve) => firstSocket.once('data', (data) => resolve(data.toString())));
    const secondReceived = new Promise<string>((resolve) => secondSocket.once('data', (data) => resolve(data.toString())));
    service.write('project-1', firstSession.id, 'first\r');
    service.write('project-1', secondSession.id, 'second\r');
    await expect(firstReceived).resolves.toBe('first\r');
    await expect(secondReceived).resolves.toBe('second\r');

    service.disconnect('project-1', firstSession.id);
    expect(service.listSessions('project-1').map((session) => session.id)).toEqual([secondSession.id]);
    service.disconnect('project-1', secondSession.id);
    await service.stopListener('project-1', listener.id);
    firstSocket.destroy();
    secondSocket.destroy();
  });

  it.skipIf(process.platform !== 'win32')('starts a selected WSL distribution through node-pty without shell interpolation', async () => {
    const profile = service.saveProfile('project-1', {
      name: 'Ubuntu tools', kind: 'wsl', wslDistribution: 'Ubuntu-24.04',
      assetRole: 'target', shellFlavor: 'posix',
    });
    const connected = await service.connect('project-1', profile.id, 1, 'terminal-wsl');
    expect(connected).toMatchObject({ kind: 'wsl', state: 'ready' });
    expect(mocks.spawn).toHaveBeenCalledWith(
      'wsl.exe',
      ['--distribution', 'Ubuntu-24.04', '--cd', '~'],
      expect.objectContaining({ useConptyDll: false }),
    );
  });

  it('allows commands with IP literals regardless of scope state', async () => {
    const profile = service.saveProfile('project-1', {
      name: 'Local', kind: 'local', assetRole: 'target', shellFlavor: 'powershell',
    });
    const connected = await service.connect('project-1', profile.id, 1, 'terminal-scope');
    mocks.inScope = false;
    const resultPromise = service.executeCommand({
      projectId: 'project-1', sessionId: connected.id,
      command: 'echo ok',
    }, 'bypassPermissions');
    const wrapped = String(pty.write.mock.calls.at(-1)?.[0]);
    const nonce = wrapped.match(/__HEXESTRA_([a-f0-9]+)__/)?.[1];
    if (nonce) pty.emitData(`__HEXESTRA_${nonce}__:0\r\n`);
    const result = await resultPromise;
    expect(result).toMatchObject({ outcome: 'completed' });
    expect(service.listSessions('project-1').find((item) => item.id === connected.id)?.state).toBe('ready');
  });
});

async function getFreePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to allocate test port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for shell test condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
