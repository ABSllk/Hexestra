// @vitest-environment node
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { Server, type ServerChannel } from 'ssh2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectPath: '',
  state: { shells: { profiles: [] as unknown[], listeners: [] as unknown[] } },
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(), fromId: vi.fn(), getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => mocks.projectPath) },
  safeStorage: { isEncryptionAvailable: vi.fn(() => true), isAsyncEncryptionAvailable: vi.fn(async () => true) },
}));
vi.mock('@electron/services/terminal.service', () => ({ terminatePtyProcessTree: vi.fn() }));
vi.mock('@electron/services/shell-vault', () => ({
  shellVault: {
    list: vi.fn(() => [{ id: 'credential-1', kind: 'password', label: 'SSH password', available: true }]),
    save: vi.fn(), delete: vi.fn(),
    readSecret: vi.fn(async () => ({ secret: 'test-password' })),
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
    getTarget: vi.fn((_projectId: string, id: string) => ({ id, status: 'active' })),
    listAssets: vi.fn(() => []),
    valueIsInScope: vi.fn(() => true),
    upsertEvidence: vi.fn(),
  },
}));

import { ShellService } from '@electron/services/shell.service';

describe('ShellService SSH loopback integration', () => {
  let server: Server;
  let jumpServer: Server;
  let port: number;
  let jumpPort: number;
  let service: ShellService;

  beforeAll(async () => {
    mocks.projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-shell-ssh-'));
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const hostKey = privateKey.export({ type: 'pkcs1', format: 'pem' });
    server = new Server({ hostKeys: [hostKey] }, (client) => {
      client.on('error', () => {});
      client.on('authentication', (context) => {
        if (context.method === 'password' && context.password === 'test-password') context.accept();
        else context.reject();
      });
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          session.on('pty', (acceptPty) => acceptPty?.());
          session.on('window-change', (acceptWindow) => acceptWindow?.());
          session.on('shell', (acceptShell) => {
            const stream = acceptShell() as ServerChannel;
            stream.on('data', (data: Buffer) => {
              const command = data.toString('utf8');
              const nonce = command.match(/__HEXESTRA_([a-f0-9]+)__/)?.[1];
              if (nonce) stream.write(`loopback-user\r\n__HEXESTRA_${nonce}__:0\r\n`);
              else stream.write(command);
            });
          });
        });
      });
    });
    server.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('SSH test server did not bind');
    port = address.port;
    const jumpKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    jumpServer = new Server({
      hostKeys: [jumpKeys.privateKey.export({ type: 'pkcs1', format: 'pem' })],
    }, (client) => {
      client.on('error', () => {});
      client.on('authentication', (context) => {
        if (context.method === 'password' && context.password === 'test-password') context.accept();
        else context.reject();
      });
      client.on('ready', () => {
        client.on('tcpip', (accept, reject, info) => {
          const upstream = net.createConnection({ host: info.destIP, port: info.destPort });
          upstream.once('connect', () => {
            const channel = accept();
            channel.pipe(upstream).pipe(channel);
          });
          upstream.once('error', () => reject());
        });
      });
    });
    jumpServer.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
      jumpServer.once('error', reject);
      jumpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const jumpAddress = jumpServer.address();
    if (!jumpAddress || typeof jumpAddress === 'string') throw new Error('SSH jump test server did not bind');
    jumpPort = jumpAddress.port;
    service = new ShellService(false);
  });

  afterAll(async () => {
    service.destroyAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => jumpServer.close(() => resolve()));
    fs.rmSync(mocks.projectPath, { recursive: true, force: true });
  });

  it('fails closed for first-use host keys, then connects and executes through the visible PTY channel', async () => {
    const initial = service.saveProfile('project-1', {
      name: 'Loopback SSH', kind: 'ssh', host: '127.0.0.1', port,
      username: 'tester', authMethod: 'password', credentialId: 'credential-1',
      assetId: 'target-1', assetRole: 'target', shellFlavor: 'posix',
    });

    let firstError = '';
    try {
      await service.connect('project-1', initial.id, 1, 'terminal-ssh');
    } catch (error) {
      firstError = error instanceof Error ? error.message : String(error);
    }
    const confirmation = firstError.match(/SSH_HOST_KEY_CONFIRMATION_REQUIRED:([^:]+):(SHA256:[A-Za-z0-9+/=]+)/);
    expect(confirmation?.[1]).toBe(initial.id);
    expect(confirmation?.[2]).toMatch(/^SHA256:/);

    const trusted = service.saveProfile('project-1', { ...initial, hostKeyFingerprint: confirmation![2] });
    const connected = await service.connect('project-1', trusted.id, 1, 'terminal-ssh');
    expect(connected).toMatchObject({ state: 'ready', kind: 'ssh', assetId: 'target-1' });
    service.resize('project-1', connected.id, 100, 30);

    const result = await service.executeCommand({
      projectId: 'project-1', sessionId: connected.id,
      command: 'whoami', targetAssetId: 'target-1', timeoutMs: 5_000,
    }, 'auto');
    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0 });
    expect(result.output).toContain('loopback-user');
    expect(service.readTranscript('project-1', connected.id).content).toContain('loopback-user');
  });

  it('routes one target session through a separately pinned single jump host', async () => {
    const directTarget = service.listProfiles('project-1').find((item) => item.name === 'Loopback SSH');
    expect(directTarget?.hostKeyFingerprint).toMatch(/^SHA256:/);
    const jump = service.saveProfile('project-1', {
      name: 'Owned jump', kind: 'ssh', host: '127.0.0.1', port: jumpPort,
      username: 'tester', authMethod: 'password', credentialId: 'credential-1',
      assetId: 'infra-1', assetRole: 'infrastructure', shellFlavor: 'posix',
    });
    const routedTarget = service.saveProfile('project-1', {
      ...directTarget!, jumpProfileId: jump.id,
    });

    let firstError = '';
    try {
      await service.connect('project-1', routedTarget.id, 1, 'terminal-jump');
    } catch (error) {
      firstError = error instanceof Error ? error.message : String(error);
    }
    const confirmation = firstError.match(/SSH_HOST_KEY_CONFIRMATION_REQUIRED:([^:]+):(SHA256:[A-Za-z0-9+/=]+)/);
    expect(confirmation?.[1]).toBe(jump.id);
    service.saveProfile('project-1', { ...jump, hostKeyFingerprint: confirmation![2] });

    const connected = await service.connect('project-1', routedTarget.id, 1, 'terminal-jump');
    expect(connected.state).toBe('ready');
    const result = await service.executeCommand({
      projectId: 'project-1', sessionId: connected.id,
      command: 'whoami', targetAssetId: 'target-1', timeoutMs: 5_000,
    }, 'default');
    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0 });
  });
});
