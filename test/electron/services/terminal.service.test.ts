// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  spawn: vi.fn(),
  ptys: [] as Array<{
    kill: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    emitExit: (exitCode?: number) => void;
  }>,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
    fromId: vi.fn(),
  },
  ipcMain: { handle: mocks.handle },
}));

vi.mock('@electron/services/session.service', () => ({
  sessionService: { getSessionPath: vi.fn(() => 'D:\\project') },
}));

vi.mock('@lydell/node-pty', () => ({
  spawn: mocks.spawn,
}));

import { TERMINAL_RELEASE_GRACE_MS, TerminalService } from '@electron/services/terminal.service';

function createFakePty() {
  const exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  const pty = {
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
      exitListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    emitExit: (exitCode = 0) => {
      for (const listener of exitListeners) listener({ exitCode });
    },
  };
  mocks.ptys.push(pty);
  return pty;
}

describe('TerminalService session leases', () => {
  let service: TerminalService;
  let terminatePty: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.ptys.length = 0;
    mocks.spawn.mockImplementation(createFakePty);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    terminatePty = vi.fn((pty: { kill: () => void }) => pty.kill());
    service = new TerminalService(
      false,
      terminatePty as unknown as (pty: import('@lydell/node-pty').IPty) => void,
    );
  });

  afterEach(() => {
    service.destroyAll();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reuses one PTY and rejects the stale StrictMode lease close', async () => {
    const first = service.createSession('1', 'D:\\project', 'project', undefined, 'terminal-tab');
    const second = service.createSession('1', 'D:\\project', 'project', undefined, 'terminal-tab');

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.leaseId).not.toBe(first.leaseId);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    expect(service.releaseSession(first.sessionId, first.leaseId)).toBe(false);
    expect(service.listSessions('1')).toEqual([{ id: first.sessionId, title: 'Terminal' }]);
    await vi.advanceTimersByTimeAsync(TERMINAL_RELEASE_GRACE_MS + 1);
    expect(mocks.ptys[0].kill).not.toHaveBeenCalled();
  });

  it('reclaims a released PTY before the grace period expires', async () => {
    const first = service.createSession('1', 'D:\\project', 'project', undefined, 'terminal-tab');
    expect(service.releaseSession(first.sessionId, first.leaseId)).toBe(true);
    expect(service.listSessions('1')).toEqual([]);

    const reclaimed = service.createSession('1', 'D:\\project', 'project', 'asset-1', 'terminal-tab');
    expect(reclaimed.sessionId).toBe(first.sessionId);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TERMINAL_RELEASE_GRACE_MS + 1);
    expect(mocks.ptys[0].kill).not.toHaveBeenCalled();
    expect(service.getSessionInfo(first.sessionId)?.activeTargetId).toBe('asset-1');
  });

  it('hides a closed tab immediately and kills an unreclaimed PTY once', async () => {
    const lease = service.createSession('1', 'D:\\project', 'project', undefined, 'terminal-tab');
    expect(service.releaseSession(lease.sessionId, lease.leaseId)).toBe(true);

    expect(service.listSessions('1')).toEqual([]);
    expect(service.getSessionInfo(lease.sessionId)).toBeNull();
    service.write(lease.sessionId, 'ignored');
    service.resize(lease.sessionId, 80, 24);
    expect(mocks.ptys[0].write).not.toHaveBeenCalled();
    expect(mocks.ptys[0].resize).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TERMINAL_RELEASE_GRACE_MS - 1);
    expect(mocks.ptys[0].kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.ptys[0].kill).toHaveBeenCalledTimes(1);
    expect(terminatePty).toHaveBeenCalledTimes(1);
  });

  it('cancels delayed teardown when the PTY exits naturally', async () => {
    const lease = service.createSession('1', 'D:\\project', 'project', undefined, 'terminal-tab');
    service.releaseSession(lease.sessionId, lease.leaseId);
    mocks.ptys[0].emitExit();

    await vi.advanceTimersByTimeAsync(TERMINAL_RELEASE_GRACE_MS + 1);
    expect(mocks.ptys[0].kill).not.toHaveBeenCalled();
    expect(service.listSessions('1')).toEqual([]);
  });

  it('replaces an owner session when its project working directory changes', () => {
    const first = service.createSession('1', 'D:\\one', 'one', undefined, 'terminal-tab');
    const second = service.createSession('1', 'D:\\two', 'two', undefined, 'terminal-tab');

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.ptys[0].kill).toHaveBeenCalledTimes(1);
    expect(service.listSessions('1')).toEqual([{ id: second.sessionId, title: 'Terminal' }]);
  });
});
