import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { promisify } from 'util';
import type { AgentActivity, AgentAdapter, AgentBackendCapabilities, AgentBackendStatus, AgentCommandDiscoveryInput, AgentConversationHandle, AgentConversationOpenInput, AgentInteractionHandler, AgentModelOption, AgentQueuedInput, AgentRunEvent, AgentRunInput } from '../../contracts/agent-runtime';
import { AgentBackendError } from '../../contracts/agent-runtime';
import { agentSettingsService } from '../agent-settings.service';
import { windowsPathToWsl } from '../wsl-agent-runtime';
import { CodexAppServer } from './codex-app-server';
import { CodexToolBridge } from './codex-tool-bridge';
import type { SubagentRun } from '../../agent-subagent-contract';
import type { AgentSkillDescriptor } from '../../agent-command-contract';

const execFileAsync = promisify(execFile);
const CONTEXT_VERSION = 'hexestra-codex-v1';
type RecordValue = Record<string, unknown>;
type RpcMessage = { id?: number; method?: string; params?: unknown };
type Runtime = { server: CodexAppServer; bridge: CodexToolBridge; threadId: string | null; cwd: string;
  fingerprint: string; settings: ReturnType<typeof agentSettingsService.getCodexSettings> };

export class CodexAgentAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly capabilities: AgentBackendCapabilities = { branching: 'session', subagents: true, attachments: ['text', 'image', 'pdf', 'file'],
    tools: true, interactiveQuestions: true, slashCommands: false, queuedInput: true, scheduledWakeups: true };
  private available = false;
  private authenticated: boolean | null = null;
  private lastError: string | null = null;
  private runtimes = new Map<string, Runtime>();
  private handles = new Map<string, CodexConversationHandle>();
  private activeTurnKeys = new Set<string>();
  private diagnosticServer: CodexAppServer | null = null;
  private diagnosticFingerprint: string | null = null;
  private modelCatalog = new WeakMap<CodexAppServer, AgentModelOption[]>();
  private readonly skillsChangedListeners = new Set<() => void>();

  onSkillsChanged(listener: () => void) {
    this.skillsChangedListeners.add(listener);
    return () => this.skillsChangedListeners.delete(listener);
  }

  async initialize() {
    const settings = agentSettingsService.getCodexSettings();
    try {
      const command = settings.executionMode === 'wsl' ? 'wsl.exe' : settings.codexExecutable;
      const args = settings.executionMode === 'wsl'
        ? ['--distribution', settings.wslDistribution, '--exec', settings.codexExecutable, '--version'] : ['--version'];
      const { stdout } = await execFileAsync(command, args, { timeout: 10_000, windowsHide: true });
      if (!/codex/i.test(stdout)) throw new Error('Codex executable returned an unexpected version');
      this.available = true;
      this.lastError = null;
      return true;
    } catch (error) {
      this.available = false;
      this.lastError = codexLaunchError(error, settings).message;
      return false;
    }
  }

  fingerprint() {
    const settings = agentSettingsService.getCodexSettings();
    return JSON.stringify([CONTEXT_VERSION, settings.executionMode, settings.wslDistribution, settings.codexExecutable]);
  }

  status(): AgentBackendStatus {
    const settings = agentSettingsService.getCodexSettings();
    return { available: this.available, authenticated: this.authenticated, model: settings.model,
      lastError: this.lastError, runtimeMode: settings.executionMode,
      runtimeLabel: settings.executionMode === 'wsl' ? `WSL · ${settings.wslDistribution}` : 'Native' };
  }

  async authStatus() {
    const server = await this.getDiagnosticServer();
    const result = await server.request<{ account?: { type?: string } | null }>('account/read', { refreshToken: false });
    this.authenticated = Boolean(result.account);
    return { authenticated: this.authenticated, method: result.account?.type ?? null };
  }

  async listModels(_input: AgentCommandDiscoveryInput): Promise<AgentModelOption[]> {
    const server = await this.getDiagnosticServer();
    return this.readModels(server, true);
  }

  async listSkills(input: AgentCommandDiscoveryInput): Promise<AgentSkillDescriptor[]> {
    const server = await this.getDiagnosticServer();
    const settings = agentSettingsService.getCodexSettings();
    const cwd = settings.executionMode === 'wsl'
      ? windowsPathToWsl(input.cwd, settings.wslDistribution) : input.cwd;
    const result = await server.request<{ data?: Array<{ skills?: Array<{
      name?: unknown; description?: unknown; enabled?: unknown;
      interface?: { shortDescription?: unknown };
    }> }> }>('skills/list', { cwds: [cwd], forceReload: true });
    const skills = new Map<string, AgentSkillDescriptor>();
    for (const skill of result.data?.[0]?.skills ?? []) {
      if (skill.enabled === false || typeof skill.name !== 'string'
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(skill.name)) continue;
      const description = typeof skill.interface?.shortDescription === 'string'
        ? skill.interface.shortDescription : typeof skill.description === 'string' ? skill.description : '';
      skills.set(skill.name, { name: skill.name, description });
    }
    return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async readModels(server: CodexAppServer, refresh = false): Promise<AgentModelOption[]> {
    const cached = this.modelCatalog.get(server);
    if (cached && !refresh) return cached;
    const models: AgentModelOption[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      const page: { data?: Array<{ id?: string; model?: string; displayName?: string; hidden?: boolean; isDefault?: boolean; defaultReasoningEffort?: AgentModelOption['defaultReasoningEffort']; supportedReasoningEfforts?: Array<{ reasoningEffort: NonNullable<AgentModelOption['supportedReasoningEfforts']>[number]; description?: string }> }>; nextCursor?: string | null } =
        await server.request('model/list', { cursor, limit: 100, includeHidden: false });
      for (const item of page.data ?? []) {
        const id = item.model || item.id;
        if (id && !item.hidden && !models.some((model) => model.id === id)) {
          models.push({ id, displayName: item.displayName || id, isDefault: item.isDefault,
            defaultReasoningEffort: item.defaultReasoningEffort,
            supportedReasoningEfforts: item.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort),
            reasoningEffortDescriptions: item.supportedReasoningEfforts?.some((entry) => entry.description)
              ? item.supportedReasoningEfforts.reduce<NonNullable<AgentModelOption['reasoningEffortDescriptions']>>((all, entry) => {
              if (entry.description) all[entry.reasoningEffort] = entry.description;
              return all;
            }, {}) : undefined });
        }
      }
      cursor = page.nextCursor ?? null;
      if (cursor && seenCursors.has(cursor)) break;
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    this.modelCatalog.set(server, models);
    return models;
  }

  private async defaultEffort(server: CodexAppServer, modelId: string | null) {
    try {
      const models = await this.readModels(server);
      return (models.find((model) => modelId && model.id === modelId)
        ?? models.find((model) => model.isDefault)
        ?? models[0])?.defaultReasoningEffort;
    } catch {
      // Older App Servers may omit model capabilities. Keep their native default.
      return undefined;
    }
  }

  async diagnose(cwd?: string) {
    // A login performed in another Codex process may not update a running app-server's account cache.
    this.diagnosticServer?.close();
    this.diagnosticServer = null;
    await this.authStatus();
    const server = await this.getDiagnosticServer();
    const settings = agentSettingsService.getCodexSettings();
    const runtimeCwd = cwd && settings.executionMode === 'wsl'
      ? windowsPathToWsl(cwd, settings.wslDistribution) : cwd;
    const [skills, mcp] = await Promise.allSettled([
      runtimeCwd ? server.request<{ data?: Array<{ skills?: unknown[]; errors?: unknown[] }> }>('skills/list', { cwds: [runtimeCwd], forceReload: true }) : Promise.resolve(null),
      server.request<{ data?: unknown[] }>('mcpServerStatus/list', { cursor: null, limit: 100, detail: 'toolsAndAuthOnly' }),
    ]);
    const bridge = await this.probeBridge(cwd ?? process.cwd()).then(() => ({ ready: true, error: null }),
      (error: unknown) => ({ ready: false, error: error instanceof Error ? error.message : String(error) }));
    return { ...this.status(),
      skills: skills.status === 'fulfilled' ? (skills.value?.data?.[0]?.skills?.length ?? null) : null,
      skillError: skills.status === 'rejected' ? String(skills.reason) : null,
      mcpServers: mcp.status === 'fulfilled' ? (mcp.value.data?.length ?? 0) : null,
      mcpError: mcp.status === 'rejected' ? String(mcp.reason) : null,
      bridgeReady: bridge.ready, bridgeError: bridge.error,
    };
  }

  private async probeBridge(cwd: string) {
    const settings = agentSettingsService.getCodexSettings();
    const bridge = new CodexToolBridge(settings.executionMode === 'wsl');
    await bridge.start([]);
    let server: CodexAppServer | null = null;
    let threadId: string | null = null;
    try {
      const host = settings.executionMode === 'wsl' ? await wslHost(settings.wslDistribution) : '127.0.0.1';
      server = new CodexAppServer(settings, cwd, {
        'mcp_servers.hexestra.url': bridge.url(host),
        'mcp_servers.hexestra.bearer_token_env_var': 'HEXESTRA_MCP_TOKEN',
        'mcp_servers.hexestra.required': true,
      }, { HEXESTRA_MCP_TOKEN: bridge.bearerToken });
      await server.start();
      const runtimeCwd = settings.executionMode === 'wsl' ? windowsPathToWsl(cwd, settings.wslDistribution) : cwd;
      const result = await server.request<{ thread: { id: string } }>('thread/start', {
        cwd: runtimeCwd, approvalPolicy: 'never', sandbox: 'read-only',
      });
      threadId = result.thread.id;
    } finally {
      if (threadId && server) await server.request('thread/delete', { threadId }).catch(() => {});
      server?.close();
      await bridge.close();
    }
  }

  private async getDiagnosticServer() {
    const fingerprint = this.fingerprint();
    if (this.diagnosticServer && this.diagnosticFingerprint === fingerprint) return this.diagnosticServer;
    this.diagnosticServer?.close();
    this.diagnosticServer = null;
    const settings = agentSettingsService.getCodexSettings();
    const server = new CodexAppServer(settings);
    server.on('message', (message: RpcMessage) => {
      if (message.method !== 'skills/changed' || this.diagnosticServer !== server) return;
      for (const listener of this.skillsChangedListeners) listener();
    });
    try {
      await server.start();
    } catch (error) {
      server.close();
      throw codexLaunchError(error, settings);
    }
    this.diagnosticServer = server;
    this.diagnosticFingerprint = fingerprint;
    return server;
  }

  async openConversation(input: AgentConversationOpenInput, interactions: AgentInteractionHandler): Promise<AgentConversationHandle> {
    const key = this.runtimeKey(input.projectId, input.conversationId);
    const existing = this.handles.get(key);
    if (existing) return existing;
    const handle = new CodexConversationHandle(this, input as AgentRunInput, interactions);
    this.handles.set(key, handle);
    return handle;
  }

  hasPinnedRuntimeForProject(projectId: string) {
    return [...this.handles.entries()].some(([key, handle]) => key.startsWith(`${projectId}\0`) && handle.snapshot().pendingCrons > 0);
  }

  hasPinnedRuntimeForConversation(projectId: string, conversationId: string) {
    return (this.handles.get(this.runtimeKey(projectId, conversationId))?.snapshot().pendingCrons ?? 0) > 0;
  }

  private runtimeKey(projectId: string | undefined, conversationId: string) {
    return `${projectId ?? ''}\0${conversationId}`;
  }

  isBusy(projectId: string | undefined, conversationId: string) {
    return this.activeTurnKeys.has(this.runtimeKey(projectId, conversationId));
  }

  removeHandle(projectId: string | undefined, conversationId: string, handle: CodexConversationHandle) {
    const key = this.runtimeKey(projectId, conversationId);
    if (this.handles.get(key) === handle) this.handles.delete(key);
  }

  async disposeConversation(projectId: string | undefined, conversationId: string) {
    const key = this.runtimeKey(projectId, conversationId);
    await this.handles.get(key)?.dispose();
    const runtime = this.runtimes.get(key);
    if (!runtime) return;
    this.runtimes.delete(key);
    runtime.server.close();
    await runtime.bridge.close();
  }

  async *runTurn(input: AgentRunInput, interactions: AgentInteractionHandler): AsyncIterable<AgentRunEvent> {
    const key = this.runtimeKey(input.projectId, input.conversationId);
    let runtime = this.runtimes.get(key);
    if (runtime && runtime.fingerprint !== this.fingerprint()
      && !this.hasPinnedRuntimeForConversation(input.projectId ?? '', input.conversationId)) {
      this.runtimes.delete(key);
      runtime.server.close();
      await runtime.bridge.close();
      runtime = undefined;
    }
    if (!runtime) {
      runtime = await this.createRuntime(input);
      this.runtimes.set(key, runtime);
    }
    this.activeTurnKeys.add(key);
    const { server, bridge } = runtime;
    bridge.bind(input.tools, interactions, input.signal,
      (delayMs, prompt) => {
        const handle = this.handles.get(key);
        if (!handle) throw new Error('Codex conversation is unavailable for scheduling');
        return handle.scheduleWakeup(delayMs, prompt);
      });
    const queue = new EventQueue<AgentRunEvent>();
    let turnId: string | null = null;
    let turnError: string | null = null;
    const activities = new Map<string, AgentActivity>();
    const subagents = new Map<string, SubagentRun>();
    let activeTextId: string | null = null;
    let textSequence = 0;
    const combinedText = () => [...activities.values()]
      .filter((activity) => activity.kind === 'text')
      .map((activity) => activity.content?.trim() ?? '')
      .filter(Boolean)
      .join('\n\n');
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      queue.push({ type: 'turn_snapshot', content: combinedText(), activities: [...activities.values()].map((item) => ({ ...item })),
        projectId: input.projectId, branchId: input.conversationId, inputId: input.inputId });
    };
    const scheduleFlush = () => { if (!flushTimer) flushTimer = setTimeout(flush, 50); };
    const onMessage = (message: RpcMessage) => {
      const params = asRecord(message.params);
      if (typeof message.id === 'number') {
        const response = message.method?.includes('requestApproval') ? { decision: 'decline' }
          : message.method === 'item/permissions/requestApproval' ? { permissions: [] }
          : message.method === 'tool/requestUserInput' ? { answers: {} } : { action: 'decline', content: null };
        server.respond(message.id, response);
        return;
      }
      if (params.threadId && params.threadId !== runtime!.threadId) return;
      if (turnId && params.turnId && params.turnId !== turnId) return;
      const item = asRecord(params.item);
      const id = String(item.id ?? params.itemId ?? '');
      if (message.method === 'error') {
        turnError = String(asRecord(params.error).message ?? 'Codex turn failed');
      }
      if ((message.method === 'item/started' || message.method === 'item/completed') && item.type === 'collabToolCall' && id) {
        const now = new Date().toISOString();
        const prior = subagents.get(id);
        const status = message.method === 'item/started' || item.agentStatus === 'running'
          ? 'running' : item.status === 'failed' ? 'failed' : 'completed';
        const run: SubagentRun = {
          id: prior?.id ?? `codex-${id}`, taskId: String(item.newThreadId ?? item.receiverThreadId ?? id),
          agentId: String(item.newThreadId ?? item.receiverThreadId ?? id), agentType: 'codex',
          description: String(item.prompt ?? prior?.description ?? item.tool ?? 'Codex subagent'),
          prompt: String(item.prompt ?? prior?.prompt ?? ''), status,
          startedAt: prior?.startedAt ?? now, updatedAt: now,
          ...(status === 'completed' || status === 'failed' ? { endedAt: now } : {}),
          activities: prior?.activities ?? [],
        };
        subagents.set(id, run);
        queue.push({ type: 'subagent_snapshot', projectId: input.projectId, branchId: input.conversationId, inputId: input.inputId, run });
      }
      if (message.method === 'item/started' && item.type === 'agentMessage' && id) {
        activeTextId = id;
      } else if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
        const textId = id || activeTextId || `codex-text-${++textSequence}`;
        activeTextId = textId;
        const previous = activities.get(textId);
        activities.set(textId, { id: textId, kind: 'text', status: 'streaming',
          content: `${previous?.content ?? ''}${params.delta}` });
        scheduleFlush();
      } else if (message.method === 'item/reasoning/summaryTextDelta' && id && typeof params.delta === 'string') {
        const previous = activities.get(id);
        activities.set(id, { id, kind: 'thinking', status: 'streaming', content: `${previous?.content ?? ''}${params.delta}` });
        scheduleFlush();
      } else if (message.method === 'item/completed' && item.type === 'reasoning' && id) {
        const previous = activities.get(id);
        activities.set(id, { id, kind: 'thinking', status: 'complete', content: previous?.content ?? '' });
        scheduleFlush();
      } else if (message.method === 'item/completed' && item.type === 'agentMessage' && typeof item.text === 'string') {
        const textId = activities.has(id) ? id : activeTextId && activities.has(activeTextId)
          ? activeTextId : id || `codex-text-${++textSequence}`;
        activities.set(textId, { id: textId, kind: 'text', status: 'complete', content: item.text });
        activeTextId = null;
        scheduleFlush();
      } else if ((message.method === 'item/started' || message.method === 'item/completed') && id) {
        if (item.type === 'mcpToolCall' || item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'collabToolCall') {
          activities.set(id, { id, kind: 'tool', toolName: String(item.tool ?? item.type),
            status: message.method === 'item/started' ? 'running' : item.status === 'failed' || item.status === 'declined' ? 'error' : 'complete',
            input: asRecord(item.arguments), outputSummary: String(item.error ?? item.aggregatedOutput
              ?? asRecord(Array.isArray(item.result) ? item.result[0] : item.result).text ?? ''),
          });
          scheduleFlush();
        }
      } else if (message.method === 'turn/completed') {
        const turn = asRecord(params.turn);
        if (turnId && turn.id !== turnId) return;
        if (!turnId && typeof turn.id === 'string') turnId = turn.id;
        if (turn.status === 'completed') {
          for (const activity of activities.values()) {
            if (activity.status === 'streaming') activity.status = 'complete';
          }
        }
        flush();
        if (turn.status === 'completed') {
          queue.push({ type: 'turn_completed', content: combinedText(), activities: [...activities.values()], backendMessageId: turnId ?? undefined,
            projectId: input.projectId, branchId: input.conversationId, inputId: input.inputId, source: input.source });
          queue.close();
        } else {
          queue.fail(new AgentBackendError(String(asRecord(turn.error).message ?? turnError ?? `Codex turn ${turn.status}`), this.id,
            turn.status === 'interrupted' ? 'cancelled' : 'runtime'));
        }
      }
    };
    const onFailure = (error: Error) => queue.fail(new AgentBackendError(error.message, this.id, 'runtime'));
    server.on('message', onMessage);
    server.on('failure', onFailure);
    const onAbort = () => {
      if (turnId) void server.request('turn/interrupt', { threadId: runtime!.threadId, turnId }).catch(() => {});
    };
    input.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (!runtime.threadId) {
        const cwd = runtime.settings.executionMode === 'wsl'
          ? windowsPathToWsl(input.cwd, runtime.settings.wslDistribution) : input.cwd;
        const response = input.fork && input.runtime?.sessionId && input.resumeAt
          ? await server.request<{ thread: { id: string } }>('thread/fork', { threadId: input.runtime.sessionId, lastTurnId: input.resumeAt })
          : input.runtime?.sessionId
            ? await server.request<{ thread: { id: string } }>('thread/resume', { threadId: input.runtime.sessionId, cwd })
            : await server.request<{ thread: { id: string } }>('thread/start', {
              cwd, model: input.model ?? undefined, approvalPolicy: 'never', sandbox: 'read-only',
            });
        runtime.threadId = response.thread.id;
      }
      queue.push({ type: 'session', sessionId: runtime.threadId, model: input.model,
        projectId: input.projectId, branchId: input.conversationId });
      if (input.command === '/compact') {
        await server.request('thread/compact/start', { threadId: runtime.threadId });
        queue.push({ type: 'turn_completed', content: 'Codex context compaction started.', activities: [],
          projectId: input.projectId, branchId: input.conversationId, inputId: input.inputId, source: input.source });
        queue.close();
        for await (const event of queue) yield event;
        return;
      }
      const prompt = [input.prompt, input.dynamicSystemContext ? `\n<hexestra_dynamic_context>\n${input.dynamicSystemContext}\n</hexestra_dynamic_context>` : ''].join('');
      const items: Array<RecordValue> = [{ type: 'text', text: prompt }];
      const settings = runtime.settings;
      for (const attachment of input.attachments) {
        const runtimePath = settings.executionMode === 'wsl'
          ? windowsPathToWsl(attachment.path, settings.wslDistribution) : attachment.path;
        if (attachment.kind === 'image') {
          items.push({ type: 'localImage', path: runtimePath });
        } else if (attachment.kind === 'text' && attachment.content) {
          items.push({ type: 'text', text: `\nAttached ${attachment.name}:\n${attachment.content}` });
        } else if (attachment.kind === 'pdf') {
          items.push({ type: 'text', text: `\nAttached PDF ${attachment.name}:\n${await extractPdfText(attachment.path)}` });
        } else {
          items.push({ type: 'text', text: `\nAttached file: ${runtimePath}` });
        }
      }
      const response = await server.request<{ turn: { id: string } }>('turn/start', {
        threadId: runtime.threadId, input: items, approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' },
        model: input.model ?? undefined,
        effort: input.reasoningEffort ?? await this.defaultEffort(server, input.model),
      });
      turnId = response.turn.id;
      if (input.signal.aborted) onAbort();
      for await (const event of queue) yield event;
    } finally {
      input.signal.removeEventListener('abort', onAbort);
      server.off('message', onMessage);
      server.off('failure', onFailure);
      if (flushTimer) clearTimeout(flushTimer);
      bridge.unbind();
      this.activeTurnKeys.delete(key);
    }
  }

  private async createRuntime(input: AgentRunInput): Promise<Runtime> {
    const settings = agentSettingsService.getCodexSettings();
    const bridge = new CodexToolBridge(settings.executionMode === 'wsl');
    await bridge.start(input.tools);
    let server: CodexAppServer | null = null;
    try {
      const host = settings.executionMode === 'wsl' ? await wslHost(settings.wslDistribution) : '127.0.0.1';
      server = new CodexAppServer(settings, input.cwd, {
        'mcp_servers.hexestra.url': bridge.url(host),
        'mcp_servers.hexestra.bearer_token_env_var': 'HEXESTRA_MCP_TOKEN',
        'mcp_servers.hexestra.required': true,
        developer_instructions: input.systemInstructions,
      }, { HEXESTRA_MCP_TOKEN: bridge.bearerToken });
      await server.start();
      const account = await server.request<{ account: unknown }>('account/read', { refreshToken: false });
      this.authenticated = Boolean(account.account);
      if (!this.authenticated) throw new AgentBackendError('Sign in to Codex before using this backend', this.id, 'authentication');
      return { server, bridge, threadId: null, cwd: input.cwd, fingerprint: this.fingerprint(), settings };
    } catch (error) {
      server?.close();
      await bridge.close();
      throw codexLaunchError(error, settings);
    }
  }
}

function codexLaunchError(error: unknown, settings: ReturnType<typeof agentSettingsService.getCodexSettings>): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (!/\bENOENT\b/i.test(message)) return error instanceof Error ? error : new Error(message);
  if (settings.executionMode === 'wsl' && /wsl\.exe/i.test(message)) {
    return new AgentBackendError('WSL is unavailable. Install WSL or select Native under Settings → Connection → Codex.', 'codex', 'unavailable');
  }
  const location = settings.executionMode === 'wsl' ? `WSL distribution ${settings.wslDistribution}` : 'this computer';
  return new AgentBackendError(
    `Codex CLI executable "${settings.codexExecutable}" was not found in ${location}. Check the executable path under Settings → Connection → Codex, or install Codex CLI there and restart Hexestra. Run codex --version in the selected environment to verify the installation.`,
    'codex', 'unavailable',
  );
}

async function wslHost(distribution: string) {
  const { stdout } = await execFileAsync('wsl.exe', ['--distribution', distribution, '--exec', 'sh', '-lc',
    "ip route show default | awk '{print $3; exit}'"], { timeout: 10_000, windowsHide: true });
  const host = stdout.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) throw new Error('Could not resolve Windows host from WSL');
  return host;
}

function asRecord(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

async function extractPdfText(filePath: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(filePath)), disableWorker: true, useWorkerFetch: false } as never);
  const document = await task.promise;
  const parts: string[] = [];
  try {
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      parts.push(`Page ${index}: ${content.items.map((item) => 'str' in item ? item.str : '').join(' ')}`);
      if (Buffer.byteLength(parts.join('\n'), 'utf8') > 2 * 1024 * 1024) {
        throw new Error('Codex PDF attachment exceeds the 2 MB extracted text limit');
      }
    }
  } finally { await document.destroy(); }
  return parts.join('\n');
}

class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  private error: Error | null = null;
  push(item: T) { if (this.done) return; this.items.push(item); this.wake?.(); }
  close() { this.done = true; this.wake?.(); }
  fail(error: Error) { this.error = error; this.close(); }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.items.length) { yield this.items.shift()!; continue; }
      if (this.done) { if (this.error) throw this.error; return; }
      await new Promise<void>((resolve) => { this.wake = resolve; });
      this.wake = null;
    }
  }
}

class CodexConversationHandle implements AgentConversationHandle {
  private readonly eventQueue = new EventQueue<AgentRunEvent>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingInputs = 0;
  private active = false;
  private disposed = false;
  private currentController: AbortController | null = null;
  private chain = Promise.resolve();

  constructor(private readonly adapter: CodexAgentAdapter, private readonly base: AgentRunInput,
    private readonly interactions: AgentInteractionHandler) {}

  events() { return this.eventQueue; }

  snapshot() {
    return { projectId: this.base.projectId, branchId: this.base.conversationId,
      active: this.active, pendingInputs: this.pendingInputs, pendingCrons: this.timers.size, interactionPending: false };
  }

  private emitState() {
    this.eventQueue.push({ type: 'runtime_state', projectId: this.base.projectId,
      branchId: this.base.conversationId, snapshot: this.snapshot() });
  }

  scheduleWakeup(delayMs: number, prompt: string) {
    if (this.disposed) throw new Error('Codex conversation was closed');
    const id = `codex-wakeup-${randomUUID()}`;
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.enqueue({ id, source: 'scheduled', prompt, queuedAt: new Date().toISOString(),
        input: { ...this.base, prompt, inputId: id, source: 'scheduled', fork: false, resumeAt: undefined } });
    }, delayMs);
    this.timers.set(id, timer);
    this.emitState();
    return id;
  }

  async enqueue(queued: AgentQueuedInput) {
    if (this.disposed) throw new Error('Codex conversation was closed');
    this.pendingInputs += 1;
    this.emitState();
    this.chain = this.chain.catch(() => {}).then(async () => {
      while (!this.disposed && this.adapter.isBusy(this.base.projectId, this.base.conversationId)) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      if (this.disposed) return;
      this.pendingInputs -= 1;
      this.active = true;
      this.currentController = new AbortController();
      this.emitState();
      const startedAt = new Date().toISOString();
      this.eventQueue.push({ type: 'input_started', projectId: this.base.projectId, branchId: this.base.conversationId,
        inputId: queued.id, source: queued.source, prompt: queued.prompt, queuedAt: queued.queuedAt, startedAt });
      this.eventQueue.push({ type: 'turn_started', projectId: this.base.projectId, branchId: this.base.conversationId,
        inputId: queued.id, source: queued.source, startedAt });
      try {
        const dynamicSystemContext = queued.source === 'scheduled'
          ? await queued.input.dynamicSystemContextProvider?.() : queued.input.dynamicSystemContext;
        for await (const event of this.adapter.runTurn({ ...queued.input, prompt: queued.prompt,
          inputId: queued.id, source: queued.source, signal: this.currentController.signal,
          dynamicSystemContext }, queued.interactions ?? this.interactions)) this.eventQueue.push(event);
      } catch (error) {
        this.eventQueue.push({ type: 'turn_completed', projectId: this.base.projectId, branchId: this.base.conversationId,
          inputId: queued.id, source: queued.source, content: `Codex turn failed: ${error instanceof Error ? error.message : String(error)}`,
          status: this.currentController.signal.aborted ? 'interrupted' : 'error', activities: [] });
      } finally {
        this.active = false;
        this.currentController = null;
        this.emitState();
      }
    });
  }

  async interrupt() {
    this.currentController?.abort();
    return { stillQueued: [] };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.currentController?.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.eventQueue.close();
    this.adapter.removeHandle(this.base.projectId, this.base.conversationId, this);
  }
}
