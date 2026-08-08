import fs from 'fs';
import type {
  CanUseTool,
  HookCallback,
  PermissionResult,
  PreToolUseHookInput,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  AgentBackendError,
  CLAUDE_BACKEND_ID,
  type AgentAdapter,
  type AgentBackendCapabilities,
  type AgentBackendStatus,
  type AgentInteractionHandler,
  type AgentRunEvent,
  type AgentRunInput,
} from '../../contracts/agent-runtime';
import {
  buildAskUserQuestionUpdatedInput,
  parseAskUserQuestionInput,
} from '../../agent-interaction-contract';
import { installHexestraSkills } from '../pentest-skill';
import { isAgentAuthenticationError } from '../agent-error';
import {
  agentConnectionFingerprint,
  agentSettingsService,
} from '../agent-settings.service';
import { spawnClaudeCodeInWsl, windowsPathToWsl } from '../wsl-agent-runtime';
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
const CLAUDE_READ_ONLY_BUILTINS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch', 'NotebookRead',
]);

const capabilities: AgentBackendCapabilities = {
  branching: 'message',
  subagents: true,
  attachments: ['text', 'image', 'pdf', 'file'],
  tools: true,
  interactiveQuestions: true,
};

export class ClaudeAgentAdapter implements AgentAdapter {
  readonly id = CLAUDE_BACKEND_ID;
  readonly capabilities = capabilities;

  private sdk: AgentSdk | null = null;
  private initialization: Promise<boolean> | null = null;
  private authenticated: boolean | null = null;
  private model: string | null = null;
  private lastError: string | null = null;

  async initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = this.loadSDK();
    return this.initialization;
  }

  fingerprint() {
    return `${agentConnectionFingerprint(agentSettingsService.getClaudeSettings())}:${AGENT_CONTEXT_VERSION}`;
  }

  status(): AgentBackendStatus {
    const settings = agentSettingsService.getClaudeSettings();
    return {
      available: this.sdk !== null,
      authenticated: this.authenticated,
      model: this.model ?? settings.model,
      lastError: this.lastError,
      runtimeMode: settings.executionMode,
      runtimeLabel: settings.executionMode === 'wsl'
        ? `WSL 路 ${settings.wslDistribution}`
        : 'Native',
    };
  }

  async *runTurn(
    input: AgentRunInput,
    interactions: AgentInteractionHandler,
  ): AsyncIterable<AgentRunEvent> {
    const available = await this.initialize();
    if (!available || !this.sdk) {
      throw new AgentBackendError(
        this.lastError ?? 'Claude Agent SDK is unavailable',
        this.id,
        'unavailable',
      );
    }

    const settings = agentSettingsService.getClaudeSettings();
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
        prompt: buildAgentSdkPrompt(input.prompt, input.attachments),
        options: {
          abortController,
          cwd: sdkCwd,
          additionalDirectories: input.additionalDirectories,
          pathToClaudeCodeExecutable: settings.claudeExecutable || undefined,
          spawnClaudeCodeProcess: isWsl
            ? (options) => spawnClaudeCodeInWsl(options, settings)
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
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: undefined,
          },
          stderr: (data) => {
            const line = data.trim();
            if (line) console.warn('[Agent] Claude stderr:', line);
          },
        },
      });

      for await (const message of query) {
        this.captureSessionMetadata(message);
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
