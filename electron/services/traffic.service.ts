import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import { X509Certificate } from 'crypto';
import fs from 'fs';
import {
  DEFAULT_PROXY_PROFILE,
  TRAFFIC_IPC,
  type InterceptDecision,
  type BurpCallRequest,
  type BurpConnectionStatus,
  type ProxyProfile,
  type TrafficChangedEvent,
  type TrafficClearResult,
  type TrafficDeleteResult,
  type TrafficFlow,
  type TrafficListQuery,
  type TrafficSummary,
  type TrafficProfileState,
  type TrafficReplayRequest,
  type TrafficReplayResult,
  type ReplaySessionPatch,
} from '../contracts/traffic';
import { LOCAL_ASSET_ID } from './asset-graph.repository';
import { browserService } from './browser.service';
import {
  applyInterceptDecision,
  assertTrafficFlowDeletable,
  partitionTrafficHistoryForClear,
  interruptTrafficFlow,
  assertTrafficId,
  normalizeProxyProfile,
  patchRequest,
  sameProxyRuntimeConfiguration,
} from './traffic-contract';
import { TrafficRepository } from './traffic.repository';
import { ReplaySessionRepository } from './replay-session.repository';
import { TrafficSidecar, type TrafficSidecarStatus } from './traffic-sidecar';
import { BurpProvider } from './burp-provider';
import { BurpMirrorClient } from './burp-mirror-client';
import { sessionService } from './session.service';
import { appSettingsService } from './app-settings.service';

interface ProjectTrafficRuntime {
  sidecar: TrafficSidecar;
  profile: ProxyProfile;
  state: TrafficProfileState['runtime'];
  status?: TrafficSidecarStatus;
  error?: string;
  burpProvider?: BurpProvider;
  burpStatus?: BurpConnectionStatus;
  mirrorClient?: BurpMirrorClient;
  mirrorCapabilities: string[];
  mirrorError?: string;
  mirrorDrain?: Promise<void>;
}

export class TrafficService {
  private readonly runtimes = new Map<string, ProjectTrafficRuntime>();
  private readonly repositories = new Map<string, TrafficRepository>();
  private readonly replayRepositories = new Map<string, ReplaySessionRepository>();
  private readonly startPromises = new Map<string, Promise<TrafficProfileState>>();

  constructor(private readonly createMirrorClient: () => BurpMirrorClient = () => new BurpMirrorClient()) {
    ipcMain.handle(TRAFFIC_IPC.GET_PROFILE, (_event, projectId: string) => this.getProfile(projectId));
    ipcMain.handle(TRAFFIC_IPC.UPDATE_PROFILE, (_event, projectId: string, value: unknown) => this.updateProfile(projectId, value));
    ipcMain.handle(TRAFFIC_IPC.LIST, (_event, projectId: string, query: TrafficListQuery) => this.list(projectId, query));
    ipcMain.handle(TRAFFIC_IPC.READ, (_event, projectId: string, flowId: string) => this.read(projectId, flowId));
    ipcMain.handle(TRAFFIC_IPC.DELETE, (_event, projectId: string, flowId: string) => this.delete(projectId, flowId));
    ipcMain.handle(TRAFFIC_IPC.CLEAR, (_event, projectId: string) => this.clear(projectId));
    ipcMain.handle(TRAFFIC_IPC.DECIDE, (_event, projectId: string, decision: InterceptDecision) => this.decide(projectId, decision));
    ipcMain.handle(TRAFFIC_IPC.REPLAY, (_event, projectId: string, request: unknown) => this.replay(projectId, request));
    ipcMain.handle(TRAFFIC_IPC.REPLAY_SESSION_OPEN, (_event, projectId: string, flowId: string) => this.openReplaySession(projectId, flowId));
    ipcMain.handle(TRAFFIC_IPC.REPLAY_SESSION_READ, (_event, projectId: string, sessionId: string) => this.readReplaySession(projectId, sessionId));
    ipcMain.handle(TRAFFIC_IPC.REPLAY_SESSION_UPDATE, (_event, projectId: string, sessionId: string, patch: ReplaySessionPatch) => this.updateReplaySession(projectId, sessionId, patch));
    ipcMain.handle(TRAFFIC_IPC.REPLAY_SESSION_CLEAR, (_event, projectId: string, sessionId: string) => this.clearReplaySession(projectId, sessionId));
    ipcMain.handle(TRAFFIC_IPC.SAVE_EVIDENCE, (event, projectId: string, flowId: string) => this.saveEvidence(projectId, flowId, event.sender));
    ipcMain.handle(TRAFFIC_IPC.START, (_event, projectId: string) => this.start(projectId));
    ipcMain.handle(TRAFFIC_IPC.STOP, (_event, projectId: string) => this.stop(projectId, true));
    ipcMain.handle(TRAFFIC_IPC.BURP_CONNECT, (_event, projectId: string) => this.connectBurp(projectId));
    ipcMain.handle(TRAFFIC_IPC.BURP_DISCONNECT, (_event, projectId: string) => this.disconnectBurp(projectId));
    ipcMain.handle(TRAFFIC_IPC.BURP_CALL, (_event, projectId: string, request: BurpCallRequest) => this.callBurp(projectId, request));
  }

  getProfile(projectId: string): TrafficProfileState {
    const profile = this.persistedProfile(projectId);
    const runtime = this.runtimes.get(projectId);
    const mirrorCounts = this.mirrorCounts(projectId);
    const mirrorEnabled = profile.burp.enabled;
    return {
      profile,
      runtime: runtime?.state ?? 'stopped',
      sidecarVersion: runtime?.status?.version,
      burpStatus: runtime?.burpStatus ?? {
        proxyReachable: false,
        mcpReachable: false,
        edition: 'unknown',
        tools: [],
      },
      mirrorStatus: {
        state: !mirrorEnabled
          ? 'disabled'
          : runtime?.burpStatus?.bridgeReachable
            ? 'ready'
            : 'offline',
        ...mirrorCounts,
        capabilities: runtime?.mirrorCapabilities ?? [],
        error: runtime?.mirrorError,
      },
      error: runtime?.error,
    };
  }

  async updateProfile(projectId: string, value: unknown) {
    sessionService.getSessionPath(projectId);
    const profile = normalizeProxyProfile(value);
    const runtime = this.runtimes.get(projectId);
    if (profile.enabled && runtime?.state === 'ready'
      && sameProxyRuntimeConfiguration(runtime.profile, profile)) {
      await runtime.sidecar.updateIntercept(profile.interceptRequests, profile.interceptResponses);
      const integrationChanged = JSON.stringify(runtime.profile.burp) !== JSON.stringify(profile.burp);
      runtime.profile = profile;
      sessionService.updateProjectState(projectId, { traffic: profile });
      // Saving or reconnecting a Burp integration is an explicit retry boundary.
      // Pending entries stay durable, while previously failed mirror entries are
      // moved back to pending only after the user has changed/reconnected it.
      if (integrationChanged) await this.configureBurpIntegration(projectId, runtime, true);
      this.emit({ projectId, profile: true });
      return this.getProfile(projectId);
    }
    sessionService.updateProjectState(projectId, { traffic: profile });
    if (profile.enabled) await this.restart(projectId, profile);
    else await this.stop(projectId, false);
    this.emit({ projectId, profile: true });
    return this.getProfile(projectId);
  }

  list(projectId: string, query: TrafficListQuery = {}) {
    return this.repository(projectId).list(query);
  }

  read(projectId: string, flowId: string) {
    const flow = this.repository(projectId).read(assertTrafficId(flowId));
    if (!flow) throw new Error(`Traffic flow ${flowId} was not found`);
    return flow;
  }

  async delete(projectId: string, flowId: string): Promise<TrafficDeleteResult> {
    const id = assertTrafficId(flowId);
    let flow = this.read(projectId, id);
    assertTrafficFlowDeletable(flow);
    const replayRepository = this.replayRepository(projectId);
    const paused = flow.state === 'request_paused' || flow.state === 'response_paused';
    if (paused) {
      await this.dropInterceptedFlow(projectId, flow);
      flow = this.read(projectId, id);
      if (!['completed', 'failed', 'dropped'].includes(flow.state)) {
        throw new Error('Intercepted Flow changed before it could be deleted');
      }
    }
    const clearedReplaySessionIds = replayRepository.clearSourceSessions([id]);
    replayRepository.removeFlowReference(id);
    const deleted = this.repository(projectId).delete(id);
    if (deleted) this.emit({ projectId, flowId: id });
    return { flowId: id, deleted, droppedIntercepted: paused, clearedReplaySessionIds };
  }

  async clear(projectId: string): Promise<TrafficClearResult> {
    const repository = this.repository(projectId);
    let summaries = this.readAllSummaries(repository);
    const replayRepository = this.replayRepository(projectId);
    const protectedSourceIds = new Set(replayRepository.retainedSourceFlowIds(summaries.map((flow) => flow.id)));
    const paused = summaries.filter((flow) =>
      (flow.state === 'request_paused' || flow.state === 'response_paused')
      && !protectedSourceIds.has(flow.id));
    await Promise.all(paused.map(async (summary) => this.dropInterceptedFlow(projectId, this.read(projectId, summary.id))));

    summaries = this.readAllSummaries(repository);
    const retainedRepeaterSourceIds = new Set(replayRepository.retainedSourceFlowIds(summaries.map((flow) => flow.id)));
    const { removable, active, protectedSources } = partitionTrafficHistoryForClear(summaries, retainedRepeaterSourceIds);
    const flowIds = removable.map((flow) => flow.id);
    replayRepository.removeFlowReferences(flowIds);
    let deleted = 0;
    for (const flowId of flowIds) {
      if (repository.delete(flowId)) deleted += 1;
    }
    if (deleted > 0) this.emit({ projectId });
    return {
      deleted,
      retainedActive: active.length,
      retainedRepeaterSources: protectedSources.length,
      droppedIntercepted: paused.length,
    };
  }

  private readAllSummaries(repository: TrafficRepository) {
    const summaries: TrafficSummary[] = [];
    let offset = 0;
    while (true) {
      const page = repository.list({ offset, limit: 200 });
      summaries.push(...page.items);
      offset += page.items.length;
      if (offset >= page.total || page.items.length === 0) break;
    }
    return summaries;
  }

  private async dropInterceptedFlow(projectId: string, flow: TrafficFlow) {
    if (flow.state !== 'request_paused' && flow.state !== 'response_paused') return flow;
    const runtime = this.runtimes.get(projectId);
    if (!runtime || runtime.state === 'blocked' || runtime.state === 'error') {
      return this.markFlowFailed(projectId, flow, 'Traffic proxy is not running; the intercepted Flow was interrupted');
    }
    if (runtime.state !== 'ready') {
      throw new Error('Traffic proxy is starting; wait for it to become ready before deleting an intercepted Flow');
    }
    await runtime.sidecar.decide({
      flowId: flow.id,
      expectedRevision: flow.revision,
      action: 'drop',
    });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const current = this.repository(projectId).read(flow.id);
      if (!current) throw new Error(`Traffic flow ${flow.id} disappeared while being dropped`);
      if (current.state === 'dropped') return current;
      if (current.state === 'completed' || current.state === 'failed') return current;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out while dropping intercepted Traffic flow ${flow.id}`);
  }

  private markFlowFailed(projectId: string, flow: TrafficFlow, error: string) {
    const interrupted = interruptTrafficFlow(flow, error);
    this.repository(projectId).upsert(interrupted);
    this.emit({ projectId, flowId: interrupted.id });
    return interrupted;
  }

  async decide(projectId: string, decision: InterceptDecision) {
    const runtime = this.requireReadyRuntime(projectId);
    const flow = this.read(projectId, decision.flowId);
    if (flow.revision !== decision.expectedRevision) {
      throw new Error('Traffic flow changed before this decision was applied');
    }
    const validated = applyInterceptDecision(flow, decision);
    const message = decision.action === 'forward'
      ? flow.state === 'request_paused'
        ? {
            method: validated.request.method,
            url: validated.request.url,
            headers: validated.request.headers,
            body: validated.request.body,
          }
        : validated.response ? {
            statusCode: validated.response.statusCode,
            reason: validated.response.reason,
            headers: validated.response.headers,
            body: validated.response.body,
          } : undefined
      : undefined;
    await runtime.sidecar.decide({ ...decision, message });
    return { accepted: true };
  }

  async replay(projectId: string, value: unknown): Promise<TrafficReplayResult> {
    const runtime = this.requireReadyRuntime(projectId);
    const request = normalizeReplayRequest(value);
    const flow = this.read(projectId, request.parentFlowId);
    if (flow.request.httpVersion === 'websocket') throw new Error('WebSocket flows cannot be replayed');
    const replayRequest = patchRequest(flow.request, request.message ?? {});
    const result = await runtime.sidecar.replay(flow.id, replayRequest);
    if (request.replaySessionId) {
      const session = this.requireReplaySession(projectId, request.replaySessionId);
      if (session.sourceFlowId !== flow.id) throw new Error('Replay session source does not match the request');
      this.replayRepository(projectId).update(session, flow.request, {
        draft: replayRequest,
        attemptFlowIds: [...session.attemptFlowIds, result.flowId],
        selectedAttemptFlowId: result.flowId,
      });
    }
    return { ...result, parentFlowId: flow.id };
  }

  openReplaySession(projectId: string, flowId: string) {
    const flow = this.read(projectId, flowId);
    return this.replayRepository(projectId).open(flow);
  }

  readReplaySession(projectId: string, sessionId: string) {
    return this.requireReplaySession(projectId, sessionId);
  }

  updateReplaySession(projectId: string, sessionId: string, patch: ReplaySessionPatch) {
    const current = this.requireReplaySession(projectId, sessionId);
    const source = this.read(projectId, current.sourceFlowId);
    const safePatch: ReplaySessionPatch = patch && typeof patch === 'object' && !Array.isArray(patch)
      ? {
          ...(patch.draft === undefined ? {} : { draft: patch.draft }),
          ...(patch.draftText === undefined ? {} : { draftText: patch.draftText }),
          ...(patch.selectedAttemptFlowId === undefined ? {} : { selectedAttemptFlowId: patch.selectedAttemptFlowId }),
        }
      : {};
    return this.replayRepository(projectId).update(current, source.request, safePatch);
  }

  clearReplaySession(projectId: string, sessionId: string) {
    this.requireReplaySession(projectId, sessionId);
    this.replayRepository(projectId).clear(sessionId);
    return true;
  }

  async saveEvidence(projectId: string, flowId: string, sender?: WebContents) {
    const flow = this.read(projectId, flowId);
    const host = safeHost(flow.request.url);
    const evidence = sessionService.upsertEvidence(projectId, {
      assetId: resolveTrafficAsset(projectId, host),
      title: `${flow.request.method} ${host}${safePath(flow.request.url)}`,
      tool: 'Hexestra Traffic',
      kind: 'http-flow',
      content: renderFlowEvidence(flow),
    });
    sender?.send('session:data-changed', { sessionId: projectId, evidence: true });
    return evidence;
  }

  async start(projectId: string) {
    const runtime = this.runtimes.get(projectId);
    if (runtime?.state === 'ready') return this.getProfile(projectId);
    const pending = this.startPromises.get(projectId);
    if (pending) return pending;

    const startPromise = this.startRuntime(projectId);
    this.startPromises.set(projectId, startPromise);
    try {
      return await startPromise;
    } finally {
      if (this.startPromises.get(projectId) === startPromise) this.startPromises.delete(projectId);
    }
  }

  private async startRuntime(projectId: string) {
    const profile = { ...this.persistedProfile(projectId), enabled: true };
    this.markIncompleteFlowsFailed(projectId, 'Previous Traffic proxy session ended before the Flow completed');
    sessionService.updateProjectState(projectId, { traffic: profile });
    await this.restart(projectId, profile);
    this.emit({ projectId, profile: true });
    return this.getProfile(projectId);
  }

  async stop(projectId: string, persistDisabled = false) {
    const runtime = this.runtimes.get(projectId);
    if (runtime) {
      this.runtimes.delete(projectId);
      await runtime.burpProvider?.close();
      await runtime.sidecar.stop();
      this.markIncompleteFlowsFailed(projectId, 'Traffic proxy stopped before the Flow completed');
    }
    await browserService.setProjectProxy(projectId, null);
    if (persistDisabled) sessionService.updateProjectState(projectId, { traffic: { enabled: false } });
    this.emit({ projectId, profile: true });
    return this.getProfile(projectId);
  }

  async connectBurp(projectId: string) {
    const profile = this.persistedProfile(projectId);
    const enabledProfile = normalizeProxyProfile({
      ...profile,
      burp: { ...profile.burp, enabled: true },
    });
    await this.createMirrorClient().health(enabledProfile.burp);
    return this.updateProfile(projectId, enabledProfile);
  }

  async disconnectBurp(projectId: string) {
    const profile = this.persistedProfile(projectId);
    return this.updateProfile(projectId, { ...profile, burp: { ...profile.burp, enabled: false } });
  }

  async callBurp(projectId: string, request: BurpCallRequest) {
    const runtime = this.requireReadyRuntime(projectId);
    if (!runtime.burpProvider) throw new Error('Burp MCP is not connected');
    const flow = request.flowId ? this.read(projectId, request.flowId) : undefined;
    return runtime.burpProvider.call(request, flow);
  }

  async close() {
    await Promise.all([...this.runtimes.keys()].map((projectId) => this.stop(projectId, false)));
    for (const repository of this.repositories.values()) repository.close();
    this.repositories.clear();
    this.replayRepositories.clear();
  }

  private async restart(projectId: string, profile: ProxyProfile) {
    const current = this.runtimes.get(projectId);
    if (current) {
      this.runtimes.delete(projectId);
      await current.burpProvider?.close();
      await current.sidecar.stop();
      this.markIncompleteFlowsFailed(projectId, 'Traffic proxy restarted before the Flow completed');
    }
    const runtime: ProjectTrafficRuntime = {
      sidecar: new TrafficSidecar(),
      profile,
      state: 'starting',
      mirrorCapabilities: [],
    };
    this.runtimes.set(projectId, runtime);
    this.emit({ projectId, profile: true });
    try {
      runtime.status = await runtime.sidecar.start({
        projectId,
        projectPath: sessionService.getSessionPath(projectId),
        userDataPath: app.getPath('userData'),
        mitmdumpPath: appSettingsService.get().mitmdumpPath,
        profile,
        onFlow: (flow) => this.ingest(projectId, flow),
        onExit: (error) => {
          runtime.state = 'error';
          runtime.error = error;
          this.markIncompleteFlowsFailed(projectId, error);
          this.emit({ projectId, profile: true });
        },
      });
      const fingerprint = await waitForCaFingerprint(runtime.status.caCertificatePath);
      await browserService.setProjectProxy(
        projectId,
        runtime.status.proxyPort,
        fingerprint,
        runtime.status.caCertificatePath,
      );
      runtime.state = 'ready';
      runtime.error = undefined;
      if (profile.burp.enabled) {
        await this.configureBurpIntegration(projectId, runtime, true);
      }
    } catch (error) {
      await runtime.burpProvider?.close();
      await runtime.sidecar.stop();
      runtime.state = 'error';
      runtime.error = errorMessage(error);
      throw error;
    } finally {
      this.emit({ projectId, profile: true });
    }
  }

  private async configureBurpIntegration(projectId: string, runtime: ProjectTrafficRuntime, retryFailed: boolean) {
    await runtime.burpProvider?.close().catch(() => undefined);
    runtime.burpProvider = undefined;
    runtime.mirrorClient = undefined;
    runtime.mirrorCapabilities = [];
    runtime.mirrorError = undefined;
    runtime.burpStatus = {
      proxyReachable: false,
      mcpReachable: false,
      bridgeReachable: false,
      bridgeCapabilities: [],
      edition: 'unknown',
      tools: [],
    };
    if (!runtime.profile.burp.enabled) return;

    const client = this.createMirrorClient();
    runtime.mirrorClient = client;
    try {
      const health = await client.health(runtime.profile.burp);
      runtime.mirrorCapabilities = health.capabilities;
      runtime.burpStatus.bridgeReachable = true;
      runtime.burpStatus.bridgeCapabilities = health.capabilities;
      this.prepareMirrorBackfill(projectId, retryFailed);
      this.scheduleMirrorDrain(projectId, runtime);
    } catch (error) {
      runtime.mirrorError = errorMessage(error);
      runtime.burpStatus.bridgeReachable = false;
    }

    const provider = new BurpProvider();
    runtime.burpProvider = provider;
    const mcp = await connectOptionalBurpMcp(provider, runtime.profile.burp.mcpUrl);
    runtime.burpStatus = {
      ...mcp,
      proxyReachable: false,
      bridgeReachable: runtime.burpStatus.bridgeReachable,
      bridgeCapabilities: runtime.mirrorCapabilities,
    };
  }

  private prepareMirrorBackfill(projectId: string, retryFailed: boolean) {
    const repository = this.repository(projectId);
    for (const summary of this.readAllSummaries(repository)) {
      if (summary.burpMirrorState !== 'pending' && !(retryFailed && summary.burpMirrorState === 'failed')) continue;
      if (summary.burpMirrorState !== 'failed') continue;
      const flow = repository.read(summary.id);
      if (!flow || flow.state !== 'completed' || !flow.response) continue;
      repository.upsert({
        ...flow,
        revision: flow.revision + 1,
        route: {
          ...flow.route,
          burpMode: 'mirror',
          burpMirrorState: 'pending',
          burpMirrorError: undefined,
        },
      });
      this.emit({ projectId, flowId: flow.id });
    }
  }

  private scheduleMirrorDrain(projectId: string, runtime: ProjectTrafficRuntime) {
    if (runtime.mirrorDrain || runtime.burpStatus?.bridgeReachable !== true || !runtime.mirrorClient) return;
    const drain = this.drainMirrors(projectId, runtime).finally(() => {
      if (runtime.mirrorDrain === drain) runtime.mirrorDrain = undefined;
    });
    runtime.mirrorDrain = drain;
  }

  private async drainMirrors(projectId: string, runtime: ProjectTrafficRuntime) {
    const repository = this.repository(projectId);
    while (this.runtimes.get(projectId) === runtime
      && runtime.profile.burp.enabled
      && runtime.burpStatus?.bridgeReachable
      && runtime.mirrorClient) {
      const next = this.readAllSummaries(repository)
        .filter((summary) => summary.state === 'completed' && summary.burpMirrorState === 'pending')
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt))[0];
      if (!next) return;
      const flow = repository.read(next.id);
      if (!flow) continue;
      try {
        await runtime.mirrorClient.mirror(projectId, flow, runtime.profile.burp);
        const current = repository.read(flow.id);
        if (!current || current.route.burpMirrorState !== 'pending') continue;
        repository.upsert({
          ...current,
          revision: current.revision + 1,
          route: {
            ...current.route,
            burpEnabled: true,
            burpRouted: false,
            burpMode: 'mirror',
            burpMirrorState: 'synced',
            burpMirrorError: undefined,
          },
        });
        this.emit({ projectId, flowId: flow.id, profile: true });
      } catch (error) {
        const message = errorMessage(error);
        const current = repository.read(flow.id);
        if (current?.route.burpMirrorState === 'pending') {
          repository.upsert({
            ...current,
            revision: current.revision + 1,
            route: {
              ...current.route,
              burpMirrorState: 'failed',
              burpMirrorError: message,
            },
          });
          this.emit({ projectId, flowId: flow.id, profile: true });
        }
        runtime.mirrorError = message;
        if (runtime.burpStatus) runtime.burpStatus.bridgeReachable = false;
        return;
      }
    }
  }

  private ingest(projectId: string, flow: TrafficFlow) {
    if (flow.projectId !== projectId) return;
    flow.scopeState = sessionService.valueIsInScope(projectId, flow.request.url) ? 'in_scope' : 'out_of_scope';
    const runtime = this.runtimes.get(projectId);
    if (runtime?.profile.burp.enabled) {
      flow.route = {
        ...flow.route,
        burpEnabled: true,
        burpRouted: false,
        burpMode: 'mirror',
        ...(flow.state === 'completed' && flow.response
          ? { burpMirrorState: 'pending' as const, burpMirrorError: undefined }
          : {}),
      };
    }
    this.repository(projectId).upsert(flow);
    this.emit({ projectId, flowId: flow.id });
    if (flow.route.burpMirrorState === 'pending' && runtime) this.scheduleMirrorDrain(projectId, runtime);
  }

  private repository(projectId: string) {
    const existing = this.repositories.get(projectId);
    if (existing) return existing;
    const repository = new TrafficRepository(sessionService.getSessionPath(projectId));
    this.repositories.set(projectId, repository);
    return repository;
  }

  private replayRepository(projectId: string) {
    let repository = this.replayRepositories.get(projectId);
    if (!repository) {
      repository = new ReplaySessionRepository(sessionService.getSessionPath(projectId), projectId);
      this.replayRepositories.set(projectId, repository);
    }
    return repository;
  }

  private requireReplaySession(projectId: string, sessionId: string) {
    const session = this.replayRepository(projectId).read(sessionId);
    if (!session) throw new Error(`Replay session ${sessionId} was not found`);
    return session;
  }

  private persistedProfile(projectId: string) {
    return normalizeProxyProfile(sessionService.getProjectState(projectId).traffic ?? DEFAULT_PROXY_PROFILE);
  }

  private mirrorCounts(projectId: string) {
    const counts = { pending: 0, synced: 0, failed: 0 };
    for (const summary of this.readAllSummaries(this.repository(projectId))) {
      if (summary.burpMirrorState) counts[summary.burpMirrorState] += 1;
    }
    return counts;
  }

  private requireReadyRuntime(projectId: string) {
    const runtime = this.runtimes.get(projectId);
    if (!runtime || runtime.state !== 'ready') throw new Error('Traffic proxy is not ready');
    return runtime;
  }

  private markIncompleteFlowsFailed(projectId: string, error: string) {
    const repository = this.repository(projectId);
    while (true) {
      const page = repository.list({ states: ['captured', 'request_paused', 'forwarding', 'response_paused'], offset: 0, limit: 200 });
      if (page.items.length === 0) break;
      for (const summary of page.items) {
        const flow = repository.read(summary.id);
        if (!flow || ['completed', 'dropped', 'failed'].includes(flow.state)) continue;
        this.markFlowFailed(projectId, flow, `Traffic proxy exited: ${error}`);
      }
      if (page.items.length >= page.total) break;
    }
  }

  private emit(payload: TrafficChangedEvent) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(TRAFFIC_IPC.CHANGED, payload);
    }
  }
}

type BurpMcpConnector = Pick<BurpProvider, 'connect' | 'close' | 'status'>;

export async function connectOptionalBurpMcp(
  provider: BurpMcpConnector,
  mcpUrl: string,
) {
  try {
    const status = await provider.connect(mcpUrl);
    status.proxyReachable = false;
    return status;
  } catch (error) {
    await provider.close().catch(() => undefined);
    return provider.status(false, errorMessage(error));
  }
}

async function waitForCaFingerprint(filePath: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return new X509Certificate(fs.readFileSync(filePath)).fingerprint256.replace(/:/g, '').toUpperCase();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Traffic proxy CA certificate was not generated');
}

function renderFlowEvidence(flow: TrafficFlow) {
  const response = flow.response;
  return [
    `Flow ID: ${flow.id}`,
    `Observed: ${flow.timing.startedAt}`,
    `Route: ${flow.route.burpRouted
      ? 'Hexestra -> Burp -> Target'
      : flow.route.burpMirrorState
        ? `Hexestra -> Target; Burp mirror ${flow.route.burpMirrorState}`
        : 'Hexestra -> Target'}`,
    '',
    `${flow.request.method} ${flow.request.url}`,
    ...flow.request.headers.map((header) => `${header.name}: ${header.value}`),
    '',
    flow.request.body.encoding === 'utf8' ? flow.request.body.data : `[base64 ${flow.request.body.byteLength} bytes]`,
    '',
    response ? `${response.statusCode} ${response.reason ?? ''}`.trim() : '<no response>',
    ...(response?.headers.map((header) => `${header.name}: ${header.value}`) ?? []),
    '',
    response?.body.encoding === 'utf8' ? response.body.data : response ? `[base64 ${response.body.byteLength} bytes]` : '',
  ].join('\n');
}

function resolveTrafficAsset(projectId: string, host: string) {
  const normalized = host.toLowerCase();
  const target = sessionService.listTargets(projectId).find((candidate) => (
    candidate.ip.toLowerCase() === normalized
    || candidate.hostname?.toLowerCase() === normalized
    || candidate.domains.some((domain) => domain.toLowerCase() === normalized)
  ));
  return target?.id ?? LOCAL_ASSET_ID;
}

function safeHost(value: string) {
  try { return new URL(value).hostname; } catch { return 'unknown'; }
}

function safePath(value: string) {
  try { return new URL(value).pathname; } catch { return ''; }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeReplayRequest(value: unknown): TrafficReplayRequest {
  if (typeof value === 'string') return { parentFlowId: assertTrafficId(value) };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid replay request');
  const candidate = value as Record<string, unknown>;
  const parentFlowId = assertTrafficId(candidate.parentFlowId, 'replay parent');
  const replaySessionId = candidate.replaySessionId === undefined
    ? undefined
    : typeof candidate.replaySessionId === 'string' ? candidate.replaySessionId : (() => { throw new Error('Invalid replay session identifier'); })();
  const message = candidate.message === undefined
    ? undefined
    : candidate.message && typeof candidate.message === 'object' && !Array.isArray(candidate.message)
      ? candidate.message as TrafficReplayRequest['message']
      : (() => { throw new Error('Invalid replay message patch'); })();
  return { parentFlowId, replaySessionId, message };
}

export const trafficService = new TrafficService();
