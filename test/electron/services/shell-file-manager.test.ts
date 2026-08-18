// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectPath: '',
  state: { shells: { profiles: [] as unknown[], listeners: [] as unknown[] } },
  target: { id: 'asset-1', status: 'active' } as { id: string; status: string } | null,
  sftp: null as FakeSftp | null,
  clientEnd: vi.fn(),
  window: { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [mocks.window]), fromWebContents: vi.fn() },
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => mocks.projectPath) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value)),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false })),
  },
}));

vi.mock('@lydell/node-pty', () => ({ spawn: vi.fn() }));
vi.mock('ssh2', () => ({
  Client: class {
    sftp(callback: (error: Error | undefined, sftp: FakeSftp) => void) { callback(undefined, mocks.sftp!); }
    end() { mocks.clientEnd(); }
  },
}));
vi.mock('@electron/services/terminal.service', () => ({ terminatePtyProcessTree: vi.fn() }));
vi.mock('@electron/services/shell-vault', () => ({ shellVault: { list: vi.fn(() => []), save: vi.fn(), delete: vi.fn(), readSecret: vi.fn() } }));
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
    valueIsInScope: vi.fn(() => true),
    upsertEvidence: vi.fn(),
  },
}));

import { ShellService } from '@electron/services/shell.service';

type FakeEntry = { filename: string; attrs: FakeStats };
type FakeStats = {
  size: number;
  mtime: number;
  mode: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
};

class FakeSftp {
  files = new Map<string, { data: Buffer; stats: FakeStats }>();
  directories = new Set(['/remote/alice', '/remote/alice/empty']);
  closed = false;

  constructor() {
    this.files.set('/remote/alice/readme.txt', { data: Buffer.from('hello\n'), stats: fileStats(6) });
    this.files.set('/remote/alice/.hidden', { data: Buffer.from('hidden'), stats: fileStats(6) });
    this.files.set('/remote/alice/link', { data: Buffer.alloc(0), stats: symlinkStats() });
    this.files.set('/remote/alice/dir/nested.txt', { data: Buffer.from('nested'), stats: fileStats(6) });
    this.directories.add('/remote/alice/dir');
  }

  realpath(_value: string, callback: (error: Error | null, value?: string) => void) { callback(null, '/remote/alice'); }
  lstat(value: string, callback: (error: Error | null, stats?: FakeStats) => void) {
    const normalized = path.posix.normalize(value);
    if (this.directories.has(normalized)) { callback(null, directoryStats()); return; }
    const entry = this.files.get(normalized);
    if (!entry) { callback(Object.assign(new Error('no such file'), { code: 'ENOENT' })); return; }
    callback(null, entry.stats);
  }
  readdir(value: string, callback: (error: Error | null, entries?: FakeEntry[]) => void) {
    const directory = path.posix.normalize(value);
    if (!this.directories.has(directory)) { callback(Object.assign(new Error('no such file'), { code: 'ENOENT' })); return; }
    const entries: FakeEntry[] = [];
    for (const child of this.directories) {
      if (child !== directory && path.posix.dirname(child) === directory) entries.push({ filename: path.posix.basename(child), attrs: directoryStats() });
    }
    for (const [child, entry] of this.files) {
      if (path.posix.dirname(child) === directory) entries.push({ filename: path.posix.basename(child), attrs: entry.stats });
    }
    callback(null, entries);
  }
  readFile(value: string, callback: (error: Error | null, data?: Buffer) => void) {
    const entry = this.files.get(path.posix.normalize(value));
    if (!entry) { callback(Object.assign(new Error('no such file'), { code: 'ENOENT' })); return; }
    callback(null, Buffer.from(entry.data));
  }
  writeFile(value: string, data: Buffer, callback: (error?: Error | null) => void) {
    this.files.set(path.posix.normalize(value), { data: Buffer.from(data), stats: fileStats(data.byteLength) });
    callback(null);
  }
  fastPut(localPath: string, remotePath: string, options: { fileSize?: number; step?: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error | null) => void) {
    const data = fs.readFileSync(localPath);
    const midpoint = Math.ceil(data.byteLength / 2);
    options.step?.(midpoint, midpoint, data.byteLength);
    options.step?.(data.byteLength, data.byteLength - midpoint, data.byteLength);
    this.files.set(path.posix.normalize(remotePath), { data, stats: fileStats(data.byteLength) });
    callback(null);
  }
  deferFastGet = false;
  private pendingFastGet?: { callback: (error?: Error | null) => void; localPath: string; data: Buffer; options: { fileSize?: number; step?: (transferred: number, chunk: number, total: number) => void } };
  fastGet(remotePath: string, localPath: string, options: { fileSize?: number; step?: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error | null) => void) {
    const entry = this.files.get(path.posix.normalize(remotePath));
    if (!entry) { callback(Object.assign(new Error('no such file'), { code: 'ENOENT' })); return; }
    if (this.deferFastGet) {
      this.pendingFastGet = { callback, localPath, data: entry.data, options };
      return;
    }
    fs.writeFileSync(localPath, entry.data);
    const midpoint = Math.ceil(entry.data.byteLength / 2);
    options.step?.(midpoint, midpoint, entry.data.byteLength);
    options.step?.(entry.data.byteLength, entry.data.byteLength - midpoint, entry.data.byteLength);
    callback(null);
  }
  mkdir(value: string, _options: unknown, callback: (error?: Error | null) => void) { this.directories.add(path.posix.normalize(value)); callback(null); }
  rename(source: string, target: string, callback: (error?: Error | null) => void) { this.move(source, target); callback(null); }
  ext_openssh_rename(source: string, target: string, callback: (error?: Error | null) => void) { this.move(source, target); callback(null); }
  unlink(value: string, callback: (error?: Error | null) => void) { this.files.delete(path.posix.normalize(value)); callback(null); }
  rmdir(value: string, callback: (error?: Error | null) => void) { this.directories.delete(path.posix.normalize(value)); callback(null); }
  end() {
    this.closed = true;
    const pending = this.pendingFastGet;
    this.pendingFastGet = undefined;
    pending?.callback(new Error('SFTP channel closed'));
  }

  private move(source: string, target: string) {
    const from = path.posix.normalize(source);
    const to = path.posix.normalize(target);
    const file = this.files.get(from);
    if (file) { this.files.set(to, file); this.files.delete(from); return; }
    if (this.directories.has(from)) { this.directories.add(to); this.directories.delete(from); }
  }
}

function fileStats(size: number): FakeStats { return { size, mtime: 1_700_000_000, mode: 0o100644, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }; }
function directoryStats(): FakeStats { return { size: 0, mtime: 1_700_000_000, mode: 0o40755, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }; }
function symlinkStats(): FakeStats { return { size: 0, mtime: 1_700_000_000, mode: 0o120777, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true }; }

function injectSshSession(service: ShellService, kind: 'ssh' | 'local' = 'ssh') {
  const profile = service.saveProfile('project-1', {
    name: kind === 'ssh' ? 'Connected SSH' : 'Local', kind, assetRole: 'target', assetId: 'asset-1',
    shellFlavor: 'posix', host: 'example.test', port: 22, username: 'alice', authMethod: 'password', credentialId: 'credential-1',
  });
  const value = {
    id: `${kind}-session`, projectId: 'project-1', profileId: profile.id, kind, title: profile.name,
    state: 'ready' as const, revision: 0, assetId: 'asset-1', shellFlavor: 'posix' as const,
    capabilities: { resize: true, interrupt: true, exitCode: true, agentExecute: true, fileAccess: kind === 'ssh' ? 'sftp' as const : 'none' as const },
    createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
  };
  const internal = { value, transcript: '', previewBytes: 0, sshClient: { sftp: (callback: (error: Error | undefined, sftp: FakeSftp) => void) => callback(undefined, mocks.sftp!), end: mocks.clientEnd }, remoteMutation: Promise.resolve(), remoteTransfers: new Map() };
  (service as unknown as { sessions: Map<string, unknown> }).sessions.set(value.id, internal);
  return value.id;
}

describe('SSH SFTP file manager', () => {
  let service: ShellService;
  let sftp: FakeSftp;

  beforeEach(() => {
    mocks.projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-remote-files-'));
    mocks.state.shells = { profiles: [], listeners: [] };
    mocks.clientEnd.mockReset();
    mocks.window.webContents.send.mockReset();
    sftp = new FakeSftp();
    mocks.sftp = sftp;
    service = new ShellService(false);
  });

  afterEach(() => {
    service.destroyAll();
    fs.rmSync(mocks.projectPath, { recursive: true, force: true });
  });

  it('reuses one SFTP channel, lists hidden files and does not follow links', async () => {
    const sessionId = injectSshSession(service);
    expect(await service.remoteHome('project-1', sessionId)).toBe('/remote/alice');
    expect(await service.remoteHome('project-1', sessionId)).toBe('/remote/alice');
    await expect(service.listRemoteFiles('project-1', sessionId, '')).rejects.toThrow('Invalid remote path');
    const entries = await service.listRemoteFiles('project-1', sessionId, '/remote/alice');
    expect(entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['.hidden', 'link', 'readme.txt', 'dir']));
    await expect(service.readRemoteFile('project-1', sessionId, '/remote/alice/link')).rejects.toThrow('regular file');
  });

  it('detects revisions and refuses stale writes unless forced', async () => {
    const sessionId = injectSshSession(service);
    const original = await service.readRemoteFile('project-1', sessionId, '/remote/alice/readme.txt');
    const conflict = await service.writeRemoteFile('project-1', sessionId, '/remote/alice/readme.txt', 'changed', 'stale-revision');
    expect(conflict).toMatchObject({ status: 'conflict', currentRevision: original.revision });
    const written = await service.writeRemoteFile('project-1', sessionId, '/remote/alice/readme.txt', 'changed', original.revision);
    expect(written).toMatchObject({ revision: expect.any(String), content: 'changed' });
    await expect(service.writeRemoteFile('project-1', sessionId, '/remote/alice/readme.txt', 'forced', original.revision, true)).resolves.toMatchObject({ content: 'forced' });
  });

  it('protects roots and requires a recursive preview for non-empty directories', async () => {
    const sessionId = injectSshSession(service);
    await expect(service.previewRemoteDelete('project-1', sessionId, '/')).rejects.toThrow('root');
    const preview = await service.previewRemoteDelete('project-1', sessionId, '/remote/alice/dir');
    expect(preview.recursive).toBe(true);
    await expect(service.deleteRemote('project-1', sessionId, preview.token)).rejects.toThrow('Recursive confirmation');
    await expect(service.deleteRemote('project-1', sessionId, preview.token, true)).rejects.toThrow('missing or expired');
    const fresh = await service.previewRemoteDelete('project-1', sessionId, '/remote/alice/dir');
    await expect(service.deleteRemote('project-1', sessionId, fresh.token, true)).resolves.toMatchObject({ path: '/remote/alice/dir' });
    expect(sftp.files.has('/remote/alice/dir/nested.txt')).toBe(false);
  });

  it('rejects cross-project and non-SSH sessions and closes SFTP resources on disconnect', async () => {
    const sessionId = injectSshSession(service);
    await expect(service.listRemoteFiles('other-project', sessionId, '/remote/alice')).rejects.toThrow('another project');
    const localId = injectSshSession(service, 'local');
    await expect(service.listRemoteFiles('project-1', localId, '/remote/alice')).rejects.toThrow('only for SSH');
    await service.listRemoteFiles('project-1', sessionId, '/remote/alice');
    service.disconnect('project-1', sessionId);
    expect(sftp.closed).toBe(true);
    expect(mocks.clientEnd).toHaveBeenCalled();
  });

  it('streams single-file Agent transfers through sibling temporary files and honors overwrite', async () => {
    const sessionId = injectSshSession(service);
    const localSource = path.join(mocks.projectPath, 'upload.txt');
    const localDestination = path.join(mocks.projectPath, 'download.txt');
    fs.writeFileSync(localSource, 'uploaded');
    const uploaded = await service.uploadRemoteFile('project-1', sessionId, localSource, '/remote/alice/uploaded.txt');
    expect(uploaded).toMatchObject({ results: [{ name: 'uploaded.txt', status: 'completed' }] });
    expect(sftp.files.get('/remote/alice/uploaded.txt')?.data.toString()).toBe('uploaded');
    const uploadProgress = mocks.window.webContents.send.mock.calls
      .map((call) => call[1] as { direction?: string; status?: string; transferred?: number })
      .filter((event) => event.direction === 'upload' && event.status === 'running')
      .map((event) => event.transferred);
    expect(uploadProgress).toContain(4);
    expect(uploadProgress).toContain(8);
    await expect(service.downloadRemoteFileTo('project-1', sessionId, '/remote/alice/uploaded.txt', localDestination)).resolves.toMatchObject({ size: 8 });
    expect(fs.readFileSync(localDestination, 'utf8')).toBe('uploaded');
    await expect(service.downloadRemoteFileTo('project-1', sessionId, '/remote/alice/uploaded.txt', localDestination)).rejects.toThrow('already exists');
    fs.writeFileSync(localDestination, 'old');
    await service.downloadRemoteFileTo('project-1', sessionId, '/remote/alice/uploaded.txt', localDestination, true);
    expect(fs.readFileSync(localDestination, 'utf8')).toBe('uploaded');
    expect(fs.readdirSync(mocks.projectPath).some((name) => name.includes('.hexestra-'))).toBe(false);
  });

  it('reports cumulative transfer progress and aborts a canceled download', async () => {
    const sessionId = injectSshSession(service);
    const destination = path.join(mocks.projectPath, 'canceled.txt');
    sftp.deferFastGet = true;
    const pending = service.downloadRemoteFileTo('project-1', sessionId, '/remote/alice/readme.txt', destination);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const runningEvents = mocks.window.webContents.send.mock.calls
      .map((call) => call[1] as { direction?: string; status?: string; transferred?: number; transferId?: string })
      .filter((event) => event.direction === 'download');
    const transferId = runningEvents.find((event) => event.status === 'running')?.transferId;
    expect(transferId).toBeTruthy();
    expect(service.cancelRemoteTransfer('project-1', sessionId, transferId!)).toBe(true);
    await expect(pending).resolves.toMatchObject({ canceled: true });
    expect(sftp.closed).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
    expect(runningEvents[0]?.transferred).toBe(0);

    sftp.deferFastGet = false;
    const completedDestination = path.join(mocks.projectPath, 'completed.txt');
    await service.downloadRemoteFileTo('project-1', sessionId, '/remote/alice/readme.txt', completedDestination);
    const progress = mocks.window.webContents.send.mock.calls
      .map((call) => call[1] as { direction?: string; status?: string; transferred?: number })
      .filter((event) => event.direction === 'download' && event.status === 'running')
      .map((event) => event.transferred);
    expect(progress).toContain(3);
    expect(progress).toContain(6);
  });
});
