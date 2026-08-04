import { BrowserWindow, ipcMain } from 'electron';
import os from 'os';
import net, { type Server, type Socket } from 'net';
import https from 'https';
import crypto from 'crypto';
import type { Duplex } from 'stream';
import { spawn as spawnPty, type IPty } from '@lydell/node-pty';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import {
  SHELL_IPC,
  LOCAL_OPERATOR_ASSET_ID,
  isLoopbackShellPeer,
  type ReverseListenerProfile,
  type ShellChangedEvent,
  type ShellCommandAudit,
  type ShellConnectCommandRequest,
  type ShellCommandRequest,
  type ShellCommandResult,
  type ShellListenerRuntime,
  type ShellNetworkInterface,
  type ShellOutputEvent,
  type ShellProfile,
  type ShellSession,
} from '../contracts/shell';
import { sessionService } from './session.service';
import { terminatePtyProcessTree } from './terminal.service';
import { shellVault } from './shell-vault';
import { ShellAuditRepository } from './shell-audit.repository';
import { buildShellConnectCommand, listShellConnectTemplates } from './shell-connect-builder';
import {
  assertSessionTransition,
  assertShellId,
  createShellId,
  isWildcardAddress,
  normalizeCommandTimeout,
  normalizeListener,
  normalizeReadLimits,
  normalizeShellProfile,
} from './shell-contract';

const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_LINES = 10_000;
const QUARANTINE_PREVIEW_BYTES = 32 * 1024;
const MAX_LISTENER_SESSIONS = 32;

interface ActiveCommand {
  id: string;
  nonce?: string;
  marker?: RegExp;
  output: string;
  pendingDisplay: string;
  startedAt: string;
  command: string;
  timeout: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  resolve: (result: ShellCommandResult) => void;
  approvalMode: ShellCommandAudit['approvalMode'];
}

interface InternalSession {
  value: ShellSession;
  transcript: string;
  pty?: IPty;
  socket?: Socket;
  sshClient?: Client;
  jumpClient?: Client;
  sshChannel?: ClientChannel;
  activeCommand?: ActiveCommand;
  previewBytes: number;
}

interface InternalListener {
  projectId: string;
  profile: ReverseListenerProfile;
  server: Server;
  state: ShellListenerRuntime['state'];
  error?: string;
}

export class ShellService {
  private readonly sessions = new Map<string, InternalSession>();
  private readonly listeners = new Map<string, InternalListener>();

  constructor(registerHandlers = true) {
    if (registerHandlers) this.registerHandlers();
  }

  private registerHandlers() {
    ipcMain.handle(SHELL_IPC.PROFILE_LIST, (_event, projectId: string) => this.listProfiles(projectId));
    ipcMain.handle(SHELL_IPC.PROFILE_SAVE, (_event, projectId: string, input: Partial<ShellProfile>) => (
      this.saveProfile(projectId, input)
    ));
    ipcMain.handle(SHELL_IPC.PROFILE_DELETE, (_event, projectId: string, profileId: string) => (
      this.deleteProfile(projectId, profileId)
    ));
    ipcMain.handle(SHELL_IPC.CREDENTIAL_SAVE, (_event, projectId: string, input, credentialId?: string) => (
      shellVault.save(projectId, input, credentialId)
    ));
    ipcMain.handle(SHELL_IPC.CREDENTIAL_DELETE, (_event, projectId: string, credentialId: string) => (
      shellVault.delete(projectId, credentialId)
    ));
    ipcMain.handle(SHELL_IPC.CREDENTIAL_STATUS, (_event, projectId: string) => shellVault.list(projectId));
    ipcMain.handle(SHELL_IPC.INTERFACES, () => this.listNetworkInterfaces());
    ipcMain.handle(SHELL_IPC.LISTENER_SAVE, (_event, projectId: string, input: Partial<ReverseListenerProfile>) => (
      this.saveListener(projectId, input)
    ));
    ipcMain.handle(SHELL_IPC.LISTENER_LIST, (_event, projectId: string) => this.listListeners(projectId));
    ipcMain.handle(SHELL_IPC.LISTENER_DELETE, (_event, projectId: string, listenerId: string) => (
      this.deleteListener(projectId, listenerId)
    ));
    ipcMain.handle(SHELL_IPC.LISTENER_START, (_event, projectId: string, listenerId: string) => (
      this.startListener(projectId, listenerId)
    ));
    ipcMain.handle(SHELL_IPC.LISTENER_STOP, (_event, projectId: string, listenerId: string) => (
      this.stopListener(projectId, listenerId)
    ));
    ipcMain.handle(SHELL_IPC.CONNECT_TEMPLATE_LIST, () => this.listConnectTemplates());
    ipcMain.handle(SHELL_IPC.CONNECT_COMMAND_BUILD, (_event, input: ShellConnectCommandRequest) => (
      this.buildConnectCommand(input)
    ));
    ipcMain.handle(SHELL_IPC.PUBLIC_IP_DETECT, () => this.detectPublicIp());
    ipcMain.handle(SHELL_IPC.SESSION_CONNECT, (event, projectId: string, profileId: string, ownerTabId?: string) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) throw new Error('Unable to resolve renderer window');
      return this.connect(projectId, profileId, owner.id, ownerTabId);
    });
    ipcMain.handle(SHELL_IPC.SESSION_ATTACH, (event, projectId: string, sessionId: string, ownerTabId: string) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) throw new Error('Unable to resolve renderer window');
      return this.attach(projectId, sessionId, owner.id, ownerTabId);
    });
    ipcMain.handle(SHELL_IPC.SESSION_LIST, (_event, projectId: string) => this.listSessions(projectId));
    ipcMain.handle(SHELL_IPC.SESSION_READ, (_event, projectId: string, sessionId: string, lines?: number, bytes?: number) => (
      this.readTranscript(projectId, sessionId, lines, bytes)
    ));
    ipcMain.handle(SHELL_IPC.SESSION_WRITE, (_event, projectId: string, sessionId: string, data: string) => (
      this.write(projectId, sessionId, data)
    ));
    ipcMain.handle(SHELL_IPC.SESSION_RESIZE, (_event, projectId: string, sessionId: string, cols: number, rows: number) => (
      this.resize(projectId, sessionId, cols, rows)
    ));
    ipcMain.handle(SHELL_IPC.SESSION_INTERRUPT, (_event, projectId: string, sessionId: string) => (
      this.interrupt(projectId, sessionId)
    ));
    ipcMain.handle(SHELL_IPC.SESSION_TAKEOVER, (_event, projectId: string, sessionId: string) => (
      this.takeover(projectId, sessionId)
    ));
    ipcMain.handle(SHELL_IPC.SESSION_DISCONNECT, (_event, projectId: string, sessionId: string) => (
      this.disconnect(projectId, sessionId)
    ));
    ipcMain.handle(SHELL_IPC.REVERSE_BIND, (_event, projectId: string, sessionId: string, assetId: string) => (
      this.bindReverseSession(projectId, sessionId, assetId)
    ));
    ipcMain.handle(SHELL_IPC.REVERSE_REJECT, (_event, projectId: string, sessionId: string) => (
      this.disconnect(projectId, sessionId)
    ));
    ipcMain.handle(SHELL_IPC.AUDIT_LIST, (_event, projectId: string, query?: string, limit?: number) => (
      this.auditRepository(projectId).list(query, limit)
    ));
    ipcMain.handle(SHELL_IPC.AUDIT_READ, (_event, projectId: string, auditId: string) => (
      this.auditRepository(projectId).read(auditId)
    ));
    ipcMain.handle(SHELL_IPC.AUDIT_DELETE, (_event, projectId: string, auditId: string) => (
      this.auditRepository(projectId).delete(auditId)
    ));
    ipcMain.handle(SHELL_IPC.SAVE_EVIDENCE, (_event, projectId: string, auditId: string) => (
      this.saveEvidence(projectId, auditId)
    ));
  }

  listProfiles(projectId: string) {
    return sessionService.getProjectState(projectId).shells.profiles;
  }

  listCredentialStatuses(projectId: string) {
    sessionService.getSessionPath(projectId);
    return shellVault.list(projectId);
  }

  saveProfile(projectId: string, input: Partial<ShellProfile>) {
    const state = sessionService.getProjectState(projectId);
    const existing = typeof input.id === 'string'
      ? state.shells.profiles.find((profile) => profile.id === input.id)
      : undefined;
    const now = new Date().toISOString();
    const candidate = {
      ...existing,
      ...input,
      id: existing?.id ?? createShellId('profile'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const normalized = normalizeShellProfile(candidate)[0];
    if (!normalized) throw new Error('Invalid shell profile');
    if (normalized.jumpProfileId === normalized.id) throw new Error('SSH profile cannot jump through itself');
    if (normalized.jumpProfileId) {
      const jump = state.shells.profiles.find((profile) => profile.id === normalized.jumpProfileId);
      if (!jump || jump.kind !== 'ssh' || jump.jumpProfileId) throw new Error('Jump profile must be a direct SSH profile');
    }
    sessionService.updateProjectState(projectId, {
      shells: {
        profiles: [...state.shells.profiles.filter((profile) => profile.id !== normalized.id), normalized],
        listeners: state.shells.listeners,
      },
    });
    this.emitChanged({ projectId, profiles: true });
    return normalized;
  }

  deleteProfile(projectId: string, profileId: string) {
    assertShellId(profileId, 'profile identifier');
    if ([...this.sessions.values()].some((session) => session.value.projectId === projectId && session.value.profileId === profileId && isLive(session.value.state))) {
      throw new Error('Disconnect active sessions before deleting this profile');
    }
    const state = sessionService.getProjectState(projectId);
    if (state.shells.profiles.some((profile) => profile.jumpProfileId === profileId)) {
      throw new Error('Profile is used as an SSH jump host');
    }
    const profiles = state.shells.profiles.filter((profile) => profile.id !== profileId);
    if (profiles.length === state.shells.profiles.length) return false;
    sessionService.updateProjectState(projectId, { shells: { profiles, listeners: state.shells.listeners } });
    this.emitChanged({ projectId, profiles: true });
    return true;
  }

  saveListener(projectId: string, input: Partial<ReverseListenerProfile>) {
    const state = sessionService.getProjectState(projectId);
    const existing = typeof input.id === 'string'
      ? state.shells.listeners.find((listener) => listener.id === input.id)
      : undefined;
    const now = new Date().toISOString();
    const normalized = normalizeListener({
      ...existing,
      ...input,
      id: existing?.id ?? createShellId('listener'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })[0];
    if (!normalized) throw new Error('Invalid reverse listener profile');
    if (existing && this.listeners.has(existing.id)) throw new Error('Stop the listener before editing it');
    sessionService.updateProjectState(projectId, {
      shells: {
        profiles: state.shells.profiles,
        listeners: [...state.shells.listeners.filter((listener) => listener.id !== normalized.id), normalized],
      },
    });
    this.emitChanged({ projectId, listenerId: normalized.id, profiles: true });
    return normalized;
  }

  deleteListener(projectId: string, listenerId: string) {
    assertShellId(listenerId, 'listener identifier');
    if (this.listeners.has(listenerId)) throw new Error('Stop the listener before deleting it');
    const state = sessionService.getProjectState(projectId);
    const listeners = state.shells.listeners.filter((listener) => listener.id !== listenerId);
    if (listeners.length === state.shells.listeners.length) return false;
    sessionService.updateProjectState(projectId, { shells: { profiles: state.shells.profiles, listeners } });
    this.emitChanged({ projectId, listenerId, profiles: true });
    return true;
  }

  listNetworkInterfaces(): ShellNetworkInterface[] {
    return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => (
      (entries ?? []).flatMap((entry) => (entry.family === 'IPv4' || entry.family === 'IPv6') ? [{
        name,
        address: entry.address,
        family: entry.family,
        internal: entry.internal,
      }] : [])
    ));
  }

  listConnectTemplates() {
    return listShellConnectTemplates();
  }

  async detectPublicIp(): Promise<string | null> {
    const urls = [
      'https://api.ipify.org',
      'https://ifconfig.me/ip',
      'https://icanhazip.com',
    ];
    for (const url of urls) {
      try {
        const ip = await fetchPublicIp(url);
        if (ip && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip.trim())) return ip.trim();
      } catch { /* try next */ }
    }
    return null;
  }

  buildConnectCommand(input: ShellConnectCommandRequest) {
    const result = buildShellConnectCommand(input);
    const listener = sessionService.getProjectState(input.projectId).shells.listeners.find(
      (candidate) => candidate.id === result.listenerId,
    );
    if (!listener) throw new Error('Reverse listener profile not found');
    if (listener.port !== result.callbackPort) {
      throw new Error('Reverse listener port changed; reopen Payload Generator');
    }
    // The callback address may differ from the listener bind address (e.g. public IP
    // behind NAT), but the listener's bind address must still be available.
    if (!this.listNetworkInterfaces().some((networkInterface) => (
      networkInterface.family === 'IPv4' && networkInterface.address === listener.bindAddress
    ))) {
      throw new Error('Listener bind interface is not currently available');
    }
    return result;
  }

  listListeners(projectId: string): ShellListenerRuntime[] {
    const profiles = sessionService.getProjectState(projectId).shells.listeners;
    return profiles.map((profile) => {
      const runtime = this.listeners.get(profile.id);
      return {
        profile,
        state: runtime?.state ?? 'stopped',
        sessionCount: [...this.sessions.values()].filter((session) => session.value.listenerId === profile.id && isLive(session.value.state)).length,
        error: runtime?.error,
      };
    });
  }

  async startListener(projectId: string, listenerId: string) {
    const profile = sessionService.getProjectState(projectId).shells.listeners.find((item) => item.id === listenerId);
    if (!profile) throw new Error('Reverse listener profile not found');
    if (this.listeners.has(listenerId)) return this.listListeners(projectId).find((item) => item.profile.id === listenerId)!;
    if (isWildcardAddress(profile.bindAddress)) throw new Error('Wildcard listener addresses are not allowed');
    if (!this.listNetworkInterfaces().some((item) => item.address === profile.bindAddress)) {
      throw new Error('Selected network interface is not currently available');
    }
    const server = net.createServer((socket) => this.acceptReverseConnection(projectId, profile, socket));
    const runtime: InternalListener = { projectId, profile, server, state: 'starting' };
    this.listeners.set(listenerId, runtime);
    server.on('error', (error) => {
      runtime.state = 'error';
      runtime.error = error.message;
      this.emitChanged({ projectId, listenerId });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        this.listeners.delete(listenerId);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(profile.port, profile.bindAddress);
    });
    runtime.state = 'listening';
    this.emitChanged({ projectId, listenerId });
    return this.listListeners(projectId).find((item) => item.profile.id === listenerId)!;
  }

  async stopListener(projectId: string, listenerId: string) {
    const listener = this.listeners.get(listenerId);
    if (!listener) return false;
    if (listener.projectId !== projectId) throw new Error('Listener belongs to another project');
    this.listeners.delete(listenerId);
    listener.server.close();
    this.emitChanged({ projectId, listenerId });
    return true;
  }

  async connect(projectId: string, profileId: string, ownerWindowId?: number, ownerTabId?: string) {
    const profile = this.listProfiles(projectId).find((item) => item.id === profileId);
    if (!profile) throw new Error('Shell profile not found');
    const existing = [...this.sessions.values()].find((item) => (
      item.value.projectId === projectId
      && item.value.profileId === profileId
      && (!ownerTabId || item.value.ownerTabId === ownerTabId)
      && isLive(item.value.state)
    ));
    if (existing) return this.publicSession(existing);
    const internal = this.createInternalSession(projectId, profile, ownerWindowId, ownerTabId);
    this.sessions.set(internal.value.id, internal);
    this.emitChanged({ projectId, sessionId: internal.value.id });
    try {
      if (profile.kind === 'ssh') await this.connectSsh(internal, profile);
      else this.connectPty(internal, profile);
      return this.publicSession(internal);
    } catch (error) {
      this.fail(internal, error);
      throw error;
    }
  }

  attach(projectId: string, sessionId: string, ownerWindowId: number, ownerTabId: string) {
    const session = this.requireSession(projectId, sessionId);
    session.value.ownerWindowId = ownerWindowId;
    session.value.ownerTabId = ownerTabId;
    session.value.revision += 1;
    this.emitChanged({ projectId, sessionId });
    return this.publicSession(session);
  }

  listSessions(projectId: string) {
    sessionService.getSessionPath(projectId);
    return [...this.sessions.values()]
      .filter((item) => item.value.projectId === projectId && item.value.state !== 'closed')
      .map((item) => this.publicSession(item));
  }

  readTranscript(projectId: string, sessionId: string, lines?: number, bytes?: number) {
    const session = this.requireSession(projectId, sessionId);
    const limits = normalizeReadLimits(lines, bytes);
    let selected = session.transcript.split(/(?<=\n)/).slice(-limits.lines).join('');
    while (Buffer.byteLength(selected, 'utf8') > limits.bytes) selected = selected.slice(Math.ceil(selected.length / 8));
    return { session: this.publicSession(session), content: selected, truncated: selected.length < session.transcript.length };
  }

  write(projectId: string, sessionId: string, data: string) {
    const session = this.requireSession(projectId, sessionId);
    if (session.value.state === 'quarantined') throw new Error('Reverse shell must be bound to an in-scope asset first');
    if (session.value.state === 'agent_locked') throw new Error('Agent owns the session input; take over before typing');
    if (session.value.state !== 'ready') throw new Error('Shell session is not ready');
    if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 1024 * 1024) throw new Error('Invalid shell input');
    this.writeTransport(session, data);
    return true;
  }

  sendAgentInput(projectId: string, sessionId: string, data: string) {
    const session = this.requireSession(projectId, sessionId);
    if (session.value.state !== 'agent_locked' || !session.activeCommand) {
      throw new Error('No Agent command is awaiting interactive input');
    }
    if (typeof data !== 'string' || !data || Buffer.byteLength(data, 'utf8') > 64 * 1024) {
      throw new Error('Invalid interactive shell input');
    }
    this.writeTransport(session, data);
    return true;
  }

  resize(projectId: string, sessionId: string, cols: number, rows: number) {
    const session = this.requireSession(projectId, sessionId);
    const safeCols = Math.max(2, Math.min(1_000, Math.round(cols)));
    const safeRows = Math.max(1, Math.min(1_000, Math.round(rows)));
    if (session.pty) session.pty.resize(safeCols, safeRows);
    if (session.sshChannel) session.sshChannel.setWindow(safeRows, safeCols, 0, 0);
    return true;
  }

  interrupt(projectId: string, sessionId: string) {
    const session = this.requireSession(projectId, sessionId);
    if (session.value.state !== 'ready' && session.value.state !== 'agent_locked') return false;
    this.writeTransport(session, '\x03');
    if (session.activeCommand) this.completeCommand(session, 'interrupted');
    return true;
  }

  takeover(projectId: string, sessionId: string) {
    const session = this.requireSession(projectId, sessionId);
    if (!session.activeCommand) return this.publicSession(session);
    this.writeTransport(session, '\x03');
    this.completeCommand(session, 'interrupted');
    return this.publicSession(session);
  }

  disconnect(projectId: string, sessionId: string) {
    const session = this.requireSession(projectId, sessionId);
    if (session.activeCommand) this.completeCommand(session, 'disconnected');
    this.closeTransport(session);
    if (session.value.state !== 'closed') this.transition(session, 'closed');
    this.sessions.delete(sessionId);
    this.emitChanged({ projectId, sessionId });
    return true;
  }

  bindReverseSession(projectId: string, sessionId: string, assetId: string) {
    const session = this.requireSession(projectId, sessionId);
    if (session.value.kind !== 'reverse_tcp' || session.value.state !== 'quarantined') {
      throw new Error('Session is not a quarantined reverse shell');
    }
    this.assertSessionAsset(projectId, session, assetId);
    session.value.assetId = assetId;
    session.value.capabilities.agentExecute = true;
    this.transition(session, 'ready');
    if (session.value.preview) {
      this.appendTranscript(session, session.value.preview);
      this.emitOutput(session, session.value.preview);
      session.value.preview = undefined;
    }
    this.emitChanged({ projectId, sessionId });
    return this.publicSession(session);
  }

  async executeCommand(
    request: ShellCommandRequest,
    approvalMode: ShellCommandAudit['approvalMode'],
  ): Promise<ShellCommandResult> {
    const session = this.requireSession(request.projectId, request.sessionId);
    if (session.value.state !== 'ready') throw new Error('Shell session is not ready');
    if (!session.value.capabilities.agentExecute) throw new Error('Agent execution is unavailable for this session');
    if (!request.command.trim()) throw new Error('Shell command is required');
    if (Buffer.byteLength(request.command, 'utf8') > 64 * 1024) throw new Error('Shell command exceeds 64 KiB');
    const assetId = request.targetAssetId ?? session.value.assetId;
    if (session.value.kind !== 'local' && session.value.kind !== 'wsl') {
      if (!assetId) throw new Error('Shell session is not bound to a target asset');
      this.assertSessionAsset(request.projectId, session, assetId);
    } else if (assetId) {
      this.assertSessionAsset(request.projectId, session, assetId);
    }
    const timeoutMs = normalizeCommandTimeout(request.timeoutMs);
    const commandId = createShellId('audit');
    const nonce = session.value.shellFlavor === 'raw' ? undefined : cryptoNonce();
    return new Promise<ShellCommandResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.writeTransport(session, '\x03');
        this.completeCommand(session, 'timeout');
      }, timeoutMs);
      timeout.unref?.();
      const active: ActiveCommand = {
        id: commandId,
        nonce,
        marker: nonce ? new RegExp(`__HEXESTRA_${nonce}__:(-?\\d+)`) : undefined,
        output: '',
        pendingDisplay: '',
        startedAt: new Date().toISOString(),
        command: request.command,
        timeout,
        resolve,
        approvalMode,
      };
      session.activeCommand = active;
      session.value.agentLease = {
        id: createShellId('lease'),
        commandId,
        revision: session.value.revision + 1,
        startedAt: active.startedAt,
        timeoutMs,
      };
      this.transition(session, 'agent_locked');
      this.emitChanged({ projectId: request.projectId, sessionId: request.sessionId });
      this.writeTransport(session, wrapCommand(request.command, session.value.shellFlavor, nonce));
      if (!nonce) this.scheduleRawCompletion(session);
    });
  }

  listAudits(projectId: string, query?: string, limit?: number) {
    return this.auditRepository(projectId).list(query, limit);
  }

  readAudit(projectId: string, auditId: string) {
    return this.auditRepository(projectId).read(auditId);
  }

  saveEvidence(projectId: string, auditId: string) {
    const audit = this.auditRepository(projectId).read(auditId);
    if (!audit.assetId) throw new Error('Shell audit is not linked to an asset');
    return sessionService.upsertEvidence(projectId, {
      assetId: audit.assetId,
      title: `Shell command: ${audit.command.slice(0, 80)}`,
      tool: 'hexestra-shell',
      kind: 'shell-transcript',
      content: [
        `Session: ${audit.sessionId}`,
        `Command ID: ${audit.id}`,
        `Started: ${audit.startedAt}`,
        `Completed: ${audit.completedAt}`,
        `Outcome: ${audit.outcome}`,
        audit.exitCode === undefined ? '' : `Exit code: ${audit.exitCode}`,
        '',
        '$ ' + audit.command,
        audit.output,
      ].filter((line) => line !== '').join('\n'),
    });
  }

  destroyProject(projectId: string) {
    for (const listener of [...this.listeners.values()]) {
      if (listener.projectId === projectId) void this.stopListener(projectId, listener.profile.id);
    }
    for (const session of [...this.sessions.values()]) {
      if (session.value.projectId === projectId) this.disconnect(projectId, session.value.id);
    }
  }

  destroyAll() {
    for (const listener of this.listeners.values()) listener.server.close();
    this.listeners.clear();
    for (const session of [...this.sessions.values()]) this.disconnect(session.value.projectId, session.value.id);
  }

  private createInternalSession(projectId: string, profile: ShellProfile, ownerWindowId?: number, ownerTabId?: string): InternalSession {
    const now = new Date().toISOString();
    return {
      value: {
        id: createShellId('shell'),
        projectId,
        profileId: profile.id,
        kind: profile.kind,
        title: profile.name,
        state: 'connecting',
        revision: 0,
        assetId: profile.assetRole === 'target' ? profile.assetId : undefined,
        shellFlavor: profile.shellFlavor,
        capabilities: {
          resize: true,
          interrupt: true,
          exitCode: profile.shellFlavor !== 'auto' && profile.shellFlavor !== 'raw',
          agentExecute: profile.assetRole === 'target' || profile.kind !== 'ssh',
        },
        ownerWindowId,
        ownerTabId,
        createdAt: now,
        lastActivityAt: now,
      },
      transcript: '',
      previewBytes: 0,
    };
  }

  private connectPty(session: InternalSession, profile: ShellProfile) {
    const cwd = sessionService.getSessionPath(session.value.projectId);
    const { executable, args } = ptyCommand(profile);
    const pty = spawnPty(executable, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        ELECTRON_RUN_AS_NODE: undefined,
      },
      useConptyDll: false,
    });
    session.pty = pty;
    pty.onData((data) => this.handleData(session, data));
    pty.onExit(() => this.handleDisconnect(session));
    this.transition(session, 'ready');
    this.emitChanged({ projectId: session.value.projectId, sessionId: session.value.id });
  }

  private async connectSsh(session: InternalSession, profile: ShellProfile) {
    const configuredJump = profile.jumpProfileId
      ? this.listProfiles(session.value.projectId).find((item) => item.id === profile.jumpProfileId)
      : undefined;
    this.transition(session, !profile.hostKeyFingerprint || (configuredJump && !configuredJump.hostKeyFingerprint)
      ? 'host_key_pending'
      : 'authenticating');
    let socket: Duplex | undefined;
    if (profile.jumpProfileId) {
      const jump = configuredJump;
      if (!jump || jump.kind !== 'ssh') throw new Error('SSH jump profile not found');
      const jumpClient = await this.openSshClient(session.value.projectId, jump);
      session.jumpClient = jumpClient;
      socket = await new Promise<ClientChannel>((resolve, reject) => {
        jumpClient.forwardOut('127.0.0.1', 0, profile.host!, profile.port!, (error, channel) => (
          error ? reject(error) : resolve(channel)
        ));
      });
    }
    const client = await this.openSshClient(session.value.projectId, profile, socket);
    session.sshClient = client;
    client.on('error', (error) => this.fail(session, error));
    session.jumpClient?.on('error', (error) => this.fail(session, error));
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols: 120, rows: 40 }, (error, stream) => (
        error ? reject(error) : resolve(stream)
      ));
    });
    session.sshChannel = channel;
    channel.on('data', (data: Buffer) => this.handleData(session, data.toString('utf8')));
    channel.stderr.on('data', (data: Buffer) => this.handleData(session, data.toString('utf8')));
    channel.on('close', () => this.handleDisconnect(session));
    this.transition(session, 'ready');
    this.emitChanged({ projectId: session.value.projectId, sessionId: session.value.id });
  }

  private async openSshClient(projectId: string, profile: ShellProfile, sock?: Duplex) {
    let observedFingerprint: string | undefined;
    const credential = profile.credentialId ? await shellVault.readSecret(projectId, profile.credentialId) : undefined;
    if (!credential) throw new Error('SSH credential is missing');
    const config: ConnectConfig = {
      host: sock ? undefined : profile.host,
      port: sock ? undefined : profile.port,
      sock,
      username: profile.username,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => {
        observedFingerprint = `SHA256:${crypto.createHash('sha256').update(key).digest('base64')}`;
        return profile.hostKeyFingerprint === observedFingerprint;
      },
      ...(profile.authMethod === 'private_key' ? {
        privateKey: credential.secret,
        passphrase: credential.passphrase,
      } : {
        password: credential.secret,
        tryKeyboard: profile.authMethod === 'keyboard_interactive',
      }),
    };
    const client = new Client();
    if (profile.authMethod === 'keyboard_interactive') {
      client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
        finish(prompts.map(() => credential.secret));
      });
    }
    return new Promise<Client>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        client.end();
        if (observedFingerprint && !profile.hostKeyFingerprint) {
          reject(new Error(`SSH_HOST_KEY_CONFIRMATION_REQUIRED:${profile.id}:${observedFingerprint}`));
        } else if (observedFingerprint && profile.hostKeyFingerprint !== observedFingerprint) {
          reject(new Error(`SSH host key changed; expected ${profile.hostKeyFingerprint}, received ${observedFingerprint}`));
        } else {
          reject(error);
        }
      };
      client.once('ready', () => {
        if (settled) return;
        settled = true;
        resolve(client);
      });
      client.once('error', fail);
      client.connect(config);
    });
  }

  private acceptReverseConnection(projectId: string, profile: ReverseListenerProfile, socket: Socket) {
    const activeCount = [...this.sessions.values()].filter((item) => item.value.listenerId === profile.id && isLive(item.value.state)).length;
    if (activeCount >= MAX_LISTENER_SESSIONS) {
      socket.destroy();
      return;
    }
    const now = new Date().toISOString();
    const session: InternalSession = {
      value: {
        id: createShellId('shell'),
        projectId,
        listenerId: profile.id,
        kind: 'reverse_tcp',
        title: `Reverse ${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`,
        state: 'quarantined',
        revision: 0,
        peer: { address: socket.remoteAddress ?? 'unknown', port: socket.remotePort ?? 0 },
        shellFlavor: profile.shellFlavor,
        capabilities: { resize: false, interrupt: true, exitCode: false, agentExecute: false },
        createdAt: now,
        lastActivityAt: now,
      },
      transcript: '',
      socket,
      previewBytes: 0,
    };
    this.sessions.set(session.value.id, session);
    socket.on('data', (data) => this.handleData(session, data.toString('utf8')));
    socket.on('close', () => this.handleDisconnect(session));
    socket.on('error', (error) => this.fail(session, error));
    this.emitChanged({ projectId, listenerId: profile.id, sessionId: session.value.id });
  }

  private handleData(session: InternalSession, data: string) {
    session.value.lastActivityAt = new Date().toISOString();
    if (session.value.state === 'quarantined') {
      const remaining = QUARANTINE_PREVIEW_BYTES - session.previewBytes;
      if (remaining > 0) {
        const preview = Buffer.from(data, 'utf8').subarray(0, remaining).toString('utf8');
        session.value.preview = `${session.value.preview ?? ''}${preview}`;
        session.previewBytes += Buffer.byteLength(preview, 'utf8');
        session.value.revision += 1;
        this.emitChanged({ projectId: session.value.projectId, sessionId: session.value.id });
      }
      return;
    }
    const command = session.activeCommand;
    if (!command) {
      this.appendTranscript(session, data);
      this.emitOutput(session, data);
      return;
    }
    command.output += data;
    if (!command.marker) {
      this.appendTranscript(session, data);
      this.emitOutput(session, data);
      this.scheduleRawCompletion(session);
      return;
    }
    command.pendingDisplay += data;
    const match = command.pendingDisplay.match(command.marker);
    if (match && match.index !== undefined) {
      const before = command.pendingDisplay.slice(0, match.index).replace(/\r?\n?$/, '');
      const after = command.pendingDisplay.slice(match.index + match[0].length).replace(/^\r?\n/, '');
      const visible = before + after;
      if (visible) {
        this.appendTranscript(session, visible);
        this.emitOutput(session, visible);
      }
      command.pendingDisplay = '';
      command.output = command.output.replace(command.marker, '').replace(/\r?\n?$/, '');
      this.completeCommand(session, 'completed', Number(match[1]));
      return;
    }
    if (command.pendingDisplay.length > 256) {
      const visible = command.pendingDisplay.slice(0, -128);
      command.pendingDisplay = command.pendingDisplay.slice(-128);
      this.appendTranscript(session, visible);
      this.emitOutput(session, visible);
    }
  }

  private scheduleRawCompletion(session: InternalSession) {
    const command = session.activeCommand;
    if (!command || command.marker) return;
    if (command.idleTimer) clearTimeout(command.idleTimer);
    command.idleTimer = setTimeout(() => this.completeCommand(session, 'completed_unverified'), 1_000);
    command.idleTimer.unref?.();
  }

  private completeCommand(session: InternalSession, outcome: ShellCommandResult['outcome'], exitCode?: number) {
    const command = session.activeCommand;
    if (!command) return;
    clearTimeout(command.timeout);
    if (command.idleTimer) clearTimeout(command.idleTimer);
    if (command.pendingDisplay) {
      this.appendTranscript(session, command.pendingDisplay);
      this.emitOutput(session, command.pendingDisplay);
    }
    const completedAt = new Date().toISOString();
    const result: ShellCommandResult = {
      id: command.id,
      projectId: session.value.projectId,
      sessionId: session.value.id,
      command: command.command,
      startedAt: command.startedAt,
      completedAt,
      outcome,
      exitCode: Number.isInteger(exitCode) ? exitCode : undefined,
      output: stripInternalMarkers(command.output),
      truncated: false,
    };
    const audit: ShellCommandAudit = {
      ...result,
      assetId: session.value.assetId,
      profileId: session.value.profileId,
      actor: 'agent',
      approvalMode: command.approvalMode,
    };
    this.auditRepository(session.value.projectId).save(audit);
    session.activeCommand = undefined;
    session.value.agentLease = undefined;
    if (session.value.state === 'agent_locked') this.transition(session, 'ready');
    this.emitChanged({ projectId: session.value.projectId, sessionId: session.value.id });
    command.resolve(result);
  }

  private handleDisconnect(session: InternalSession) {
    if (session.activeCommand) this.completeCommand(session, 'disconnected');
    if (session.value.state !== 'failed' && session.value.state !== 'disconnected' && !isFinal(session.value.state)) {
      this.transition(session, 'disconnected');
      this.emitChanged({ projectId: session.value.projectId, sessionId: session.value.id });
    }
  }

  private fail(session: InternalSession, error: unknown) {
    session.value.error = errorMessage(error);
    if (session.activeCommand) this.completeCommand(session, 'unknown');
    if (session.value.state !== 'failed' && session.value.state !== 'disconnected' && !isFinal(session.value.state)) {
      this.transition(session, 'failed');
    }
    this.emitChanged({ projectId: session.value.projectId, sessionId: session.value.id });
  }

  private transition(session: InternalSession, state: ShellSession['state']) {
    if (session.value.state === state) return;
    assertSessionTransition(session.value.state, state);
    session.value.state = state;
    session.value.revision += 1;
    session.value.lastActivityAt = new Date().toISOString();
  }

  private writeTransport(session: InternalSession, data: string) {
    if (session.pty) session.pty.write(data);
    else if (session.sshChannel) session.sshChannel.write(data);
    else if (session.socket && !session.socket.destroyed) session.socket.write(data);
    else throw new Error('Shell transport is unavailable');
  }

  private closeTransport(session: InternalSession) {
    if (session.pty) terminatePtyProcessTree(session.pty);
    session.sshChannel?.close();
    session.sshClient?.end();
    session.jumpClient?.end();
    session.socket?.destroy();
    session.pty = undefined;
    session.sshChannel = undefined;
    session.sshClient = undefined;
    session.jumpClient = undefined;
    session.socket = undefined;
  }

  private appendTranscript(session: InternalSession, data: string) {
    session.transcript += data;
    const lines = session.transcript.split(/(?<=\n)/);
    if (lines.length > MAX_TRANSCRIPT_LINES) session.transcript = lines.slice(-MAX_TRANSCRIPT_LINES).join('');
    while (Buffer.byteLength(session.transcript, 'utf8') > MAX_TRANSCRIPT_BYTES) {
      session.transcript = session.transcript.slice(Math.ceil(session.transcript.length / 8));
    }
  }

  private emitOutput(session: InternalSession, data: string) {
    const windowId = session.value.ownerWindowId;
    if (!windowId) return;
    const window = BrowserWindow.fromId(windowId);
    if (!window || window.isDestroyed()) return;
    const payload: ShellOutputEvent = { projectId: session.value.projectId, sessionId: session.value.id, data };
    window.webContents.send(SHELL_IPC.OUTPUT, payload);
  }

  private emitChanged(payload: ShellChangedEvent) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(SHELL_IPC.CHANGED, payload);
    }
  }

  private requireSession(projectId: string, sessionId: string) {
    assertShellId(sessionId, 'session identifier');
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Shell session not found');
    if (session.value.projectId !== projectId) throw new Error('Shell session belongs to another project');
    return session;
  }

  private publicSession(session: InternalSession): ShellSession {
    return structuredClone(session.value);
  }

  private assertAgentTarget(projectId: string, assetId: string) {
    const target = sessionService.getTarget(projectId, assetId);
    const asset = sessionService.listAssets(projectId).find((item) => item.id === assetId);
    if (!target && !asset) throw new Error('Target asset not found');
    if ((target?.status ?? asset?.status) === 'out_of_scope') throw new Error('Target asset is outside project Scope');
  }

  private assertSessionAsset(projectId: string, session: InternalSession, assetId: string) {
    if (assetId === LOCAL_OPERATOR_ASSET_ID) {
      const localProcess = session.value.kind === 'local' || session.value.kind === 'wsl';
      const loopbackReverse = session.value.kind === 'reverse_tcp' && isLoopbackShellPeer(session.value.peer?.address);
      if (!localProcess && !loopbackReverse) throw new Error('Only a loopback reverse shell can bind to this Hexestra device');
      return;
    }
    this.assertAgentTarget(projectId, assetId);
  }

  private auditRepository(projectId: string) {
    return new ShellAuditRepository(sessionService.getSessionPath(projectId));
  }
}

function ptyCommand(profile: ShellProfile) {
  if (profile.kind === 'wsl') {
    if (process.platform !== 'win32') throw new Error('WSL shells are only supported on Windows');
    return {
      executable: 'wsl.exe',
      args: [...(profile.wslDistribution ? ['--distribution', profile.wslDistribution] : []), '--cd', '~'],
    };
  }
  if (profile.executable) return { executable: profile.executable, args: profile.args ?? [] };
  if (process.platform !== 'win32') return { executable: process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), args: [] };
  if (profile.shellFlavor === 'cmd') return { executable: process.env.COMSPEC || 'cmd.exe', args: [] };
  return { executable: 'powershell.exe', args: ['-NoLogo'] };
}

function wrapCommand(command: string, flavor: ShellSession['shellFlavor'], nonce?: string) {
  const normalized = command.replace(/\r?\n/g, ' ');
  if (!nonce || flavor === 'raw' || flavor === 'auto') return `${normalized}\r`;
  if (flavor === 'powershell') {
    return `& { ${normalized} }; $__hexestra_ec = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }; Write-Output \"__HEXESTRA_${nonce}__:$__hexestra_ec\"\r`;
  }
  if (flavor === 'cmd') return `${normalized} & echo __HEXESTRA_${nonce}__:%ERRORLEVEL%\r`;
  return `{ ${normalized}; }; __hexestra_ec=$?; printf '\\n__HEXESTRA_${nonce}__:%s\\n' \"$__hexestra_ec\"\n`;
}

function stripInternalMarkers(value: string) {
  return value.replace(/__HEXESTRA_[A-Fa-f0-9]+__:-?\d+\r?\n?/g, '');
}

function cryptoNonce() {
  return crypto.randomBytes(12).toString('hex');
}

function isFinal(state: ShellSession['state']) {
  return state === 'closed';
}

function isLive(state: ShellSession['state']) {
  return state === 'connecting' || state === 'host_key_pending' || state === 'authenticating'
    || state === 'quarantined' || state === 'ready' || state === 'agent_locked';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function fetchPublicIp(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 5_000 }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString('utf8'); });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject).on('timeout', function (this: { destroy: () => void }) { this.destroy(); reject(new Error('timeout')); });
  });
}

export const shellService = new ShellService();
