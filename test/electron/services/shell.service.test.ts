// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import http from 'http';
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
    expect(wrapped).not.toMatch(/hexestra/i);
    const nonce = wrapped.match(/([a-f0-9]{24}):/)?.[1];
    expect(nonce).toBeTruthy();
    pty.emitData(`hello\r\n${nonce}:0\r\n`);

    const result = await resultPromise;
    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, command: 'Write-Output hello' });
    expect(result.output).toContain('hello');
    expect(result.output).not.toContain(nonce);
    expect(service.listAudits('project-1')).toMatchObject([{ id: result.id, outcome: 'completed' }]);
  });

  it('completes an auto-flavor command after output becomes idle without sending Ctrl+C', async () => {
    vi.useFakeTimers();
    try {
      const profile = service.saveProfile('project-1', {
        name: 'Auto shell', kind: 'local', assetRole: 'target', shellFlavor: 'auto',
      });
      const session = await service.connect('project-1', profile.id, 1, 'terminal-auto');
      const resultPromise = service.executeCommand({
        projectId: 'project-1', sessionId: session.id,
        command: 'echo hello', timeoutMs: 5_000,
      }, 'default');

      expect(pty.write).toHaveBeenLastCalledWith('echo hello\r');
      pty.emitData('hello\r\n');
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(resultPromise).resolves.toMatchObject({
        outcome: 'completed_unverified', output: 'hello\r\n', exitCode: undefined,
      });
      expect(pty.write).not.toHaveBeenCalledWith('\x03');
      expect(service.listSessions('project-1')[0]).toMatchObject({ state: 'ready' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns an actionable WebShell profile error instead of a generic rejection', () => {
    expect(() => service.saveProfile('project-1', {
      name: 'Invalid WebShell',
      kind: 'webshell',
      assetRole: 'infrastructure',
      shellFlavor: 'posix',
      webshell: {
        url: 'https://example.test/run?cmd={command}',
        method: 'GET',
        headers: [],
        bodyKind: 'none',
        responseExtract: 'body',
        responseEncoding: 'auto',
        allowInvalidTls: false,
      },
    })).toThrow('exactly one supported placeholder ({{command}} or {{command_base64}})');
  });

  it('runs a WebShell fixture through the visible terminal and preserves cwd for Agent commands', async () => {
    mocks.target = { id: 'asset-1', status: 'active' };
    const server = http.createServer((request, response) => {
      const target = new URL(request.url ?? '/', 'http://127.0.0.1');
      const command = target.searchParams.get('cmd') ?? '';
      const nonce = command.match(/([a-f0-9]{32}):0/)?.[1];
      const begin = nonce ? `${nonce}:0` : undefined;
      const end = nonce ? `${nonce}:1` : undefined;
      if (!begin || !end) {
        response.writeHead(400);
        response.end('missing marker');
        return;
      }
      const output = nonce && command.includes(`${nonce}:2`)
        ? `${nonce}:2`
        : command.includes('printf lines') ? 'bin\nboot\ndev' : command.includes('echo hi') ? 'hi' : 'ready';
      const cwd = command.includes('cd /tmp') ? '/tmp' : '/';
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`${begin}\n${output}\n${end}:0:${cwd}\n`);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
    const profile = service.saveProfile('project-1', {
      name: 'Fixture WebShell', kind: 'webshell', assetRole: 'target', assetId: 'asset-1', shellFlavor: 'posix',
      webshell: {
        url: `http://127.0.0.1:${address.port}/run?cmd={{command}}`, method: 'GET', headers: [], bodyKind: 'none',
        responseExtract: 'body', responseEncoding: 'utf-8', allowInvalidTls: false,
      },
    });
    const connected = await service.connect('project-1', profile.id, 1, 'terminal-webshell');
    expect(connected).toMatchObject({
      kind: 'webshell', state: 'ready', shellFlavor: 'posix', webshellCommandMode: 'os',
      capabilities: { resize: false, exitCode: true },
    });

    service.write('project-1', connected.id, 'cd /tmp\r');
    await waitFor(() => service.readTranscript('project-1', connected.id).content.includes('/tmp$'));
    expect(service.readTranscript('project-1', connected.id).content).toContain('/tmp$');

    service.write('project-1', connected.id, 'printf lines\r');
    await waitFor(() => service.readTranscript('project-1', connected.id).content.includes('bin\r\nboot\r\ndev\r\n'));
    expect(service.readTranscript('project-1', connected.id).content).toContain('bin\r\nboot\r\ndev\r\n');

    const result = await service.executeCommand({ projectId: 'project-1', sessionId: connected.id, command: 'echo hi' }, 'default');
    expect(result).toMatchObject({ outcome: 'completed', output: 'hi', exitCode: 0 });
    expect(service.listAudits('project-1')).toMatchObject([{ id: result.id, outcome: 'completed' }]);
    expect(service.readAudit('project-1', result.id)).toMatchObject({ output: 'hi', exitCode: 0 });
    service.disconnect('project-1', connected.id);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('connects through a language eval form without interpolating the shell wrapper into source code', async () => {
    const decodedWrappers: string[] = [];
    const server = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const source = new URLSearchParams(body).get('x') ?? '';
        const encoded = source.match(/base64_decode\('([^']+)'\)/)?.[1] ?? '';
        const command = Buffer.from(encoded, 'base64').toString('utf8');
        decodedWrappers.push(command);
        const nonce = command.match(/([a-f0-9]{32}):0/)?.[1];
        const begin = nonce ? `${nonce}:0` : undefined;
        const end = nonce ? `${nonce}:1` : undefined;
        const probe = nonce && command.includes(`${nonce}:2`) ? `${nonce}:2` : undefined;
        if (!begin || !end || !probe) {
          response.writeHead(400);
          response.end('invalid decoded wrapper');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(`${begin}\n${probe}\n${end}:0:/\n`);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
      const profile = service.saveProfile('project-1', {
        name: 'Eval form fixture', kind: 'webshell', assetRole: 'infrastructure', shellFlavor: 'posix',
        webshell: {
          url: `http://127.0.0.1:${address.port}/run`, method: 'POST', headers: [], bodyKind: 'form',
          bodyTemplate: "x=ob_end_clean();$c=base64_decode('{{command_base64}}');passthru($c);",
          responseExtract: 'body', responseEncoding: 'utf-8', allowInvalidTls: false,
        },
      });
      const connected = await service.connect('project-1', profile.id, 1, 'terminal-base64-webshell');

      expect(connected).toMatchObject({ kind: 'webshell', state: 'ready', shellFlavor: 'posix' });
      // The probe wrapper plus the system-info collection attempt; the fixture
      // 400s the info command, so only the probe wrapper is verified here.
      expect(decodedWrappers).toHaveLength(2);
      expect(decodedWrappers[0]).toMatch(/printf '[a-f0-9]{32}:2\\n'/);
      expect(decodedWrappers[0]).not.toMatch(/hexestra/i);
      expect(decodedWrappers[0]).toMatch(/r_[a-f0-9]{32}=\$\?/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('records an Agent WebShell timeout as a failed health event', async () => {
    mocks.target = { id: 'asset-1', status: 'active' };
    const server = http.createServer((request, response) => {
      const target = new URL(request.url ?? '/', 'http://127.0.0.1');
      const command = target.searchParams.get('cmd') ?? '';
      const nonce = command.match(/([a-f0-9]{32}):0/)?.[1];
      const begin = nonce ? `${nonce}:0` : undefined;
      const end = nonce ? `${nonce}:1` : undefined;
      if (!begin || !end) {
        response.writeHead(400);
        response.end('missing marker');
        return;
      }
      if (command.includes('delayed-command')) {
        setTimeout(() => {
          if (!response.destroyed) {
            response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
            response.end(`${begin}\nlate\n${end}:0:/\n`);
          }
        }, 1_200);
        return;
      }
      const output = nonce && command.includes(`${nonce}:2`) ? `${nonce}:2` : 'ready';
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`${begin}\n${output}\n${end}:0:/\n`);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
      const profile = service.saveProfile('project-1', {
        name: 'Timeout fixture', kind: 'webshell', assetRole: 'target', assetId: 'asset-1', shellFlavor: 'posix',
        webshell: {
          url: `http://127.0.0.1:${address.port}/run?cmd={{command}}`, method: 'GET', headers: [], bodyKind: 'none',
          commandMode: 'os', responseExtract: 'body', responseEncoding: 'utf-8', allowInvalidTls: false,
        },
      });
      const connected = await service.connect('project-1', profile.id, 1, 'terminal-timeout');
      const result = await service.executeCommand({
        projectId: 'project-1', sessionId: connected.id, command: 'delayed-command', timeoutMs: 1_000,
      }, 'default');

      expect(result.outcome).toBe('timeout');
      expect(service.listProfileHealth('project-1').find((item) => item.profileId === profile.id)).toMatchObject({
        status: 'degraded',
        consecutiveFailures: 1,
        lastError: 'WebShell request timed out',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('auto-detects a PHP eval endpoint independently from the target OS shell flavor', async () => {
    let requestCount = 0;
    const decodedWrappers: string[] = [];
    const server = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requestCount += 1;
        const source = new URLSearchParams(body).get('x') ?? '';
        const encoded = source.match(/base64_decode\('([^']+)'\)/)?.[1];
        if (!encoded) {
          response.writeHead(400);
          response.end('expected PHP source');
          return;
        }
        const command = Buffer.from(encoded, 'base64').toString('utf8');
        decodedWrappers.push(command);
        const nonce = command.match(/([a-f0-9]{32}):0/)?.[1];
        const begin = nonce ? `${nonce}:0` : undefined;
        const end = nonce ? `${nonce}:1` : undefined;
        const probe = nonce && command.includes(`${nonce}:2`) ? `${nonce}:2` : undefined;
        if (!begin || !end || !probe) {
          response.writeHead(400);
          response.end('invalid wrapper');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(`${begin}\n${probe}\n${end}:0:/\n`);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
      const profile = service.saveProfile('project-1', {
        name: 'Auto PHP eval fixture', kind: 'webshell', assetRole: 'infrastructure', shellFlavor: 'posix',
        webshell: {
          url: `http://127.0.0.1:${address.port}/run`, method: 'POST', headers: [], bodyKind: 'form',
          bodyTemplate: 'x={{command}}', commandMode: 'auto', responseExtract: 'body', responseEncoding: 'utf-8', allowInvalidTls: false,
        },
      });
      const connected = await service.connect('project-1', profile.id, 1, 'terminal-auto-php-webshell');

      expect(connected).toMatchObject({ kind: 'webshell', state: 'ready', shellFlavor: 'posix', webshellCommandMode: 'php_eval' });
      // OS probe (1) + php_eval probe (1) + system-info collection attempt (1).
      // The fixture 400s the info command, so collection fails without failing the connection.
      expect(requestCount).toBe(3);
      expect(decodedWrappers).toHaveLength(2);
      expect(decodedWrappers[0]).toMatch(/printf '[a-f0-9]{32}:2\\n'/);
      expect(decodedWrappers[0]).not.toMatch(/hexestra/i);
      service.disconnect('project-1', connected.id);

      const reconnected = await service.connect('project-1', profile.id, 1, 'terminal-auto-php-webshell-2');
      expect(reconnected).toMatchObject({ webshellCommandMode: 'php_eval', shellFlavor: 'posix' });
      expect(requestCount).toBe(5);
      expect(decodedWrappers).toHaveLength(4);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('collects and persists system information once after the first successful connection', async () => {
    let infoRequests = 0;
    const server = http.createServer((request, response) => {
      const target = new URL(request.url ?? '/', 'http://127.0.0.1');
      const command = target.searchParams.get('cmd') ?? '';
      const nonce = command.match(/([a-f0-9]{32}):0/)?.[1];
      const begin = nonce ? `${nonce}:0` : undefined;
      const end = nonce ? `${nonce}:1` : undefined;
      if (!begin || !end) {
        response.writeHead(400);
        response.end('missing marker');
        return;
      }
      if (nonce && command.includes(`${nonce}:2`)) {
        const probe = `${nonce}:2`;
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(`${begin}\n${probe}\n${end}:0:/\n`);
        return;
      }
      const infoNonce = command.match(/([a-f0-9]{32}):3:0:/)?.[1];
      if (infoNonce) {
        infoRequests += 1;
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end([
          begin,
          `${infoNonce}:3:0:Linux fixture 6.1 x86_64`,
          `${infoNonce}:3:1:web01`,
          `${infoNonce}:3:2:www-data`,
          `${infoNonce}:3:3:/var/www`,
          `${infoNonce}:3:4:8.2.21`,
          `${end}:0:/var/www`,
          '',
        ].join('\n'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`${begin}\nready\n${end}:0:/\n`);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
      const profile = service.saveProfile('project-1', {
        name: 'Info fixture', kind: 'webshell', assetRole: 'infrastructure', shellFlavor: 'posix',
        webshell: {
          url: `http://127.0.0.1:${address.port}/run?cmd={{command}}`, method: 'GET', headers: [], bodyKind: 'none',
          commandMode: 'os', responseExtract: 'body', responseEncoding: 'utf-8', allowInvalidTls: false,
        },
      });
      const connected = await service.connect('project-1', profile.id, 1, 'terminal-info');
      const health = service.listProfileHealth('project-1').find((item) => item.profileId === profile.id);
      expect(health).toMatchObject({
        status: 'healthy',
        adapterId: 'generic',
        runtime: 'auto',
        shellFlavor: 'posix',
        commandMode: 'os',
      });
      expect(health?.systemInfo).toEqual({
        os: 'Linux fixture 6.1 x86_64',
        hostname: 'web01',
        user: 'www-data',
        cwd: '/var/www',
        runtimeVersion: '8.2.21',
      });
      service.disconnect('project-1', connected.id);

      // A reconnection reuses the stored system information and collects no more.
      const reconnected = await service.connect('project-1', profile.id, 1, 'terminal-info-2');
      expect(infoRequests).toBe(1);

      const verified = await service.verifyProfile('project-1', profile.id);
      expect(verified).toMatchObject({ status: 'healthy', profileId: profile.id });
      expect(service.listSessions('project-1').map((item) => item.id)).toEqual([reconnected.id]);
      expect(infoRequests).toBe(2);

      service.saveProfile('project-1', { ...profile, name: 'Updated info fixture' });
      expect(service.listProfileHealth('project-1')).toEqual([{
        profileId: profile.id,
        status: 'unknown',
        consecutiveFailures: 0,
      }]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not fail the connection when system information collection fails', async () => {
    const server = http.createServer((request, response) => {
      const target = new URL(request.url ?? '/', 'http://127.0.0.1');
      const command = target.searchParams.get('cmd') ?? '';
      const nonce = command.match(/([a-f0-9]{32}):0/)?.[1];
      const begin = nonce ? `${nonce}:0` : undefined;
      const end = nonce ? `${nonce}:1` : undefined;
      if (!begin || !end) {
        response.writeHead(400);
        response.end('missing marker');
        return;
      }
      if (nonce && command.includes(`${nonce}:2`)) {
        const probe = `${nonce}:2`;
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(`${begin}\n${probe}\n${end}:0:/\n`);
        return;
      }
      // Anything that is not a probe is an info collection: refuse it.
      response.writeHead(503);
      response.end('system information unavailable');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
      const profile = service.saveProfile('project-1', {
        name: 'No-info fixture', kind: 'webshell', assetRole: 'infrastructure', shellFlavor: 'posix',
        webshell: {
          url: `http://127.0.0.1:${address.port}/run?cmd={{command}}`, method: 'GET', headers: [], bodyKind: 'none',
          commandMode: 'os', responseExtract: 'body', responseEncoding: 'utf-8', allowInvalidTls: false,
        },
      });
      const connected = await service.connect('project-1', profile.id, 1, 'terminal-no-info');
      expect(connected.state).toBe('ready');
      const health = service.listProfileHealth('project-1').find((item) => item.profileId === profile.id);
      expect(health?.status).toBe('healthy');
      expect(health?.systemInfo).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns failed verification health and removes the temporary failed session', async () => {
    const port = await getFreePort();
    const profile = service.saveProfile('project-1', {
      name: 'Offline fixture', kind: 'webshell', assetRole: 'infrastructure', shellFlavor: 'posix',
      webshell: {
        url: `http://127.0.0.1:${port}/run?cmd={{command}}`, method: 'GET', headers: [], bodyKind: 'none',
        commandMode: 'os', responseExtract: 'body', responseEncoding: 'utf-8', allowInvalidTls: false,
      },
    });

    const health = await service.verifyProfile('project-1', profile.id);
    expect(health).toMatchObject({
      profileId: profile.id,
      status: 'degraded',
      consecutiveFailures: 1,
    });
    expect(health.lastError).toContain('WebShell probe failed');
    expect(service.listSessions('project-1')).toEqual([]);
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
    const nonce = wrapped.match(/([a-f0-9]{24}):/)?.[1];
    if (nonce) pty.emitData(`${nonce}:0\r\n`);
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
