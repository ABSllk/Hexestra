import { BrowserWindow, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { spawn as spawnPty, type IPty } from '@lydell/node-pty';
import { v4 as uuid } from 'uuid';
import { sessionService } from './session.service';

interface PtySession {
  id: string;
  pty: IPty;
  title: string;
  createdAt: string;
  cwd: string;
  windowId: string;
  leaseId: string;
  activeTargetId?: string;
  ownerId?: string;
}

interface PendingTerminalClose {
  timer: ReturnType<typeof setTimeout>;
}

export interface TerminalSessionLease {
  sessionId: string;
  title: string;
  leaseId: string;
}

export const TERMINAL_RELEASE_GRACE_MS = 500;

type PtyTerminator = (pty: IPty) => void;

export function terminatePtyProcessTree(pty: IPty) {
  if (process.platform !== 'win32') {
    pty.kill();
    return;
  }

  // node-pty's system-ConPTY kill path forks conpty_console_list_agent and
  // immediately destroys the console. On Electron/Windows that child can lose
  // the race and throw `AttachConsole failed`. taskkill terminates the concrete
  // process tree without invoking that helper; node-pty then observes the
  // normal process-exit callback and releases its pipes.
  execFile(
    'taskkill.exe',
    ['/pid', String(pty.pid), '/t', '/f'],
    { windowsHide: true },
    (error) => {
      if (!error) return;
      try {
        process.kill(pty.pid);
      } catch {
        // The shell may already have exited between release and finalization.
      }
    },
  );
}

export class TerminalService {
  private sessions: Map<string, PtySession> = new Map();
  private windows: Map<string, Set<string>> = new Map(); // windowId -> sessionIds
  private pendingCloses: Map<string, PendingTerminalClose> = new Map();

  constructor(registerHandlers = true, private readonly terminatePty: PtyTerminator = terminatePtyProcessTree) {
    if (registerHandlers) this.registerHandlers();
  }

  private registerHandlers() {
    // Create a new terminal PTY session
    ipcMain.handle('terminal:create', (
      event,
      engagementId?: string,
      activeTargetId?: string,
      ownerId?: string,
    ) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      if (!browserWindow) {
        throw new Error('Unable to resolve the renderer window for the terminal session');
      }
      const cwd = engagementId ? sessionService.getSessionPath(engagementId) : process.cwd();
      return this.createSession(String(browserWindow.id), cwd, engagementId, activeTargetId, ownerId);
    });

    // Write input to a PTY session
    ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
      this.write(sessionId, data);
    });

    // Resize a PTY session
    ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
      this.resize(sessionId, cols, rows);
    });

    // Close/kill a PTY session
    ipcMain.handle('terminal:close', (_event, sessionId: string, leaseId?: string) => {
      return this.releaseSession(sessionId, leaseId);
    });

    // List active PTY sessions for a window
    ipcMain.handle('terminal:list', (event) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      if (!browserWindow) return [];
      return this.listSessions(String(browserWindow.id));
    });

    // Get PTY session info
    ipcMain.handle('terminal:info', (_event, sessionId: string) => {
      return this.getSessionInfo(sessionId);
    });

    ipcMain.handle('terminal:set-context', (_event, sessionId: string, activeTargetId?: string) => {
      this.setActiveTarget(sessionId, activeTargetId);
    });
  }

  createSession(
    windowId: string,
    cwd = process.cwd(),
    engagementId?: string,
    activeTargetId?: string,
    ownerId?: string,
  ): TerminalSessionLease {
    if (ownerId) {
      const reusable = [...this.sessions.values()].find((session) => (
        session.windowId === windowId
        && session.ownerId === ownerId
        && session.cwd === cwd
      ));
      if (reusable) {
        this.cancelPendingClose(reusable.id);
        reusable.leaseId = uuid();
        reusable.activeTargetId = activeTargetId;
        this.trackSession(windowId, reusable.id);
        console.log(`[PTY] Reused session ${reusable.id} for window ${windowId}`);
        return { sessionId: reusable.id, title: reusable.title, leaseId: reusable.leaseId };
      }

      const existingIds = [...(this.windows.get(windowId) ?? [])];
      for (const existingId of existingIds) {
        if (this.sessions.get(existingId)?.ownerId === ownerId) {
          this.closeSession(existingId);
        }
      }
    }
    const id = `pty-${uuid().slice(0, 8)}`;
    const title = `Terminal`;
    const leaseId = uuid();

    // Use appropriate shell based on platform
    const shell = process.platform === 'win32'
      ? 'powershell.exe'
      : (process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'));

    const pty = spawnPty(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        ELECTRON_RUN_AS_NODE: undefined, // Prevent Electron from being forced to node mode
      },
      // Prefer the Windows system ConPTY. node-pty marks its bundled DLL as
      // experimental; on current Windows it can collapse rapid line output
      // into cursor-position updates and leave xterm without scrollback.
      useConptyDll: false,
    });

    const session: PtySession = {
      id,
      pty,
      title,
      createdAt: new Date().toISOString(),
      cwd,
      windowId,
      leaseId,
      activeTargetId,
      ownerId,
    };

    this.sessions.set(id, session);
    this.trackSession(windowId, id);

    // Forward PTY output to the renderer
    pty.onData((data: string) => {
      const win = this.findWindowForSession(id);
      if (win) {
        const browserWindow = BrowserWindow.fromId(Number(win));
        if (browserWindow && !browserWindow.isDestroyed()) {
          browserWindow.webContents.send('terminal:output', {
            sessionId: id,
            data,
          });
        }
      }
    });

    // Handle PTY exit
    pty.onExit(({ exitCode, signal }) => {
      const win = this.findWindowForSession(id);
      if (win) {
        const browserWindow = BrowserWindow.fromId(Number(win));
        if (browserWindow && !browserWindow.isDestroyed()) {
          browserWindow.webContents.send('terminal:exit', {
            sessionId: id,
            exitCode,
            signal,
          });
        }
      }
      this.cancelPendingClose(id);
      this.sessions.delete(id);
      this.removeSessionTracking(id);
    });

    console.log(`[PTY] Created session ${id} for window ${windowId}`);
    return { sessionId: id, title, leaseId };
  }

  write(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId);
    if (session && this.isSessionTracked(session)) {
      session.pty.write(data);
    }
  }

  resize(sessionId: string, cols: number, rows: number) {
    const session = this.sessions.get(sessionId);
    if (session && this.isSessionTracked(session)) {
      session.pty.resize(cols, rows);
    }
  }

  releaseSession(sessionId: string, leaseId?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || (leaseId && session.leaseId !== leaseId)) return false;
    if (this.pendingCloses.has(sessionId)) return true;

    this.removeSessionTracking(sessionId);
    const timer = setTimeout(() => this.closeSession(sessionId), TERMINAL_RELEASE_GRACE_MS);
    timer.unref?.();
    this.pendingCloses.set(sessionId, { timer });
    console.log(`[PTY] Released session ${sessionId}`);
    return true;
  }

  closeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.cancelPendingClose(sessionId);
    this.sessions.delete(sessionId);
    this.removeSessionTracking(sessionId);
    this.terminatePty(session.pty);
    console.log(`[PTY] Closed session ${sessionId}`);
  }

  listSessions(windowId: string): { id: string; title: string }[] {
    const sessions = this.windows.get(windowId);
    if (!sessions) return [];
    return Array.from(sessions)
      .map((id) => this.sessions.get(id))
      .filter(Boolean)
      .map((s) => ({ id: s!.id, title: s!.title }));
  }

  getSessionInfo(sessionId: string): { title: string; createdAt: string; activeTargetId?: string } | null {
    const session = this.sessions.get(sessionId);
    if (!session || !this.isSessionTracked(session)) return null;
    return {
      title: session.title,
      createdAt: session.createdAt,
      activeTargetId: session.activeTargetId,
    };
  }

  setActiveTarget(sessionId: string, activeTargetId?: string) {
    const session = this.sessions.get(sessionId);
    if (session && this.isSessionTracked(session)) session.activeTargetId = activeTargetId || undefined;
  }

  private findWindowForSession(sessionId: string): string | null {
    for (const [windowId, sessions] of this.windows) {
      if (sessions.has(sessionId)) return windowId;
    }
    return null;
  }

  private removeSessionTracking(sessionId: string) {
    for (const [windowId, sessions] of this.windows) {
      sessions.delete(sessionId);
      if (sessions.size === 0) this.windows.delete(windowId);
    }
  }

  private trackSession(windowId: string, sessionId: string) {
    if (!this.windows.has(windowId)) this.windows.set(windowId, new Set());
    this.windows.get(windowId)!.add(sessionId);
  }

  private isSessionTracked(session: PtySession) {
    return this.windows.get(session.windowId)?.has(session.id) ?? false;
  }

  private cancelPendingClose(sessionId: string) {
    const pending = this.pendingCloses.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingCloses.delete(sessionId);
  }

  /** Kill all sessions for cleanup */
  destroyAll() {
    for (const sessionId of this.pendingCloses.keys()) this.cancelPendingClose(sessionId);
    for (const [, session] of this.sessions) {
      this.terminatePty(session.pty);
    }
    this.sessions.clear();
    this.windows.clear();
  }

}

export const terminalService = new TerminalService();
