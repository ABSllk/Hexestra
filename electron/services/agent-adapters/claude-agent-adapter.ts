import fs from 'fs';
import type {
  CanUseTool,
  HookCallback,
  PermissionResult,
  PreToolUseHookInput,
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
import {
  buildAgentSdkPrompt,
} from '../agent-attachment';
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
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Findings, vulnerabilities, evidence, and reports are Hexestra-managed records. Use their Hexestra tools instead of writing files.',
      };
    }
    return { continue: true };
  };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
