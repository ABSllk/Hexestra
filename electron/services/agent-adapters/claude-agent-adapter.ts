import fs from 'fs';
import type {
  CanUseTool,
  HookCallback,
  PermissionResult,
  PreToolUseHookInput,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  AgentBackendError,
  CLAUDE_BACKEND_ID,
  type AgentAdapter,
  type AgentBackendCapabilities,
  type AgentBackendStatus,
  type AgentCommandDiscoveryInput,
  type AgentInteractionHandler,
  type AgentRunEvent,
  type AgentRunInput,
} from '../../contracts/agent-runtime';
import {
  normalizeAgentSlashCommands,
  type AgentSlashCommandDescriptor,
} from '../../agent-command-contract';
import {
  sanitizeClaudeMcpRuntimeError,
  type ClaudeMcpRuntimeStatusResult,
} from '../../contracts/claude-capabilities';
import {
  buildAskUserQuestionUpdatedInput,
  parseAskUserQuestionInput,
} from '../../agent-interaction-contract';
import { installHexestraSkills } from '../pentest-skill';
import { isAgentAuthenticationError } from '../agent-error';
import {
  agentSettingsService,
} from '../agent-settings.service';
import { spawnClaudeCodeInWsl, validateWslClaudeExecutable, windowsPathToWsl } from '../wsl-agent-runtime';
import {
  resolveClaudeRuntime,
  runtimeFingerprint,
  type ClaudeRuntimeResolution,
} from '../claude-runtime';
import { buildAgentSdkPrompt, buildAgentSdkUserMessage } from '../agent-attachment';
import { AgentTimelineBuilder } from '../agent-timeline';
import { SubagentRegistry } from '../subagent-registry';
import type { AgentToolDefinition } from '../../contracts/agent-tools';
import { createClaudeSdkTools } from './claude-tool-bridge';
import { isSubagentSpawnTool, isManagedRecordFileMutation } from '../agent-tool-policy';

type AgentSdk = typeof import('@anthropic-ai/claude-agent-sdk');

const AGENT_CONTEXT_VERSION = 'hexestra-context-v7';
const COMMAND_DISCOVERY_TIMEOUT_MS = 15_000;
const CLAUDE_READ_ONLY_BUILTINS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch', 'NotebookRead',
]);

const capabilities: AgentBackendCapabilities = {
  branching: 'message',
  subagents: true,
  attachments: ['text', 'image', 'pdf', 'file'],
  tools: true,
  interactiveQuestions: true,
  slashCommands: true,
};

interface ClaudeLiveTurn {
  output: AsyncPushQueue<AgentRunEvent>;
  interactions: AgentInteractionHandler;
  tools: AgentToolDefinition[];
  dynamicSystemContext?: string;
  timeline: AgentTimelineBuilder;
  subagentRegistry: SubagentRegistry;
  pendingSubagentRunIds: Set<string>;
  lastAssistantBackendMessageId?: string;
  sessionReported: boolean;
  completed: boolean;
}

interface ClaudeLiveRuntime {
  key: string;
  query: Query;
  input: AsyncPushQueue<SDKUserMessage>;
  abortController: AbortController;
  activeTurn: ClaudeLiveTurn | null;
  sessionId: string | null;
  model: string | null;
  commands: AgentSlashCommandDescriptor[];
  commandsLoaded: boolean;
  closing: boolean;
  reader: Promise<void>;
}

export class ClaudeAgentAdapter implements AgentAdapter {
  readonly id = CLAUDE_BACKEND_ID;
  readonly capabilities = capabilities;

  private sdk: AgentSdk | null = null;
  private initialization: Promise<boolean> | null = null;
  private initializationSettingsKey: string | null = null;
  private preparedRuntimeSettingsKey: string | null = null;
  private runtime: ClaudeRuntimeResolution | null = null;
  private authenticated: boolean | null = null;
  private model: string | null = null;
  private lastError: string | null = null;
  private readonly commandCache = new Map<string, AgentSlashCommandDescriptor[]>();
  private readonly commandRequests = new Map<string, Promise<AgentSlashCommandDescriptor[]>>();
  private liveRuntime: ClaudeLiveRuntime | null = null;

  async initialize(projectId?: string) {
    const settings = agentSettingsService.getClaudeSettings();
    const settingsKey = runtimeSettingsKey(settings, projectId);
    if (this.initialization && this.initializationSettingsKey === settingsKey) return this.initialization;
    this.initializationSettingsKey = settingsKey;
    this.initialization = this.prepareRuntime(settings, projectId);
    return this.initialization;
  }

  fingerprint() {
    const settings = agentSettingsService.getClaudeSettings();
    const runtime = this.preparedRuntimeSettingsKey === runtimeSettingsKey(settings) ? this.runtime : null;
    return `${runtimeFingerprint(settings, runtime)}:${AGENT_CONTEXT_VERSION}`;
  }

  async resolveFingerprint(projectId?: string) {
    await this.initialize(projectId);
    return this.fingerprint();
  }

  async disposeConversation(projectId: string | undefined, conversationId: string) {
    const runtime = this.liveRuntime;
    if (!runtime || !runtime.key.startsWith(`${projectId ?? ''}\u0000${conversationId}\u0000`)) return;
    await this.disposeLiveRuntime(runtime);
  }

  status(): AgentBackendStatus {
    const settings = agentSettingsService.getClaudeSettings();
    return {
      available: this.sdk !== null && Boolean(this.runtime?.executablePath),
      authenticated: this.authenticated,
      model: this.model ?? settings.model,
      lastError: this.lastError,
      runtimeMode: settings.executionMode,
      runtimeLabel: settings.executionMode === 'wsl'
        ? `WSL 路 ${settings.wslDistribution}`
        : 'Native',
    };
  }

  async listCommands(input: AgentCommandDiscoveryInput) {
    const available = await this.initialize(input.projectId);
    if (!available || !this.sdk) {
      throw new AgentBackendError(
        this.lastError ?? 'Claude Agent SDK is unavailable',
        this.id,
        'unavailable',
      );
    }

    const cacheKey = this.commandCacheKey(input.cwd, input.additionalDirectories);
    const cached = this.commandCache.get(cacheKey);
    if (cached) return cached;
    const pending = this.commandRequests.get(cacheKey);
    if (pending) return pending;

    const request = this.discoverCommands(input, cacheKey);
    this.commandRequests.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.commandRequests.delete(cacheKey);
    }
  }

  async listMcpServerStatuses(
    input: AgentCommandDiscoveryInput,
  ): Promise<ClaudeMcpRuntimeStatusResult> {
    const available = await this.initialize(input.projectId);
    if (!available || !this.sdk) {
      throw new AgentBackendError(
        this.lastError ?? 'Claude Agent SDK is unavailable',
        this.id,
        'unavailable',
      );
    }

    const discovery = this.createDiscoveryQuery(input);
    try {
      let statuses = await discovery.query.mcpServerStatus();
      const deadline = Date.now() + COMMAND_DISCOVERY_TIMEOUT_MS;
      while (
        statuses.some((item) => item.status === 'pending')
        && Date.now() < deadline
        && !discovery.abortController.signal.aborted
      ) {
        await wait(500);
        if (discovery.abortController.signal.aborted) break;
        statuses = await discovery.query.mcpServerStatus();
      }
      return {
        checkedAt: new Date().toISOString(),
        items: statuses.map((item) => ({
          name: item.name,
          status: item.status,
          error: sanitizeClaudeMcpRuntimeError(item.error),
          scope: item.scope?.trim().slice(0, 100) || null,
          toolCount: item.tools?.length ?? 0,
        })),
      };
    } finally {
      discovery.close();
    }
  }

  async *runTurn(
    input: AgentRunInput,
    interactions: AgentInteractionHandler,
  ): AsyncIterable<AgentRunEvent> {
    if (!input.conversationId) {
      yield* this.runTurnLegacy(input, interactions);
      return;
    }
    if (input.signal.aborted) {
      throw new AgentBackendError('Claude request was cancelled', this.id, 'cancelled');
    }
    const available = await this.initialize(input.projectId);
    if (!available || !this.sdk) {
      throw new AgentBackendError(
        this.lastError ?? 'Claude Agent SDK is unavailable',
        this.id,
        'unavailable',
      );
    }

    const settings = agentSettingsService.getClaudeSettings();
    const runtimeResolution = this.runtime;
    if (!runtimeResolution?.executablePath) {
      throw new AgentBackendError(this.lastError ?? 'Claude Code is not installed', this.id, 'unavailable');
    }
    const queryCwd = input.cwd;
    if (queryCwd && fs.existsSync(queryCwd)) {
      const installedSkills = installHexestraSkills(queryCwd);
      if (!installedSkills) {
        throw new AgentBackendError(
          'Native Hexestra skill resources are incomplete or unavailable',
          this.id,
          'runtime',
        );
      }
    }

    const runtime = await this.ensureLiveRuntime(input, settings, runtimeResolution);
    if (runtime.activeTurn) {
      throw new AgentBackendError('Claude is already processing a request', this.id, 'runtime');
    }
    const turn: ClaudeLiveTurn = {
      output: new AsyncPushQueue<AgentRunEvent>(),
      interactions,
      tools: input.tools,
      dynamicSystemContext: input.dynamicSystemContext,
      timeline: new AgentTimelineBuilder(`turn-${Date.now()}`),
      subagentRegistry: new SubagentRegistry(`turn-${Date.now()}`),
      pendingSubagentRunIds: new Set<string>(),
      sessionReported: false,
      completed: false,
    };
    runtime.activeTurn = turn;
    if (runtime.sessionId) {
      turn.output.push({ type: 'session', sessionId: runtime.sessionId, model: runtime.model });
      turn.sessionReported = true;
    }
    const abortFromInput = () => {
      void runtime.query.interrupt().catch((error) => {
        this.failLiveRuntime(runtime, error, 'cancelled');
      });
    };
    input.signal.addEventListener('abort', abortFromInput, { once: true });

    try {
      await runtime.query.setPermissionMode(input.permissionMode);
      if (!runtime.commandsLoaded) {
        try {
          runtime.commands = this.cacheCommands(
            this.commandCacheKey(input.cwd, input.additionalDirectories),
            await runtime.query.supportedCommands(),
          );
        } catch (error) {
          console.warn('[Agent] Could not read Claude slash commands:', toErrorMessage(error));
        } finally {
          runtime.commandsLoaded = true;
        }
      }
      turn.output.push({ type: 'commands_changed', commands: runtime.commands });
      runtime.input.push(buildAgentSdkUserMessage(input.prompt, input.attachments, input.command));
      for await (const event of turn.output) {
        if (input.signal.aborted && event.type === 'turn_completed') {
          throw new AgentBackendError('Claude request was cancelled', this.id, 'cancelled');
        }
        yield event;
      }
      if (input.signal.aborted) {
        throw new AgentBackendError('Claude request was cancelled', this.id, 'cancelled');
      }
    } catch (error) {
      const message = toErrorMessage(error);
      const code = input.signal.aborted || /cancel/i.test(message)
        ? 'cancelled'
        : error instanceof AgentBackendError
          ? error.code
          : isAgentAuthenticationError(message)
            ? 'authentication'
            : 'runtime';
      if (!turn.completed && runtime.activeTurn === turn) this.failLiveRuntime(runtime, error, code);
      this.lastError = code === 'cancelled' ? null : message;
      throw error instanceof AgentBackendError
        ? error
        : new AgentBackendError(message, this.id, code);
    } finally {
      input.signal.removeEventListener('abort', abortFromInput);
      if (!turn.completed && runtime.activeTurn === turn) abortFromInput();
    }
  }

  private async *runTurnLegacy(
    input: AgentRunInput,
    interactions: AgentInteractionHandler,
  ): AsyncIterable<AgentRunEvent> {
    const available = await this.initialize(input.projectId);
    if (!available || !this.sdk) {
      throw new AgentBackendError(
        this.lastError ?? 'Claude Agent SDK is unavailable',
        this.id,
        'unavailable',
      );
    }

    const settings = agentSettingsService.getClaudeSettings();
    const runtime = this.runtime;
    if (!runtime?.executablePath) {
      throw new AgentBackendError(this.lastError ?? 'Claude Code is not installed', this.id, 'unavailable');
    }
    const runtimeSettings = { ...settings, claudeExecutable: runtime.executablePath };
    const timeline = new AgentTimelineBuilder(`turn-${Date.now()}`);
    const subagentRegistry = new SubagentRegistry(`turn-${Date.now()}`);
    const pendingSubagentRunIds = new Set<string>();
    let lastAssistantBackendMessageId: string | undefined;
    const tools = input.tools;
    const canUseTool = this.createPermissionHandler(interactions, tools);
    const queryCwd = input.cwd;
    if (queryCwd && fs.existsSync(queryCwd)) {
      const sessionPath = queryCwd;
      const installedSkills = installHexestraSkills(sessionPath);
      if (!installedSkills) {
        throw new AgentBackendError(
          'Native Hexestra skill resources are incomplete or unavailable',
          this.id,
          'runtime',
        );
      }
    }

    const isWsl = settings.executionMode === 'wsl';
    const sdkCwd = isWsl
      ? windowsPathToWsl(queryCwd, settings.wslDistribution)
      : queryCwd;
    const abortController = new AbortController();
    const abortFromInput = () => abortController.abort();
    if (input.signal.aborted) abortController.abort();
    else input.signal.addEventListener('abort', abortFromInput, { once: true });

    try {
      const query = this.sdk.query({
        prompt: buildAgentSdkPrompt(input.prompt, input.attachments, input.command),
        options: {
          abortController,
          cwd: sdkCwd,
          additionalDirectories: input.additionalDirectories,
          pathToClaudeCodeExecutable: runtime.executablePath,
          spawnClaudeCodeProcess: isWsl
            ? (options) => spawnClaudeCodeInWsl(options, runtimeSettings)
            : undefined,
          canUseTool,
          hooks: {
            PreToolUse: [{ hooks: [createManagedRecordGuard()] }],
          },
          includePartialMessages: true,
          forwardSubagentText: true,
          enableFileCheckpointing: true,
          mcpServers: {
            hexestra: this.sdk.createSdkMcpServer({
              name: 'hexestra',
              version: '0.2.1',
              tools: createClaudeSdkTools(this.sdk, tools),
            }),
          },
          permissionMode: input.permissionMode,
          allowDangerouslySkipPermissions: input.permissionMode === 'bypassPermissions',
          persistSession: true,
          resume: input.runtime?.sessionId ?? undefined,
          resumeSessionAt: input.resumeAt,
          forkSession: input.fork || undefined,
          settingSources: requiredSettingSources(settings.settingSources),
          model: input.model ?? settings.model ?? undefined,
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: input.systemInstructions,
          },
          tools: { type: 'preset', preset: 'claude_code' },
          env: runtime.environment,
          stderr: (data) => {
            const line = data.trim();
            if (line) console.warn('[Agent] Claude stderr:', line);
          },
        },
      });

      try {
        const commands = this.cacheCommands(
          this.commandCacheKey(input.cwd, input.additionalDirectories),
          await query.supportedCommands(),
        );
        yield { type: 'commands_changed', commands };
      } catch (error) {
        console.warn('[Agent] Could not read Claude slash commands:', toErrorMessage(error));
      }

      for await (const message of query) {
        this.captureSessionMetadata(message);
        if (message.type === 'system' && message.subtype === 'commands_changed') {
          const commands = this.cacheCommands(
            this.commandCacheKey(input.cwd, input.additionalDirectories),
            message.commands,
          );
          yield { type: 'commands_changed', commands };
        }
        if (message.type === 'system' && message.subtype === 'init') {
          yield {
            type: 'session',
            sessionId: message.session_id,
            model: message.model,
          };
        }
        if (message.type === 'assistant' && message.parent_tool_use_id == null) {
          lastAssistantBackendMessageId = message.uuid;
        }

        const changedSubagentRuns = subagentRegistry.consume(message);
        for (const runId of changedSubagentRuns) pendingSubagentRunIds.add(runId);
        const mainTimelineChanged = !subagentRegistry.isChildMessage(message) && timeline.consume(message);
        subagentRegistry.annotateMainTimeline(timeline);

        if (mainTimelineChanged) {
          yield {
            type: 'turn_snapshot',
            content: timeline.getText(),
            activities: timeline.snapshot(),
          };
        }
        for (const runId of pendingSubagentRunIds) {
          const run = subagentRegistry.getRun(runId);
          if (run) yield { type: 'subagent_snapshot', run };
        }
        pendingSubagentRunIds.clear();

        if (message.type === 'result') {
          if (message.subtype === 'success' && !timeline.getText().trim()) {
            timeline.addText(message.result);
          } else if (message.subtype !== 'success') {
            throw new AgentBackendError(
              message.errors.join('\n') || message.subtype,
              this.id,
              message.errors.some((error) => /auth|login|api key|credential/i.test(error))
                ? 'authentication'
                : 'runtime',
            );
          }
        }
      }

      timeline.finish();
      for (const runId of subagentRegistry.finish('completed')) pendingSubagentRunIds.add(runId);
      subagentRegistry.annotateMainTimeline(timeline);
      for (const runId of pendingSubagentRunIds) {
        const run = subagentRegistry.getRun(runId);
        if (run) yield { type: 'subagent_snapshot', run };
      }
      const content = timeline.getText().trim() || '(Claude returned no text response)';
      yield {
        type: 'turn_completed',
        content,
        activities: timeline.snapshot(),
        backendMessageId: lastAssistantBackendMessageId,
      };
      this.authenticated = true;
      this.lastError = null;
    } catch (error) {
      const message = toErrorMessage(error);
      const code = input.signal.aborted || /cancel/i.test(message)
        ? 'cancelled'
        : error instanceof AgentBackendError
          ? error.code
          : isAgentAuthenticationError(message)
            ? 'authentication'
            : 'runtime';
      this.lastError = code === 'cancelled' ? null : message;
      const terminalStatus = code === 'cancelled' ? 'stopped' : 'failed';
      for (const runId of subagentRegistry.finish(terminalStatus)) {
        const run = subagentRegistry.getRun(runId);
        if (run) yield { type: 'subagent_snapshot', run };
      }
      throw error instanceof AgentBackendError
        ? error
        : new AgentBackendError(message, this.id, code);
    } finally {
      input.signal.removeEventListener('abort', abortFromInput);
    }
  }

  private async ensureLiveRuntime(
    input: AgentRunInput,
    settings: ReturnType<typeof agentSettingsService.getClaudeSettings>,
    runtimeResolution: ClaudeRuntimeResolution,
  ) {
    if (!this.sdk || !runtimeResolution.executablePath) {
      throw new AgentBackendError('Claude Agent SDK is unavailable', this.id, 'unavailable');
    }
    const key = liveRuntimeKey(input, this.fingerprint());
    if (this.liveRuntime?.key === key && !this.liveRuntime.closing) return this.liveRuntime;
    if (this.liveRuntime) await this.disposeLiveRuntime(this.liveRuntime);

    const runtimeSettings = { ...settings, claudeExecutable: runtimeResolution.executablePath };
    const isWsl = settings.executionMode === 'wsl';
    const sdkCwd = isWsl
      ? windowsPathToWsl(input.cwd, settings.wslDistribution)
      : input.cwd;
    const inputQueue = new AsyncPushQueue<SDKUserMessage>();
    const abortController = new AbortController();
    let live!: ClaudeLiveRuntime;
    const query = this.sdk.query({
      prompt: inputQueue,
      options: {
        abortController,
        cwd: sdkCwd,
        additionalDirectories: input.additionalDirectories,
        pathToClaudeCodeExecutable: runtimeResolution.executablePath,
        spawnClaudeCodeProcess: isWsl
          ? (options) => spawnClaudeCodeInWsl(options, runtimeSettings)
          : undefined,
        canUseTool: this.createLivePermissionHandler(() => live?.activeTurn ?? null),
        hooks: {
          PreToolUse: [{ hooks: [createManagedRecordGuard()] }],
          UserPromptSubmit: [{ hooks: [createDynamicContextHook(() => live?.activeTurn ?? null)] }],
        },
        includePartialMessages: true,
        forwardSubagentText: true,
        enableFileCheckpointing: true,
        mcpServers: {
          hexestra: this.sdk.createSdkMcpServer({
            name: 'hexestra',
            version: '0.2.1',
            tools: createClaudeSdkTools(
              this.sdk,
              input.tools,
              (name) => live?.activeTurn?.tools.find((definition) => definition.name === name),
            ),
          }),
        },
        // Start in ASK mode so canUseTool remains reachable. Each streamed
        // turn switches to its requested permission mode before input.
        permissionMode: 'default',
        allowDangerouslySkipPermissions: true,
        persistSession: true,
        resume: input.runtime?.sessionId ?? undefined,
        resumeSessionAt: input.resumeAt,
        forkSession: input.fork || undefined,
        settingSources: requiredSettingSources(settings.settingSources),
        model: input.model ?? settings.model ?? undefined,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: input.systemInstructions,
        },
        tools: { type: 'preset', preset: 'claude_code' },
        env: runtimeResolution.environment,
        stderr: (data) => {
          const line = data.trim();
          if (line) console.warn('[Agent] Claude stderr:', line);
        },
      },
    });
    live = {
      key,
      query,
      input: inputQueue,
      abortController,
      activeTurn: null,
      sessionId: null,
      model: null,
      commands: [],
      commandsLoaded: false,
      closing: false,
      reader: Promise.resolve(),
    };
    this.liveRuntime = live;
    live.reader = this.consumeLiveRuntime(live, input);
    return live;
  }

  private async consumeLiveRuntime(runtime: ClaudeLiveRuntime, input: AgentRunInput) {
    try {
      for await (const message of runtime.query) {
        this.captureSessionMetadata(message);
        if (message.type === 'system' && message.subtype === 'commands_changed') {
          runtime.commands = this.cacheCommands(
            this.commandCacheKey(input.cwd, input.additionalDirectories),
            message.commands,
          );
          runtime.commandsLoaded = true;
          runtime.activeTurn?.output.push({ type: 'commands_changed', commands: runtime.commands });
        }
        if (message.type === 'system' && message.subtype === 'init') {
          runtime.sessionId = message.session_id;
          runtime.model = message.model;
          const turn = runtime.activeTurn;
          if (turn && !turn.sessionReported) {
            turn.output.push({ type: 'session', sessionId: message.session_id, model: message.model });
            turn.sessionReported = true;
          }
        }
        const turn = runtime.activeTurn;
        if (!turn) continue;
        this.consumeTurnMessage(turn, message);
        if (message.type === 'result') this.finishLiveTurn(runtime, turn, message);
      }
      if (!runtime.closing) this.failLiveRuntime(runtime, new Error('Claude streaming session ended unexpectedly'));
    } catch (error) {
      if (!runtime.closing) this.failLiveRuntime(runtime, error);
    } finally {
      runtime.input.end();
      if (this.liveRuntime === runtime) this.liveRuntime = null;
    }
  }

  private consumeTurnMessage(turn: ClaudeLiveTurn, message: SDKMessage) {
    if (message.type === 'assistant' && message.parent_tool_use_id == null) {
      turn.lastAssistantBackendMessageId = message.uuid;
    }
    const changedSubagentRuns = turn.subagentRegistry.consume(message);
    for (const runId of changedSubagentRuns) turn.pendingSubagentRunIds.add(runId);
    const mainTimelineChanged = !turn.subagentRegistry.isChildMessage(message)
      && turn.timeline.consume(message);
    turn.subagentRegistry.annotateMainTimeline(turn.timeline);
    if (mainTimelineChanged) {
      turn.output.push({
        type: 'turn_snapshot',
        content: turn.timeline.getText(),
        activities: turn.timeline.snapshot(),
      });
    }
    this.flushSubagentSnapshots(turn);
  }

  private finishLiveTurn(
    runtime: ClaudeLiveRuntime,
    turn: ClaudeLiveTurn,
    message: Extract<SDKMessage, { type: 'result' }>,
  ) {
    if (turn.completed) return;
    if (message.subtype !== 'success') {
      const error = new AgentBackendError(
        message.errors.join('\n') || message.subtype,
        this.id,
        message.errors.some((entry) => /auth|login|api key|credential/i.test(entry))
          ? 'authentication'
          : 'runtime',
      );
      this.finishTurnSubagents(turn, 'failed');
      turn.completed = true;
      runtime.activeTurn = null;
      turn.output.fail(error);
      return;
    }
    if (!turn.timeline.getText().trim()) turn.timeline.addText(message.result);
    turn.timeline.finish();
    this.finishTurnSubagents(turn, 'completed');
    turn.output.push({
      type: 'turn_completed',
      content: turn.timeline.getText().trim() || '(Claude returned no text response)',
      activities: turn.timeline.snapshot(),
      backendMessageId: turn.lastAssistantBackendMessageId,
    });
    turn.completed = true;
    runtime.activeTurn = null;
    turn.output.end();
    this.authenticated = true;
    this.lastError = null;
  }

  private finishTurnSubagents(turn: ClaudeLiveTurn, status: 'completed' | 'failed' | 'stopped') {
    for (const runId of turn.subagentRegistry.finish(status)) turn.pendingSubagentRunIds.add(runId);
    turn.subagentRegistry.annotateMainTimeline(turn.timeline);
    this.flushSubagentSnapshots(turn);
  }

  private flushSubagentSnapshots(turn: ClaudeLiveTurn) {
    for (const runId of turn.pendingSubagentRunIds) {
      const run = turn.subagentRegistry.getRun(runId);
      if (run) turn.output.push({ type: 'subagent_snapshot', run });
    }
    turn.pendingSubagentRunIds.clear();
  }

  private failLiveRuntime(
    runtime: ClaudeLiveRuntime,
    error: unknown,
    forcedCode?: AgentBackendError['code'],
  ) {
    runtime.closing = true;
    const turn = runtime.activeTurn;
    if (turn && !turn.completed) {
      const message = toErrorMessage(error);
      const code = forcedCode
        ?? (error instanceof AgentBackendError
          ? error.code
          : isAgentAuthenticationError(message)
            ? 'authentication'
            : 'runtime');
      this.finishTurnSubagents(turn, code === 'cancelled' ? 'stopped' : 'failed');
      turn.completed = true;
      runtime.activeTurn = null;
      turn.output.fail(error instanceof AgentBackendError
        ? error
        : new AgentBackendError(message, this.id, code));
    }
    runtime.input.end();
    runtime.query.close();
  }

  private async disposeLiveRuntime(runtime: ClaudeLiveRuntime) {
    if (runtime.closing) {
      await Promise.race([runtime.reader.catch(() => undefined), wait(3_000)]);
      if (this.liveRuntime === runtime) this.liveRuntime = null;
      return;
    }
    runtime.closing = true;
    runtime.input.end();
    runtime.abortController.abort();
    runtime.query.close();
    if (runtime.activeTurn && !runtime.activeTurn.completed) {
      this.failLiveRuntime(
        runtime,
        new AgentBackendError('Claude conversation runtime was closed', this.id, 'cancelled'),
      );
    }
    await Promise.race([runtime.reader.catch(() => undefined), wait(3_000)]);
    if (this.liveRuntime === runtime) this.liveRuntime = null;
  }

  private createLivePermissionHandler(activeTurn: () => ClaudeLiveTurn | null): CanUseTool {
    return async (toolName, input, options) => {
      const turn = activeTurn();
      if (!turn) {
        return {
          behavior: 'deny',
          message: 'The tool request no longer belongs to an active Agent turn.',
          interrupt: false,
          toolUseID: options.toolUseID,
        };
      }
      return this.createPermissionHandler(turn.interactions, turn.tools)(toolName, input, options);
    };
  }

  private async loadSDK() {
    try {
      this.sdk = await import('@anthropic-ai/claude-agent-sdk');
      this.lastError = null;
      return true;
    } catch (error) {
      this.sdk = null;
      this.lastError = toErrorMessage(error);
      return false;
    }
  }

  private async prepareRuntime(settings: ReturnType<typeof agentSettingsService.getClaudeSettings>, projectId?: string) {
    this.runtime = null;
    this.preparedRuntimeSettingsKey = null;
    const sdkAvailable = await this.loadSDK();
    if (!sdkAvailable) return false;
    try {
      const runtime = await resolveClaudeRuntime(settings, { projectId });
      if (!runtime.executablePath) {
        this.lastError = runtime.error ?? runtime.installGuidance;
        return false;
      }
      if (settings.executionMode === 'wsl') {
        const validation = await validateWslClaudeExecutable(settings, runtime.executablePath, runtime.environment);
        if (!validation.ok) {
          this.lastError = `${validation.error}. ${runtime.installGuidance}`;
          this.runtime = { ...runtime, executablePath: null, error: this.lastError };
          return false;
        }
      }
      this.runtime = runtime;
      this.preparedRuntimeSettingsKey = runtimeSettingsKey(settings);
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = toErrorMessage(error);
      return false;
    }
  }

  private async discoverCommands(input: AgentCommandDiscoveryInput, cacheKey: string) {
    if (!this.sdk) throw new AgentBackendError('Claude Agent SDK is unavailable', this.id, 'unavailable');
    const discovery = this.createDiscoveryQuery(input);
    try {
      const commands = await discovery.query.supportedCommands();
      if (discovery.abortController.signal.aborted) {
        throw new AgentBackendError('Timed out while discovering Claude slash commands', this.id, 'runtime');
      }
      return this.cacheCommands(cacheKey, commands);
    } finally {
      discovery.close();
    }
  }

  private createDiscoveryQuery(input: AgentCommandDiscoveryInput) {
    if (!this.sdk) throw new AgentBackendError('Claude Agent SDK is unavailable', this.id, 'unavailable');
    const settings = agentSettingsService.getClaudeSettings();
    const runtime = this.runtime;
    if (!runtime?.executablePath) {
      throw new AgentBackendError(this.lastError ?? 'Claude Code is not installed', this.id, 'unavailable');
    }
    const runtimeSettings = { ...settings, claudeExecutable: runtime.executablePath };
    const isWsl = settings.executionMode === 'wsl';
    const sdkCwd = isWsl
      ? windowsPathToWsl(input.cwd, settings.wslDistribution)
      : input.cwd;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), COMMAND_DISCOVERY_TIMEOUT_MS);
    timeout.unref?.();
    const query = this.sdk.query({
      prompt: idlePrompt(abortController.signal),
      options: {
        abortController,
        cwd: sdkCwd,
        additionalDirectories: input.additionalDirectories,
        pathToClaudeCodeExecutable: runtime.executablePath,
        spawnClaudeCodeProcess: isWsl
          ? (options) => spawnClaudeCodeInWsl(options, runtimeSettings)
          : undefined,
        persistSession: false,
        settingSources: requiredSettingSources(settings.settingSources),
        env: runtime.environment,
      },
    });
    return {
      query,
      abortController,
      close: () => {
        clearTimeout(timeout);
        abortController.abort();
        query.close();
      },
    };
  }

  private cacheCommands(cacheKey: string, commands: unknown) {
    const normalized = normalizeAgentSlashCommands(commands);
    this.commandCache.set(cacheKey, normalized);
    return normalized;
  }

  private commandCacheKey(cwd: string, additionalDirectories?: string[]) {
    return JSON.stringify([this.fingerprint(), cwd, additionalDirectories ?? []]);
  }

  private captureSessionMetadata(message: SDKMessage) {
    if (message.type !== 'system' || message.subtype !== 'init') return;
    this.model = message.model;
    this.authenticated = true;
  }

  private createPermissionHandler(
    interactions: AgentInteractionHandler,
    definitions: AgentToolDefinition[],
  ): CanUseTool {
    return async (toolName, input, options): Promise<PermissionResult> => {
      if (toolName === 'AskUserQuestion') {
        const questions = parseAskUserQuestionInput(input);
        const answers = await interactions.requestAnswers({
          toolName,
          input,
          toolUseId: options.toolUseID,
          signal: options.signal,
          questions,
          agentId: options.agentID,
        });
        return {
          behavior: 'allow',
          updatedInput: buildAskUserQuestionUpdatedInput(input, questions, answers),
          toolUseID: options.toolUseID,
        };
      }
      if (isSubagentSpawnTool(toolName)) {
        return {
          behavior: 'allow',
          updatedInput: input,
          toolUseID: options.toolUseID,
        };
      }
      const decision = await interactions.authorizeTool({
        toolName,
        riskLevel: resolveClaudeToolRisk(toolName, definitions),
        input,
        toolUseId: options.toolUseID,
        signal: options.signal,
        agentId: options.agentID,
      });
      if (decision.behavior === 'allow') {
        return {
          behavior: 'allow',
          updatedInput: decision.updatedInput ?? input,
          toolUseID: options.toolUseID,
          decisionClassification: decision.decisionClassification,
        };
      }
      return {
        behavior: 'deny',
        message: decision.message ?? 'The tool action was denied.',
        interrupt: decision.interrupt,
        toolUseID: options.toolUseID,
        decisionClassification: decision.decisionClassification,
      };
    };
  }
}

function runtimeSettingsKey(settings: ReturnType<typeof agentSettingsService.getClaudeSettings>, projectId?: string) {
  return JSON.stringify([
    settings.executionMode,
    settings.wslDistribution,
    settings.claudeExecutable,
    projectId ?? '',
  ]);
}

async function* idlePrompt(signal: AbortSignal): AsyncGenerator<SDKUserMessage, void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function liveRuntimeKey(input: AgentRunInput, fingerprint: string) {
  const toolCatalog = input.tools.map((tool) => [tool.name, tool.description, tool.riskLevel]);
  return [
    input.projectId ?? '',
    input.conversationId,
    fingerprint,
    input.cwd,
    JSON.stringify(input.additionalDirectories ?? []),
    input.model ?? '',
    JSON.stringify(input.settingSources ?? []),
    input.systemInstructions,
    JSON.stringify(toolCatalog),
  ].join('\u0000');
}

function createDynamicContextHook(activeTurn: () => ClaudeLiveTurn | null): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'UserPromptSubmit') return {};
    const context = activeTurn()?.dynamicSystemContext?.trim();
    if (!context) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    };
  };
}

function resolveClaudeToolRisk(toolName: string, definitions: AgentToolDefinition[]) {
  const neutralName = toolName.replace(/^mcp__hexestra__/, '');
  const definition = definitions.find((candidate) => candidate.name === neutralName);
  if (definition) return definition.riskLevel;
  return CLAUDE_READ_ONLY_BUILTINS.has(toolName)
    ? 'read' as const
    : 'write' as const;
}

function requiredSettingSources(sources: readonly ('user' | 'project' | 'local')[]) {
  return [...new Set([...sources, 'project' as const, 'local' as const])];
}

function createManagedRecordGuard(): HookCallback {
  return async (input) => {
    const typed = input as PreToolUseHookInput;
    if (isManagedRecordFileMutation(typed.tool_name, typed.tool_input as Record<string, unknown>)) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Findings, vulnerabilities, evidence, and reports are Hexestra-managed records. Use their Hexestra tools instead of writing files.',
        },
      };
    }
    return { continue: true };
  };
}

class AsyncPushQueue<T> implements AsyncIterableIterator<T> {
  private readonly values: T[] = [];
  private waiter: {
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  } | null = null;
  private ended = false;
  private failure: unknown;

  push(value: T) {
    if (this.ended || this.failure !== undefined) return;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.resolve({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.resolve({ done: true, value: undefined });
    }
  }

  fail(error: unknown) {
    if (this.ended || this.failure !== undefined) return;
    this.failure = error;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.reject(error);
    }
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve({ done: true, value: undefined });
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  return(): Promise<IteratorResult<T>> {
    this.end();
    return Promise.resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
