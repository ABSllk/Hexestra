import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import fs from 'fs';
import crypto from 'crypto';
import { sessionService } from './session.service';
import { shellService } from './shell.service';
import {
  normalizeAgentMode,
  resolvePermissionDisposition,
  type SupportedAgentMode,
} from './agent-mode';
import { formatAgentFailure } from './agent-error';
import type { AgentActivity } from '../contracts/agent-runtime';
import type { WorkflowInvocation } from '../contracts/workflows';
import type { TaskContextPackage } from '../contracts/tasks';
import type { ToolCatalogIndexEntry } from '../contracts/tool-catalog';
import { agentSettingsService } from './agent-settings.service';
import {
  createConversationBranch,
  mergeAuthoritativeBranchFocus,
  type PersistedConversationBranch,
  type PersistedChatMessage,
} from './project-state';
import {
  resolveBranchResumeOptions,
  type BranchResumeOptions,
} from './conversation-branch';
import { buildSystemInstructions } from './agent-system-instructions';
import {
  buildAgentDynamicSystemContext,
  buildAgentUserPrompt,
  type AgentProjectSystemContext,
} from './agent-prompt-context';
import {
  AgentHistoryRepository,
  DEFAULT_HISTORY_ACTIVITY_BUDGET,
  DEFAULT_HISTORY_MESSAGE_LIMIT,
  HISTORY_ACTIVITY_PAGE_LIMIT,
} from './agent-history.repository';
import type { SubagentRun } from '../agent-subagent-contract';
import {
  buildAskUserQuestionUpdatedInput,
  type AskUserQuestion,
  type AskUserQuestionAnswers,
} from '../agent-interaction-contract';
import {
  attachmentMetadata,
  type AgentAttachment,
  type AgentAttachmentPicker,
} from '../agent-attachment-contract';
import {
  ATTACHMENT_DIALOG_FILTERS,
  readAgentAttachment,
} from './agent-attachment';
import { normalizeAgentContextRefs, type AgentContextRef } from '../agent-context-contract';
import {
  type AgentSlashCommandDescriptor,
  type AgentCommandsChangedPayload,
} from '../agent-command-contract';
import { createHexestraAgentTools } from './agent-tools';
import { isSubagentSpawnTool, isTaskGuardedTool, sanitizeAgentToolInputForDisplay } from './agent-tool-policy';
import { ClaudeAgentAdapter } from './agent-adapters/claude-agent-adapter';
import { KnowledgeRefineryService, refineryInvocation } from './knowledge-refinery.service';
import { buildAgentDistillPrompt, resolveAgentInputCommand } from './agent-distill';
import { AgentAdapterRegistry } from './agent-adapters/registry';
import { AgentStreamScheduler } from './agent-stream-scheduler';
import { acquireProjectRuntimeLease, releaseProjectRuntimeLease } from './project-runtime-lease';
import { listEnabledToolCatalog } from './tool-catalog.service';
import {
  CLAUDE_BACKEND_ID,
  type AgentInteractionHandler,
  type AgentToolPermissionDecision,
  type AgentToolPermissionRequest,
  type AgentState,
  type AgentStatus,
  type AgentBackendId,
  AgentBackendError,
  type AgentAttentionItem,
  type AgentAttentionInteraction,
  type AgentConversationHandle,
  type AgentRunEvent,
  type AgentRunInput,
} from '../contracts/agent-runtime';

type AutonomyLevel = 'low' | 'medium' | 'high';
const LIVE_PERSIST_INTERVAL_MS = 1_000;

interface SharedTabContext {
  tabId: string;
  title: string;
  type: 'terminal' | 'editor' | 'browser' | 'traffic' | 'replay' | 'report' | 'record';
  contentPreview: string;
}

interface AgentRequest {
  content: string;
  clientMessageId?: string;
  autonomyLevel?: AutonomyLevel;
  permissionMode?: SupportedAgentMode;
  session?: {
    id: string;
    name: string;
    scope?: {
      mode: 'whitelist' | 'blacklist';
      allowRules: string[];
      excludeRules: string[];
    };
  };
  selectedTarget?: {
    id: string;
    label: string;
    ip?: string;
    hostname?: string;
    type?: string;
    key?: string;
    properties?: Record<string, string | number | boolean | string[]>;
    status: string;
    portCount: number;
    vulnCount: number;
    ports?: Array<{ port: number; protocol: string; state: string; service?: string; version?: string }>;
    services?: Array<{ port: number; protocol: string; name: string; version?: string }>;
    os?: string;
    domains?: string[];
    tags?: string[];
    aiSummary?: string;
    relationships?: Array<{
      id: string;
      source: string;
      target: string;
      type: string;
      label?: string;
      metadata?: Record<string, string>;
    }>;
    neighbors?: Array<{
      id: string;
      label: string;
      ip?: string;
      hostname?: string;
      status: string;
      relation: string;
      direction: 'outbound' | 'inbound';
      portCount: number;
      vulnCount: number;
    }>;
    pathFromLocal?: Array<{ id: string; label: string; ip?: string }>;
  };
  tasks?: Array<{
    id: string;
    primaryTacticId: string;
    techniqueIds: string[];
    title: string;
    status: string;
  }>;
  contextTabs?: SharedTabContext[];
  attachments?: AgentAttachment[];
  contextRefs?: AgentContextRef[];
  workflowInvocation?: WorkflowInvocation;
}

interface AgentBranchRequest {
  sourceMessageId: string;
  newBranchId: string;
  request: AgentRequest;
}

interface PendingPermission {
  resolve: (result: AgentToolPermissionDecision) => void;
  webContentsId: number;
  kind: 'tool_approval' | 'ask_user_question';
  input: Record<string, unknown>;
  toolUseId: string;
  questions?: AskUserQuestion[];
  agentId?: string;
  subagentRunId?: string;
  agentType?: string;
  projectId?: string;
  branchId?: string;
}

interface QueuedAgentRequest {
  sender: WebContents;
  request: AgentRequest;
  messageId: string;
}

class AgentService {
  private readonly adapterRegistry = new AgentAdapterRegistry();
  private readonly claudeAdapter = new ClaudeAgentAdapter();
  private readonly refineryService: KnowledgeRefineryService;
  private chatHistory: PersistedChatMessage[] = [];
  private branches: PersistedConversationBranch[] = [];
  private activeBranchId = 'main';
  private pendingPermissions = new Map<string, PendingPermission>();
  private abortController: AbortController | null = null;
  private backendSessionId: string | null = null;
  private connectionFingerprint: string | null = null;
  private state: AgentState = 'loading';
  private authenticated: boolean | null = null;
  private model: string | null = null;
  private lastError: string | null = null;
  private requestCounter = 0;
  private activeSessionId: string | null = null;
  private subagentRuns: SubagentRun[] = [];
  private historyRepository: AgentHistoryRepository | null = null;
  private subagentPersistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Fallback queues are isolated by the full project/branch runtime key. */
  private readonly queuedRequests = new Map<string, QueuedAgentRequest[]>();
  /** A running turn is scoped to one project/branch; abortController is only the foreground alias. */
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly attentionItems = new Map<string, AgentAttentionItem>();
  private readonly conversationHandles = new Map<string, AgentConversationHandle>();
  private readonly conversationReaders = new Set<string>();
  private readonly runtimeSubagentRuns = new Map<string, Map<string, SubagentRun>>();
  private readonly readerOwnedTurnIds = new Map<string, Set<string>>();

  constructor() {
    this.adapterRegistry.register(this.claudeAdapter);
    this.refineryService = new KnowledgeRefineryService({
      analyze: (input) => this.claudeAdapter.distillKnowledge(input),
      isMainAgentBusy: () => this.activeRuns.size > 0,
      modelSnapshot: () => this.claudeAdapter.status().model ?? agentSettingsService.getClaudeSettings().model ?? 'Current Agent',
    });
    agentSettingsService.setRuntimeGuard(() => this.activeRuns.size > 0);
    this.registerHandlers();
  }

  async initialize() {
    const adapter = this.adapterRegistry.require(CLAUDE_BACKEND_ID);
    const available = await adapter.initialize();
    this.setState(available ? 'ready' : 'error');
    return available;
  }

  private registerHandlers() {
    ipcMain.handle('agent:activate', async (_event, sessionId: string) => {
      return this.activateProject(sessionId);
    });

    ipcMain.handle('agent:send', async (event, request: AgentRequest | string) => {
      const normalized: AgentRequest =
        typeof request === 'string' ? { content: request } : request;
      return this.sendMessage(event.sender, normalized);
    });

    ipcMain.handle('agent:commands:list', async (_event, sessionId?: string | null) => {
      return this.listCommands(sessionId ?? undefined);
    });

    ipcMain.handle('claude:mcp:status', async (_event, sessionId?: string | null) => {
      return this.claudeAdapter.listMcpServerStatuses(this.discoveryInput(sessionId ?? undefined));
    });

    ipcMain.handle('restrictions:classify', async (_event, sessionId: string, text: string) => {
      if (typeof text !== 'string' || !text.trim()) throw new Error('请输入需要分类的规则');
      const cwd = sessionService.getSessionPath(sessionId);
      return this.claudeAdapter.classifyRestriction({ text, cwd, projectId: sessionId });
    });

    ipcMain.handle('agent:attachments:pick', async (_event, picker: AgentAttachmentPicker) => {
      if (picker !== 'files' && picker !== 'images') throw new Error('Invalid attachment picker');
      const result = await dialog.showOpenDialog({
        title: picker === 'images' ? 'Attach images to Claude' : 'Attach files to Claude',
        buttonLabel: 'Attach',
        properties: ['openFile', 'multiSelections'],
        filters: ATTACHMENT_DIALOG_FILTERS[picker],
      });
      if (result.canceled) return [];
      return result.filePaths.slice(0, 8).map(readAgentAttachment);
    });

    ipcMain.handle('agent:branch', async (event, input: AgentBranchRequest) => {
      return this.branchFromMessage(event.sender, input);
    });

    ipcMain.handle(
      'agent:branch:activate',
      async (_event, sessionId: string, branchId: string) =>
        this.activateConversationBranch(sessionId, branchId),
    );

    ipcMain.handle(
      'agent:conversation:new',
      async (_event, sessionId: string, conversationId: string, backendId?: AgentBackendId) =>
        this.createConversation(sessionId, conversationId, backendId),
    );

    ipcMain.handle('agent:approve-tool', (event, requestId: string, projectId?: string, branchId?: string) => {
      this.resolvePermission(requestId, true, event.sender.id, projectId, branchId);
    });

    ipcMain.handle('agent:reject-tool', (event, requestId: string, projectId?: string, branchId?: string) => {
      this.resolvePermission(requestId, false, event.sender.id, projectId, branchId);
    });

    ipcMain.handle(
      'agent:answer-question',
      (event, requestId: string, answers: AskUserQuestionAnswers, projectId?: string, branchId?: string) => {
      this.answerUserQuestion(requestId, answers, event.sender.id, projectId, branchId);
      },
    );

    ipcMain.handle('agent:cancel', async (_event, sessionId?: string) => {
      if (sessionId && sessionId !== this.activeSessionId) return;
      await this.stopActiveRequest();
      this.setState(this.activeRuntimeIsRunning()
        ? 'running'
        : this.activeBackendAvailable() ? 'ready' : 'error');
    });

    ipcMain.handle('agent:clear', async (_event, sessionId?: string) => {
      if (sessionId && sessionId !== this.activeSessionId) await this.activateProject(sessionId);
      await this.stopActiveRequest();
      await this.disposeActiveConversationRuntime();
      this.chatHistory = [];
      this.backendSessionId = null;
      this.connectionFingerprint = null;
      const mainBranch = createConversationBranch('main', 'Main');
      this.branches = [mainBranch];
      this.activeBranchId = mainBranch.id;
      this.subagentRuns = [];
      this.historyRepository = sessionId ? sessionService.getAgentHistory(sessionId) : this.historyRepository;
      if (sessionId) sessionService.clearAgentHistory(sessionId);
      if (sessionId) this.refineryService.clearConversationJobs(sessionId);
      this.historyRepository?.ensureBranch(mainBranch);
      this.clearSubagentPersistTimer();
      this.lastError = null;
      this.persistAgentState();
      this.setState(this.activeBackendAvailable() ? 'ready' : 'loading');
    });

    ipcMain.handle('agent:history:page', (_event, sessionId: string, branchId: string, beforeCursor?: string | null) => {
      return sessionService.getAgentHistory(sessionId).listMessages(
        branchId,
        beforeCursor,
        DEFAULT_HISTORY_MESSAGE_LIMIT,
        DEFAULT_HISTORY_ACTIVITY_BUDGET,
      );
    });
    ipcMain.handle('agent:history:activities', (_event, sessionId: string, branchId: string, messageId: string, beforeCursor?: string | null) => {
      return sessionService.getAgentHistory(sessionId).listActivities(branchId, messageId, beforeCursor, HISTORY_ACTIVITY_PAGE_LIMIT);
    });
    ipcMain.handle('agent:subagent:detail', (_event, sessionId: string, branchId: string, runId: string, beforeCursor?: string | null) => {
      return sessionService.getAgentHistory(sessionId).getSubagentDetail(branchId, runId, beforeCursor, HISTORY_ACTIVITY_PAGE_LIMIT);
    });
    ipcMain.handle('agent:status', (_event, sessionId?: string) => this.getStatus(sessionId));
    ipcMain.handle('agent:attention:list', () => [...this.attentionItems.values()]);
    ipcMain.handle('agent:attention:read', (_event, itemId: string) => {
      const item = this.attentionItems.get(itemId);
      if (item) item.read = true;
      return item ?? null;
    });
    ipcMain.handle('agent:attention:clear', (_event, itemId: string) => this.attentionItems.delete(itemId));
    ipcMain.handle('refinery:jobs:create-from-conversation', async (event, sessionId: string, branchId: string) => {
      if (sessionId !== this.activeSessionId) await this.activateProject(sessionId);
      const job = this.refineryService.createJobFromConversation(sessionId, branchId);
      if (branchId === this.activeBranchId) this.appendRefineryInvocation(event.sender, refineryInvocation(job));
      return job;
    });
  }

  private async listCommands(sessionId?: string) {
    const stored = sessionId ? sessionService.getProjectState(sessionId).agent : null;
    const backendId = stored?.branches.find((branch) => branch.id === stored.activeBranchId)?.backendId
      ?? this.branches.find((branch) => branch.id === this.activeBranchId)?.backendId
      ?? CLAUDE_BACKEND_ID;
    const adapter = this.adapterRegistry.require(backendId);
    if (!adapter.capabilities.slashCommands || !adapter.listCommands) return [];
    return adapter.listCommands(this.discoveryInput(sessionId));
  }

  private discoveryInput(sessionId?: string) {
    const sessionPath = sessionId ? sessionService.getSessionPath(sessionId) : null;
    const cwd = sessionPath && fs.existsSync(sessionPath) ? sessionPath : process.cwd();
    return {
      cwd,
      additionalDirectories: sessionPath && fs.existsSync(sessionPath) ? [sessionPath] : undefined,
      settingSources: agentSettingsService.getClaudeSettings().settingSources,
      projectId: sessionId,
    };
  }

  private async activateProject(sessionId: string) {
    const previousSessionId = this.activeSessionId;
    if (this.activeSessionId !== sessionId) {
      // A live runtime is session-scoped. Foreground activation changes the
      // projection but must not terminate a pinned background conversation.
    }
    if (previousSessionId && previousSessionId !== sessionId && !this.claudeAdapter.hasPinnedRuntimeForProject(previousSessionId)) {
      shellService.destroyProject(previousSessionId);
    }
    return this.loadProject(sessionId);
  }

  private async stopActiveRequest() {
    const runtimeKey = this.activeRuntimeKey();
    const controller = this.activeRuns.get(runtimeKey);
    const projectId = this.activeSessionId ?? undefined;
    const branchId = this.activeBranchId;
    if (controller) {
      controller.abort();
      this.resolvePermissionsForRuntime(projectId, branchId, false);
      // Abort only requests the provider interrupt. Do not report cancellation
      // as complete until the owning run has processed Claude's response and
      // removed itself from the runtime registry.
      await this.waitForActiveRequest(runtimeKey, controller);
      return;
    }
    const handle = this.conversationHandles.get(runtimeKey);
    if (handle?.snapshot().active) {
      await handle.interrupt();
      this.resolvePermissionsForRuntime(projectId, branchId, false);
    }
  }

  private async disposeActiveConversationRuntime() {
    const branch = this.branches.find((candidate) => candidate.id === this.activeBranchId);
    if (!branch) return;
    if (this.activeSessionId && branch.backendId === CLAUDE_BACKEND_ID
      && this.claudeAdapter.hasPinnedRuntimeForConversation(this.activeSessionId, branch.id)) {
      return;
    }
    const adapter = this.adapterRegistry.get(branch.backendId);
    await adapter?.disposeConversation?.(this.activeSessionId ?? undefined, branch.id);
  }

  private loadProject(sessionId: string) {
    this.clearSubagentPersistTimer();
    const project = sessionService.getProjectState(sessionId);
    this.activeSessionId = sessionId;
    this.historyRepository = sessionService.getAgentHistory(sessionId);
    this.historyRepository.ensureBranches(project.agent.branches);
    this.branches = project.agent.branches.map(cloneBranch);
    this.activeBranchId = project.agent.activeBranchId;
    this.hydrateActiveBranch();
    this.abortController = this.activeRuns.get(this.activeRuntimeKey()) ?? null;
    this.model = project.agent.model;
    this.lastError = project.agent.lastError;
    this.state = this.activeRuntimeIsRunning()
      ? 'running'
      : this.activeBackendAvailable() ? 'ready' : 'loading';
    const status = this.getStatus(sessionId);
    this.emitStatus();
    return this.buildActivation(sessionId, status, project.preferences, project.workspace);
  }

  private waitForActiveRequest(runtimeKey: string, controller: AbortController) {
    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 10_000;
      const check = () => {
        if (this.activeRuns.get(runtimeKey) !== controller) resolve();
        else if (Date.now() >= deadline) {
          reject(new Error('Timed out while stopping the previous engagement request'));
        } else setTimeout(check, 25);
      };
      check();
    });
  }

  private persistAgentState() {
    if (!this.activeSessionId) return;
    this.syncActiveBranchMetadata();
    const authoritativeBranches = sessionService.getProjectState(this.activeSessionId).agent.branches;
    this.branches = mergeAuthoritativeBranchFocus(this.branches, authoritativeBranches);
    sessionService.updateProjectState(this.activeSessionId, {
      agent: {
        model: this.model,
        lastError: this.lastError,
        activeBranchId: this.activeBranchId,
        branches: this.branches,
      },
    });
  }

  private persistBranchRuntime(projectId: string | undefined, branchId: string, sessionId: string | null, connectionFingerprint = this.connectionFingerprint) {
    if (!projectId) return;
    const state = sessionService.getProjectState(projectId);
    const branch = state.agent.branches.find((candidate) => candidate.id === branchId);
    if (!branch) return;
    sessionService.updateProjectState(projectId, {
      agent: {
        branches: state.agent.branches.map((candidate) => candidate.id === branchId
          ? {
              ...candidate,
              runtime: {
                backendId: candidate.backendId,
                sessionId,
                connectionFingerprint,
              },
            }
          : candidate),
      },
    });
  }

  private syncActiveBranchMetadata() {
    const branch = this.branches.find((candidate) => candidate.id === this.activeBranchId);
    if (!branch || !this.historyRepository) return;
    branch.history = this.historyRepository.getBranchStats(branch.id);
    branch.runtime = this.backendSessionId || this.connectionFingerprint
      ? {
          backendId: branch.backendId,
          sessionId: this.backendSessionId,
          connectionFingerprint: this.connectionFingerprint,
        }
      : null;
  }

  private hydrateActiveBranch() {
    const branch = this.branches.find((candidate) => candidate.id === this.activeBranchId)
      ?? this.branches[0]
      ?? createConversationBranch('main', 'Main');
    if (!this.branches.some((candidate) => candidate.id === branch.id)) {
      this.branches = [branch];
    }
    this.activeBranchId = branch.id;
    const hasLiveClaudeRuntime = this.activeSessionId
      ? this.claudeAdapter.hasLiveRuntimeForConversation(this.activeSessionId, branch.id)
      : false;
    const persistedMessages = hasLiveClaudeRuntime
      ? this.historyRepository?.getMessages(branch.id) ?? []
      : this.historyRepository?.recoverAbandonedMessages(branch.id) ?? [];
    this.chatHistory = persistedMessages.map(cloneMessage);
    this.subagentRuns = this.historyRepository?.getSubagentRuns(branch.id).map(cloneSubagentRun) ?? [];
    const live = this.historyRepository?.recoverLive(branch.id);
    if (live?.message && !this.chatHistory.some((message) => message.id === live.message?.id)) {
      this.chatHistory.push({ ...live.message, status: 'interrupted' });
    }
    if (live?.subagentRuns?.length) {
      this.subagentRuns = mergeRuns(this.subagentRuns, live.subagentRuns).map(cloneSubagentRun);
    }
    this.backendSessionId = branch.runtime?.sessionId ?? null;
    this.connectionFingerprint = branch.runtime?.connectionFingerprint ?? null;
  }

  private getBranchSummaries() {
    return this.branches.map((branch) => ({
      id: branch.id,
      title: branch.title,
      parentBranchId: branch.parentBranchId,
      forkedFromMessageId: branch.forkedFromMessageId,
      backendId: branch.backendId,
      createdAt: branch.createdAt,
      messageCount: branch.history.messageCount,
      activityCount: branch.history.activityCount,
      subagentRunCount: branch.history.subagentRunCount,
    }));
  }

  private buildActivation(
    sessionId: string,
    status: AgentStatus,
    preferences: ReturnType<typeof sessionService.getProjectState>['preferences'],
    workspace: ReturnType<typeof sessionService.getProjectState>['workspace'],
  ) {
    const page = this.historyRepository?.listMessages(
      this.activeBranchId,
      null,
      DEFAULT_HISTORY_MESSAGE_LIMIT,
      DEFAULT_HISTORY_ACTIVITY_BUDGET,
    );
    const activeRealtimeMessage = this.chatHistory.at(-1);
    const pageItems = page?.items ?? [];
    const items = activeRealtimeMessage && (activeRealtimeMessage.status === 'queued' || activeRealtimeMessage.status === 'streaming' || activeRealtimeMessage.status === 'sending')
      ? [
          ...pageItems.filter((message) => message.id !== activeRealtimeMessage.id),
          cloneMessage(activeRealtimeMessage),
        ]
      : pageItems;
    return {
      sessionId,
      messages: items,
      history: page ? { ...page, items } : { items: [], beforeCursor: null, hasEarlier: false, total: 0, totalActivities: 0 },
      activeBranchId: this.activeBranchId,
      branches: this.getBranchSummaries(),
      subagentRuns: this.historyRepository?.listSubagentSummaries(this.activeBranchId) ?? [],
      status,
      preferences,
      workspace,
    };
  }

  private async activateConversationBranch(
    sessionId: string,
    branchId: string,
  ) {
    this.ensureActiveProject(sessionId);
    const branch = this.branches.find((candidate) => candidate.id === branchId);
    if (!branch) throw new Error(`Conversation branch ${branchId} not found`);
    if (branch.id !== this.activeBranchId) {
      if (!this.activeRuntimeIsRunning()) await this.disposeActiveConversationRuntime();
      this.syncActiveBranchMetadata();
      this.activeBranchId = branch.id;
      this.hydrateActiveBranch();
      this.abortController = this.activeRuns.get(this.activeRuntimeKey()) ?? null;
      this.state = this.activeRuntimeIsRunning()
        ? 'running'
        : this.activeBackendAvailable() ? 'ready' : 'loading';
      this.persistAgentState();
    }
    const project = sessionService.getProjectState(sessionId);
    return this.buildActivation(sessionId, this.getStatus(sessionId), project.preferences, project.workspace);
  }

  private async createConversation(
    sessionId: string,
    conversationId: string,
    backendId: AgentBackendId = CLAUDE_BACKEND_ID,
  ) {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(conversationId)) {
      throw new Error('Invalid conversation identifier');
    }
    this.ensureActiveProject(sessionId);
    if (this.branches.some((branch) => branch.id === conversationId)) {
      throw new Error(`Conversation ${conversationId} already exists`);
    }
    if (this.branches.length >= 50) {
      throw new Error('This project already has the maximum of 50 conversations');
    }
    this.adapterRegistry.require(backendId);

    const conversation = createConversationBranch(
      conversationId,
      `New conversation ${this.branches.length + 1}`,
      { backendId },
    );
    if (!this.activeRuntimeIsRunning()) await this.disposeActiveConversationRuntime();
    this.historyRepository?.ensureBranch(conversation);
    this.branches.push(conversation);
    this.activeBranchId = conversation.id;
    this.hydrateActiveBranch();
    this.abortController = this.activeRuns.get(this.activeRuntimeKey()) ?? null;
    this.state = this.activeRuntimeIsRunning()
      ? 'running'
      : this.activeBackendAvailable() ? 'ready' : 'loading';
    this.persistAgentState();

    const project = sessionService.getProjectState(sessionId);
    return this.buildActivation(sessionId, this.getStatus(sessionId), project.preferences, project.workspace);
  }

  private async branchFromMessage(sender: WebContents, input: AgentBranchRequest) {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(input.newBranchId)) {
      throw new Error('Invalid conversation branch identifier');
    }
    const sessionId = input.request.session?.id;
    if (!sessionId) throw new Error('No active engagement');
    this.ensureActiveProject(sessionId);
    if (this.branches.some((branch) => branch.id === input.newBranchId)) {
      throw new Error(`Conversation branch ${input.newBranchId} already exists`);
    }

    const sourceBranch = this.branches.find((branch) => branch.id === this.activeBranchId);
    if (!sourceBranch) throw new Error('Active conversation branch is missing');
    const sourceIndex = this.chatHistory.findIndex(
      (message) => message.id === input.sourceMessageId && message.role === 'user',
    );
    if (sourceIndex < 0) throw new Error(`User message ${input.sourceMessageId} not found`);
    const sourceMessage = this.chatHistory[sourceIndex];

    const sourceAdapter = this.adapterRegistry.get(sourceBranch.backendId);
    const currentFingerprint = sourceAdapter?.resolveFingerprint
      ? await sourceAdapter.resolveFingerprint(sessionId)
      : sourceAdapter?.fingerprint() ?? '';
    const resumeOptions = resolveBranchResumeOptions(
      this.chatHistory,
      sourceIndex,
      sourceBranch.runtime,
      currentFingerprint,
    );
    const canResume = resumeOptions.fork;

    const branch = createConversationBranch(
      input.newBranchId,
      branchTitle(input.request.content, this.branches.length + 1),
      {
        parentBranchId: sourceBranch.id,
        forkedFromMessageId: sourceMessage.id,
        backendId: sourceBranch.backendId,
        runtime: canResume
          ? {
              backendId: sourceBranch.backendId,
              sessionId: sourceBranch.runtime?.sessionId ?? null,
              connectionFingerprint: currentFingerprint,
            }
          : null,
      },
    );
    if (!this.activeRuntimeIsRunning()) await this.disposeActiveConversationRuntime();
    this.historyRepository?.createBranch(branch, sourceMessage.id);
    this.branches.push(branch);
    this.activeBranchId = branch.id;
    this.hydrateActiveBranch();
    this.persistAgentState();

    await this.sendMessage(sender, input.request, resumeOptions);
    const project = sessionService.getProjectState(sessionId);
    return this.buildActivation(sessionId, this.getStatus(sessionId), project.preferences, project.workspace);
  }

  private ensureActiveProject(sessionId?: string) {
    if (!sessionId) return;
    if (this.activeSessionId !== sessionId) this.loadProject(sessionId);
  }

  private async enqueueRequest(sender: WebContents, request: AgentRequest) {
    this.ensureActiveProject(request.session?.id);
    const branch = this.branches.find((candidate) => candidate.id === this.activeBranchId);
    if (!branch) throw new Error('Active conversation branch is missing');
    const projectId = request.session?.id ?? this.activeSessionId ?? undefined;
    const runtimeKey = this.runtimeKey(projectId, branch.id);
    const adapter = this.adapterRegistry.get(branch.backendId);
    const { nativeCommand } = resolveAgentInputCommand(request.content, adapter?.capabilities.slashCommands ?? false);
    const normalizedContextRefs = normalizeAgentContextRefs(request.contextRefs, projectId);
    if (nativeCommand && ((request.attachments?.length ?? 0) > 0 || normalizedContextRefs.length > 0)) {
      throw new Error('Slash commands cannot include attachments or staged context');
    }
    const messageId = request.clientMessageId ?? crypto.randomUUID();
    if (!this.chatHistory.some((message) => message.id === messageId)) {
      const message: PersistedChatMessage = {
        id: messageId,
        role: 'user',
        content: request.content,
        timestamp: new Date().toISOString(),
        status: 'complete',
        source: 'operator',
        ...(request.attachments?.length ? { attachments: request.attachments.map(attachmentMetadata) } : {}),
        ...(normalizedContextRefs.length ? { contextRefs: normalizedContextRefs } : {}),
        ...(request.workflowInvocation ? { workflowInvocation: request.workflowInvocation } : {}),
      };
      this.chatHistory.push(message);
      this.historyRepository?.appendMessage(this.activeBranchId, message);
      this.persistAgentState();
      this.emitMessage(sender, message);
    }
    const pending = this.queuedRequests.get(runtimeKey) ?? [];
    pending.push({ sender, request: { ...request, clientMessageId: messageId }, messageId });
    this.queuedRequests.set(runtimeKey, pending);
    const handle = this.conversationHandles.get(runtimeKey);
    if (handle) {
      // A queued input belongs to the next provider turn. It must never inherit
      // the AbortSignal of the currently running (or just-cancelled) turn.
      const input = await this.buildQueuedInput(sender, request, branch, messageId);
      await handle.enqueue({ id: messageId, source: 'operator', prompt: input.prompt, queuedAt: new Date().toISOString(), input });
      const queued = this.queuedRequests.get(runtimeKey) ?? [];
      const queuedIndex = queued.findIndex((item) => item.messageId === messageId);
      if (queuedIndex >= 0) queued.splice(queuedIndex, 1);
      if (queued.length === 0) this.queuedRequests.delete(runtimeKey);
    }
    this.emitStatus();
  }

  private async buildQueuedInput(
    sender: WebContents,
    request: AgentRequest,
    branch: PersistedConversationBranch,
    inputId: string,
  ): Promise<AgentRunInput> {
    const projectId = request.session?.id ?? this.activeSessionId ?? undefined;
    const sessionPath = projectId ? sessionService.getSessionPath(projectId) : null;
    const settings = agentSettingsService.getClaudeSettings();
    const permissionMode = normalizeAgentMode(request.permissionMode);
    const contextRefs = normalizeAgentContextRefs(request.contextRefs, projectId);
    const adapter = this.adapterRegistry.get(branch.backendId);
    const { nativeCommand } = resolveAgentInputCommand(request.content, adapter?.capabilities.slashCommands ?? false);
    const dynamicSystemContext = nativeCommand
      ? undefined
      : projectId
        ? await this.resolveRuntimeDynamicContext(projectId, branch.id, request.selectedTarget?.id)
        : buildAgentDynamicSystemContext({ toolCatalog: this.toolCatalogIndex() });
    return {
      conversationId: branch.id,
      inputId,
      source: 'operator',
      queuedAt: new Date().toISOString(),
      prompt: nativeCommand
        ?? buildAgentUserPrompt({ content: request.content, attachments: request.attachments, explicitContext: contextRefs }),
      command: nativeCommand ?? undefined,
      systemInstructions: buildSystemInstructions(),
      dynamicSystemContext,
      dynamicSystemContextProvider: !nativeCommand && projectId
        ? () => this.resolveRuntimeDynamicContext(projectId, branch.id, request.selectedTarget?.id)
        : undefined,
      signal: new AbortController().signal,
      attachments: request.attachments ?? [],
      cwd: sessionPath && fs.existsSync(sessionPath) ? sessionPath : process.cwd(),
      additionalDirectories: sessionPath && fs.existsSync(sessionPath) ? [sessionPath] : undefined,
      model: settings.model,
      permissionMode,
      runtime: branch.runtime,
      fork: false,
      settingSources: settings.settingSources,
      tools: this.createHexestraToolDefinitions(sender, projectId, branch.id, request.selectedTarget?.id, permissionMode),
      projectId,
    };
  }

  private async sendMessage(
    sender: WebContents,
    request: AgentRequest,
    resumeOptions: BranchResumeOptions = { fork: false },
  ) {
    if (!request.content.trim()) return;
    this.ensureActiveProject(request.session?.id);
    const contextRefs = normalizeAgentContextRefs(request.contextRefs, request.session?.id);
    const originProjectId = request.session?.id ?? this.activeSessionId;

    const activeBranch = this.branches.find((branch) => branch.id === this.activeBranchId);
    if (!activeBranch) throw new Error('Active conversation branch is missing');
    const originBranchId = activeBranch.id;
    const runtimeKey = this.runtimeKey(originProjectId ?? undefined, originBranchId);
    if (this.runtimeHasPendingWork(runtimeKey)) {
      await this.enqueueRequest(sender, request);
      return;
    }
    const originHistoryRepository = originProjectId ? sessionService.getAgentHistory(originProjectId) : this.historyRepository;
    const initialFocusedTaskId = activeBranch.focusedTaskId ?? undefined;
    const adapter = this.adapterRegistry.require(activeBranch.backendId);
    const available = await adapter.initialize(request.session?.id);
    if (!available) {
      throw new Error(adapter.status().lastError ?? `Agent backend is unavailable: ${adapter.id}`);
    }
    const { distillInvocation, nativeCommand: command } = resolveAgentInputCommand(
      request.content,
      adapter.capabilities.slashCommands,
    );
    if (command && ((request.attachments?.length ?? 0) > 0 || contextRefs.length > 0)) {
      throw new Error('Slash commands cannot include attachments or staged context');
    }

    const distillSource = distillInvocation?.kind === 'source'
      ? await this.refineryService.readSourceForAgent(distillInvocation.sourceId)
      : undefined;
    const effectiveContent = distillInvocation
      ? buildAgentDistillPrompt(distillInvocation, distillSource)
      : request.content;

    const currentFingerprint = adapter.resolveFingerprint
      ? await adapter.resolveFingerprint(request.session?.id)
      : adapter.fingerprint();
    if (this.connectionFingerprint !== currentFingerprint) {
      this.backendSessionId = null;
      this.connectionFingerprint = currentFingerprint;
    }
    const originBackendSessionId = this.backendSessionId;
    const originConnectionFingerprint = this.connectionFingerprint;

    const userMessageId = request.clientMessageId ?? crypto.randomUUID();
    if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId && this.chatHistory.length === 0) {
      const activeConversation = this.branches.find(
        (branch) => branch.id === this.activeBranchId,
      );
      if (activeConversation) {
        activeConversation.title = branchTitle(request.content, this.branches.length);
      }
    }
    if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.lastError = null;
    const existingUserMessage = this.chatHistory.find((message) => message.id === userMessageId);
    const userMessage: PersistedChatMessage = existingUserMessage
      ? { ...existingUserMessage, status: 'complete', source: existingUserMessage.source ?? 'operator' }
      : {
          id: userMessageId,
          role: 'user',
          content: request.content,
          timestamp: new Date().toISOString(),
          status: 'complete',
          source: 'operator',
          ...(request.attachments?.length
            ? { attachments: request.attachments.map(attachmentMetadata) }
            : {}),
          ...(contextRefs.length ? { contextRefs } : {}),
          ...(request.workflowInvocation ? { workflowInvocation: request.workflowInvocation } : {}),
        };
    if (existingUserMessage) {
      const index = this.chatHistory.findIndex((message) => message.id === userMessageId);
      if (index >= 0) this.chatHistory[index] = userMessage;
    } else if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) {
      this.chatHistory.push(userMessage);
    }
    originHistoryRepository?.appendMessage(originBranchId, userMessage);
    if (existingUserMessage) this.emitMessage(sender, userMessage);
    if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.persistAgentState();
    if (originProjectId) acquireProjectRuntimeLease(originProjectId);
    const runController = new AbortController();
    this.activeRuns.set(runtimeKey, runController);
    if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) {
      this.abortController = runController;
      this.setState('running');
    }

    const messageId = `msg-${Date.now()}`;
    let latestContent = '';
    let latestActivities: AgentActivity[] = [];
    const activityTaskBindings = new Map<string, string>();
    const transitionedTaskIds = new Set<string>();
    let completedEvent: Extract<import('../contracts/agent-runtime').AgentRunEvent, { type: 'turn_completed' }> | undefined;
    let completionPersisted = false;
    const streamScheduler = new AgentStreamScheduler();
    const pendingSubagentRunIds = new Set<string>();
    const runSubagentRuns = new Map<string, SubagentRun>();
    this.runtimeSubagentRuns.set(runtimeKey, runSubagentRuns);
    let mainProjectionDirty = false;
    let lastLivePersistedAt = 0;
    const publishPendingProjection = (subagentRuns: Map<string, SubagentRun> = runSubagentRuns) => {
      if (mainProjectionDirty) {
        mainProjectionDirty = false;
        this.emitStreamingMessage(sender, messageId, latestContent, latestActivities, originProjectId, originBranchId);
      }
      if (pendingSubagentRunIds.size > 0) {
        this.emitSubagentUpdates(sender, pendingSubagentRunIds, originProjectId, originBranchId, subagentRuns);
        pendingSubagentRunIds.clear();
      }
    };
    const persistLiveSnapshotIfDue = () => {
      const now = Date.now();
      if (lastLivePersistedAt > 0 && now - lastLivePersistedAt < LIVE_PERSIST_INTERVAL_MS) return;
      originHistoryRepository?.writeLive(originBranchId, {
        id: messageId,
        role: 'assistant',
        content: latestContent,
        timestamp: new Date().toISOString(),
        status: 'streaming',
        activities: latestActivities,
      }, [...runSubagentRuns.values()]);
      lastLivePersistedAt = now;
    };
    const persistCompletion = (event: Extract<AgentRunEvent, { type: 'turn_completed' }>) => {
      if (completionPersisted) return;
      completionPersisted = true;
      if (!event.content.trim() && latestActivities.length === 0) return;
      const finalMessage: PersistedChatMessage = {
        id: messageId,
        role: 'assistant',
        content: event.content,
        timestamp: new Date().toISOString(),
        status: 'complete',
        activities: latestActivities,
        backendMessageId: event.backendMessageId,
      };
      if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.chatHistory.push(finalMessage);
      originHistoryRepository?.appendMessage(originBranchId, finalMessage);
      originHistoryRepository?.clearLive(originBranchId);
      if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.persistAgentState();
      this.emitMessage(sender, finalMessage, originProjectId, originBranchId);
      if (originProjectId && (originProjectId !== this.activeSessionId || originBranchId !== this.activeBranchId)) {
        this.publishAttention({
          id: `attention-${messageId}`,
          projectId: originProjectId,
          branchId: originBranchId,
          kind: 'completed',
          title: 'Agent turn completed',
          createdAt: new Date().toISOString(),
          read: false,
        });
      }
    };

    const sessionPath = request.session?.id
      ? sessionService.getSessionPath(request.session.id)
      : null;
    const permissionMode = normalizeAgentMode(request.permissionMode);
    const interactions = this.createInteractionHandler(
      sender,
      request.autonomyLevel ?? 'medium',
      permissionMode,
      originProjectId,
      originBranchId,
    );
    let projectContext: AgentProjectSystemContext | undefined;
    let focusedTaskContext: TaskContextPackage | undefined;
    const toolCatalog = command ? undefined : this.toolCatalogIndex();
    if (!command && request.session?.id) {
      const [project, taskContext] = await Promise.all([
        sessionService.loadSession(request.session.id),
        sessionService.resolveTaskContext(request.session.id, undefined, request.selectedTarget?.id),
      ]);
      projectContext = {
        id: project.id,
        name: project.name,
        status: project.status,
        opsecLevel: project.opsecLevel,
        autonomyLevel: project.autonomyLevel,
        scope: project.scope,
      };
      focusedTaskContext = taskContext;
    }
    const prompt = command ?? buildAgentUserPrompt({
      content: effectiveContent,
      sharedTabs: request.contextTabs,
      attachments: request.attachments,
      explicitContext: contextRefs,
    });
    const dynamicSystemContext = command ? undefined : buildAgentDynamicSystemContext({
      project: projectContext,
      taskContext: focusedTaskContext,
      toolCatalog,
      selectedTargetId: request.selectedTarget?.id,
      selectedTargetAdvisory: request.selectedTarget?.id
        ? focusedTaskContext?.targets.find((target) => target.id === request.selectedTarget?.id)?.scopeAdvisory
        : undefined,
    });
    const hexestraTools = this.createHexestraToolDefinitions(
      sender,
      request.session?.id,
      originBranchId,
      request.selectedTarget?.id,
      permissionMode,
    );
    const queryCwd = sessionPath && fs.existsSync(sessionPath) ? sessionPath : process.cwd();
    const connectionSettings = agentSettingsService.getClaudeSettings();
    const runtime = originBackendSessionId || originConnectionFingerprint
      ? {
          backendId: activeBranch.backendId,
          sessionId: resumeOptions.sessionId ?? originBackendSessionId,
          connectionFingerprint: originConnectionFingerprint,
        }
      : null;

    try {
      const runInput = {
        conversationId: originBranchId,
        inputId: userMessageId,
        source: 'operator' as const,
        queuedAt: userMessage.timestamp,
        prompt,
        command: command ?? undefined,
        systemInstructions: buildSystemInstructions(),
        dynamicSystemContext,
        dynamicSystemContextProvider: !command && originProjectId
          ? () => this.resolveRuntimeDynamicContext(originProjectId, originBranchId, request.selectedTarget?.id)
          : undefined,
        signal: runController.signal,
        attachments: request.attachments ?? [],
        cwd: queryCwd,
        additionalDirectories: sessionPath && fs.existsSync(sessionPath) ? [sessionPath] : undefined,
        model: connectionSettings.model,
        permissionMode,
        runtime,
        resumeAt: resumeOptions.resumeAt,
        fork: resumeOptions.fork,
        settingSources: connectionSettings.settingSources,
        tools: hexestraTools,
        projectId: request.session?.id,
      };
      if (adapter.openConversation && originProjectId) {
        const runtimeKey = `${originProjectId}\u0000${originBranchId}`;
        let handle = this.conversationHandles.get(runtimeKey);
        if (!handle) {
          handle = await adapter.openConversation(runInput, interactions);
          this.conversationHandles.set(runtimeKey, handle);
          this.startConversationReader(runtimeKey, handle, sender, originProjectId ?? undefined);
        }
        const readerOwned = this.readerOwnedTurnIds.get(runtimeKey) ?? new Set<string>();
        readerOwned.add(userMessageId);
        this.readerOwnedTurnIds.set(runtimeKey, readerOwned);
      }
      for await (const event of adapter.runTurn(runInput, interactions)) {
        const belongsToInitialInput = !('inputId' in event) || !event.inputId || event.inputId === userMessageId;
        if (event.type === 'session') {
          if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) {
            this.backendSessionId = event.sessionId;
            this.model = event.model;
            this.authenticated = true;
            this.persistAgentState();
            this.emitStatus();
          } else {
            this.persistBranchRuntime(originProjectId ?? undefined, originBranchId, event.sessionId, originConnectionFingerprint);
          }
        } else if (event.type === 'turn_snapshot' && belongsToInitialInput) {
          latestContent = event.content;
          const currentFocusedTaskId = this.resolveFocusedTaskId(originProjectId ?? undefined, originBranchId, initialFocusedTaskId);
          latestActivities = this.bindActivitiesToFocusedTask(currentFocusedTaskId, event.activities, activityTaskBindings);
          if (request.session?.id && currentFocusedTaskId && !transitionedTaskIds.has(currentFocusedTaskId)
            && this.hasTaskExecutionActivity(event.activities, currentFocusedTaskId, activityTaskBindings)) {
            transitionedTaskIds.add(currentFocusedTaskId);
            await this.markFocusedTaskInProgress(request.session.id, currentFocusedTaskId);
          }
          mainProjectionDirty = true;
          streamScheduler.schedule(publishPendingProjection);
          persistLiveSnapshotIfDue();
        } else if (event.type === 'subagent_snapshot') {
          const currentFocusedTaskId = this.resolveFocusedTaskId(originProjectId ?? undefined, originBranchId, initialFocusedTaskId);
          const scopedRun = cloneSubagentRun(event.run);
          const priorTaskId = runSubagentRuns.get(scopedRun.id)?.pttTaskId;
          if (!scopedRun.pttTaskId && (priorTaskId || currentFocusedTaskId)) {
            scopedRun.pttTaskId = priorTaskId ?? currentFocusedTaskId;
          }
          runSubagentRuns.set(scopedRun.id, scopedRun);
          if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) {
            this.mergeSubagentRuns([scopedRun], currentFocusedTaskId);
          }
          const terminal = isTerminalSubagentRun(scopedRun);
          if (terminal) originHistoryRepository?.appendSubagent(originBranchId, scopedRun);
          pendingSubagentRunIds.add(scopedRun.id);
          if (terminal) {
            streamScheduler.cancel();
            publishPendingProjection(runSubagentRuns);
          } else {
            streamScheduler.schedule(() => publishPendingProjection(runSubagentRuns));
          }
          persistLiveSnapshotIfDue();
        } else if (event.type === 'commands_changed') {
          this.emitCommandsChanged(sender, request.session?.id ?? this.activeSessionId, event.commands);
        } else if (event.type === 'turn_completed' && belongsToInitialInput) {
          completedEvent = event;
          latestContent = event.content;
          const currentFocusedTaskId = this.resolveFocusedTaskId(originProjectId ?? undefined, originBranchId, initialFocusedTaskId);
          latestActivities = this.bindActivitiesToFocusedTask(currentFocusedTaskId, event.activities, activityTaskBindings);
          if (request.session?.id && currentFocusedTaskId && !transitionedTaskIds.has(currentFocusedTaskId)
            && this.hasTaskExecutionActivity(event.activities, currentFocusedTaskId, activityTaskBindings)) {
            transitionedTaskIds.add(currentFocusedTaskId);
            await this.markFocusedTaskInProgress(request.session.id, currentFocusedTaskId);
          }
          streamScheduler.cancel();
          publishPendingProjection(runSubagentRuns);
          persistCompletion(event);
        }
      }
      if (!completedEvent) throw new Error('Agent backend ended without a completion event');
      streamScheduler.cancel();
      publishPendingProjection(runSubagentRuns);
      persistCompletion(completedEvent);
      if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.setState('ready');
    } catch (error) {
      streamScheduler.cancel();
      publishPendingProjection(runSubagentRuns);
      const message = toErrorMessage(error);
      const cancelled = runController.signal.aborted || /cancelled|canceled/i.test(message);
      if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) {
        this.lastError = cancelled ? null : message;
      }
      if (originProjectId === this.activeSessionId && error instanceof AgentBackendError && error.code === 'authentication') {
        this.authenticated = false;
      }
      const failureContent = cancelled ? 'Request cancelled.' : formatAgentFailure(message);
      if (completionPersisted) {
        if (originProjectId) {
          this.publishAttention({
            id: `attention-runtime-${runtimeKey}`,
            projectId: originProjectId,
            branchId: originBranchId,
            kind: 'failed',
            title: 'Agent continuation failed',
            detail: failureContent,
            createdAt: new Date().toISOString(),
            read: false,
          });
        }
        if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.setState(cancelled ? 'ready' : 'error');
        return;
      }
      const failureActivities: AgentActivity[] = [
        ...latestActivities,
        {
          id: `${messageId}-failure`,
          kind: 'text',
          status: cancelled ? 'complete' : 'error',
          content: failureContent,
        },
      ];
      const failureMessage: PersistedChatMessage = {
        id: messageId,
        role: 'assistant',
        content: failureContent,
        timestamp: new Date().toISOString(),
        status: cancelled ? 'complete' : 'error',
        activities: failureActivities,
        backendMessageId: undefined,
      };
      if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.chatHistory.push(failureMessage);
      originHistoryRepository?.appendMessage(originBranchId, failureMessage);
      originHistoryRepository?.clearLive(originBranchId);
      if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.persistAgentState();
      this.emitMessage(sender, failureMessage, originProjectId, originBranchId);
      if (originProjectId && (originProjectId !== this.activeSessionId || originBranchId !== this.activeBranchId)) {
        this.publishAttention({
          id: `attention-${messageId}`,
          projectId: originProjectId,
          branchId: originBranchId,
          kind: 'failed',
          title: 'Agent turn failed',
          detail: failureContent,
          createdAt: new Date().toISOString(),
          read: false,
        });
      }
      if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.setState(cancelled ? 'ready' : 'error');
    } finally {
      streamScheduler.cancel();
      if (this.activeRuns.get(runtimeKey) === runController) this.activeRuns.delete(runtimeKey);
      if (this.abortController === runController) this.abortController = null;
      this.resolvePermissionsForWebContents(sender.id, false, originProjectId ?? undefined, originBranchId);
      if (originProjectId === this.activeSessionId && originBranchId === this.activeBranchId) this.emitStatus();
      this.refineryService.resumeQueued();
      if (originProjectId) {
        const snapshot = this.conversationHandles.get(runtimeKey)?.snapshot();
        if (!snapshot || (!snapshot.active && snapshot.pendingInputs === 0 && snapshot.pendingCrons === 0)) {
          releaseProjectRuntimeLease(originProjectId);
        }
      }
      if (originProjectId && originProjectId !== this.activeSessionId && !this.claudeAdapter.hasPinnedRuntimeForProject(originProjectId)) {
        shellService.destroyProject(originProjectId);
      }
      const ownedTurns = this.readerOwnedTurnIds.get(runtimeKey);
      ownedTurns?.delete(userMessageId);
      if (ownedTurns?.size === 0) this.readerOwnedTurnIds.delete(runtimeKey);
      const queued = this.queuedRequests.get(runtimeKey) ?? [];
      const next = queued.shift();
      if (queued.length === 0) this.queuedRequests.delete(runtimeKey);
      if (next) {
        queueMicrotask(() => { void this.sendMessage(next.sender, next.request); });
      }
    }
  }

  private createHexestraToolDefinitions(
    sender: WebContents,
    sessionId?: string,
    branchId?: string,
    selectedTargetId?: string,
    permissionMode: SupportedAgentMode = 'default',
  ) {
    return createHexestraAgentTools({
      sender,
      sessionId,
      branchId,
      selectedTargetId,
      permissionMode,
      taskGuard: sessionId
        ? (toolName) => sessionService.assertTaskExecutionReady(sessionId, toolName, branchId)
        : undefined,
    });
  }

  private runtimeKey(projectId: string | undefined, branchId: string) {
    return `${projectId ?? ''}\u0000${branchId}`;
  }

  private activeRuntimeKey() {
    return this.runtimeKey(this.activeSessionId ?? undefined, this.activeBranchId);
  }

  private activeRuntimeIsRunning() {
    return this.runtimeHasPendingWork(this.activeRuntimeKey());
  }

  private runtimeHasPendingWork(runtimeKey: string) {
    if (this.activeRuns.has(runtimeKey)) return true;
    const snapshot = this.conversationHandles.get(runtimeKey)?.snapshot();
    return Boolean(snapshot && (snapshot.active || snapshot.pendingInputs > 0));
  }

  private async resolveRuntimeDynamicContext(projectId: string, branchId: string, selectedTargetId?: string) {
    const toolCatalog = this.toolCatalogIndex();
    try {
      const project = await sessionService.loadSession(projectId);
      const state = sessionService.getProjectState(projectId);
      const branch = state.agent.branches.find((candidate) => candidate.id === branchId);
      const taskContext = await sessionService.resolveTaskContext(projectId, branch?.focusedTaskId ?? undefined, selectedTargetId);
      return buildAgentDynamicSystemContext({
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          opsecLevel: project.opsecLevel,
          autonomyLevel: project.autonomyLevel,
          scope: project.scope,
        },
        taskContext,
        toolCatalog,
        selectedTargetId,
        selectedTargetAdvisory: selectedTargetId
          ? taskContext.targets.find((target) => target.id === selectedTargetId)?.scopeAdvisory
          : undefined,
      });
    } catch {
      return buildAgentDynamicSystemContext({ toolCatalog });
    }
  }

  private toolCatalogIndex(): ToolCatalogIndexEntry[] {
    return listEnabledToolCatalog(sessionService.getGlobalUserPath()).map(({ id, name, description, channel }) => ({
      id,
      name,
      description,
      channel,
    }));
  }

  private startConversationReader(
    runtimeKey: string,
    handle: AgentConversationHandle,
    sender: WebContents,
    initialLeaseProjectId?: string,
  ) {
    if (this.conversationReaders.has(runtimeKey)) return;
    this.conversationReaders.add(runtimeKey);
    const liveTurns = new Map<string, { projectId: string; branchId: string; messageId: string; content: string; activities: AgentActivity[]; source: 'operator' | 'scheduled' | 'runtime'; runs: Map<string, SubagentRun> }>();
    const startedInputs = new Map<string, Extract<AgentRunEvent, { type: 'input_started' }>>();
    // The owning turn acquires the first lease. The reader only keeps that
    // lease alive while Claude reports queued inputs or session crons.
    let leaseProjectId: string | null = initialLeaseProjectId ?? null;
    void (async () => {
      try {
        for await (const event of handle.events()) {
          const projectId = event.projectId;
          const branchId = event.branchId;
          if (event.type === 'runtime_state') {
            if (event.snapshot.pendingCrons > 0 && projectId && leaseProjectId !== projectId) {
              if (leaseProjectId) releaseProjectRuntimeLease(leaseProjectId);
              // The active turn lease is retained for the scheduled runtime.
              leaseProjectId = projectId;
            } else if (event.snapshot.pendingCrons === 0 && leaseProjectId && !event.snapshot.active && event.snapshot.pendingInputs === 0) {
              releaseProjectRuntimeLease(leaseProjectId);
              leaseProjectId = null;
            }
            if (projectId === this.activeSessionId && branchId === this.activeBranchId) {
              this.setState(event.snapshot.active || event.snapshot.pendingInputs > 0 ? 'running' : 'ready');
            }
            continue;
          }
          if (!projectId || !branchId) continue;
          if ((event.type === 'turn_started' || event.type === 'input_started')
            && projectId === this.activeSessionId
            && branchId === this.activeBranchId) {
            this.setState('running');
          }
          if (event.type === 'input_started' && (event.source === 'operator' || event.source === 'scheduled' || event.source === 'runtime')) {
            const owned = this.readerOwnedTurnIds.get(runtimeKey)?.has(event.inputId) ?? false;
            const history = sessionService.getAgentHistory(projectId);
            const queued = history.getMessages(branchId).find((message) => message.id === event.inputId);
            if (queued && queued.status === 'queued' && !owned) {
              const started = { ...queued, status: 'complete' as const, source: 'operator' as const };
              history.appendMessage(branchId, started);
              this.emitMessage(sender, started, projectId, branchId);
            }
            if (!owned && event.source !== 'operator') {
              const userMessageId = `${event.source}-${event.inputId}`;
              if (!history.getMessages(branchId).some((message) => message.id === userMessageId)) {
                const userMessage: PersistedChatMessage = {
                  id: userMessageId,
                  role: 'user',
                  content: event.prompt?.trim() || (event.source === 'scheduled' ? 'Scheduled Agent wakeup' : 'Runtime Agent input'),
                  timestamp: new Date().toISOString(),
                  status: 'complete',
                  source: event.source,
                };
                history.appendMessage(branchId, userMessage);
                this.emitMessage(sender, userMessage, projectId, branchId);
              }
            }
            startedInputs.set(event.inputId, event);
            continue;
          }
          if (event.type === 'turn_started') {
            const owned = this.readerOwnedTurnIds.get(runtimeKey)?.has(event.inputId) ?? false;
            const started = startedInputs.get(event.inputId);
            // Any earlier input_started entries without their own turn_started
            // were coalesced into this response segment.
            startedInputs.clear();
            if (!owned) {
              const source = started?.source ?? event.source;
              const messageId = source === 'operator' ? `assistant-${event.inputId}` : `${source}-assistant-${event.inputId}`;
              liveTurns.set(event.inputId, { projectId, branchId, messageId, content: '', activities: [], source, runs: new Map() });
            }
            continue;
          }
          const current = 'inputId' in event && event.inputId ? liveTurns.get(event.inputId) : undefined;
          if (!current) continue;
          const history = sessionService.getAgentHistory(current.projectId);
          if (event.type === 'turn_snapshot') {
            current.content = event.content;
            current.activities = event.activities;
            this.emitStreamingMessage(sender, current.messageId, current.content, current.activities, current.projectId, current.branchId);
            history.writeLive(current.branchId, { id: current.messageId, role: 'assistant', content: current.content, timestamp: new Date().toISOString(), status: 'streaming', source: current.source, activities: current.activities }, [...current.runs.values()]);
          } else if (event.type === 'subagent_snapshot') {
            current.runs.set(event.run.id, cloneSubagentRun(event.run));
            this.runtimeSubagentRuns.get(runtimeKey)?.set(event.run.id, cloneSubagentRun(event.run));
            this.emitSubagentUpdates(sender, new Set([event.run.id]), current.projectId, current.branchId, current.runs);
            if (isTerminalSubagentRun(event.run)) history.appendSubagent(current.branchId, event.run);
          } else if (event.type === 'turn_completed') {
            current.content = event.content;
            current.activities = event.activities;
            const finalMessage: PersistedChatMessage = {
              id: current.messageId,
              role: 'assistant',
              content: current.content,
              timestamp: new Date().toISOString(),
              status: 'complete',
              source: current.source,
              activities: current.activities,
              backendMessageId: event.backendMessageId,
            };
            if (current.content.trim() || current.activities.length > 0) {
              history.appendMessage(current.branchId, finalMessage);
              this.emitMessage(sender, finalMessage, current.projectId, current.branchId);
            }
            history.clearLive(current.branchId);
            if (current.projectId !== this.activeSessionId || current.branchId !== this.activeBranchId) {
              this.publishAttention({ id: `attention-${current.messageId}`, projectId: current.projectId, branchId: current.branchId, kind: 'completed', title: current.source === 'scheduled' ? 'Scheduled Agent turn completed' : 'Agent continuation completed', createdAt: new Date().toISOString(), read: false });
            }
            liveTurns.delete(event.inputId!);
            startedInputs.delete(event.inputId!);
          }
        }
      } catch (error) {
        const [projectId, branchId] = runtimeKey.split('\u0000');
        if (projectId && branchId) this.publishAttention({ id: `attention-runtime-${runtimeKey}`, projectId, branchId, kind: 'failed', title: 'Background Agent runtime failed', detail: toErrorMessage(error), createdAt: new Date().toISOString(), read: false });
      } finally {
        if (leaseProjectId) releaseProjectRuntimeLease(leaseProjectId);
        if (this.conversationHandles.get(runtimeKey) === handle) this.conversationHandles.delete(runtimeKey);
        this.runtimeSubagentRuns.delete(runtimeKey);
        this.conversationReaders.delete(runtimeKey);
      }
    })();
  }

  private emitCommandsChanged(
    sender: WebContents,
    sessionId: string | null,
    commands: AgentSlashCommandDescriptor[],
  ) {
    const payload: AgentCommandsChangedPayload = { sessionId, commands };
    if (!sender.isDestroyed()) sender.send('agent:commands-changed', payload);
  }

  private createInteractionHandler(
    sender: WebContents,
    autonomyLevel: AutonomyLevel,
    permissionMode: SupportedAgentMode,
    projectId: string | null = this.activeSessionId,
    branchId = this.activeBranchId,
  ): AgentInteractionHandler {
    return {
      authorizeTool: async (request): Promise<AgentToolPermissionDecision> => {
      const { toolName, input, signal, toolUseId, agentId } = request;
      const subagentContext = this.getSubagentContext(agentId, projectId ?? undefined, branchId);

      if (projectId && isTaskGuardedTool(toolName, request.riskLevel)) {
        try {
          await sessionService.assertTaskExecutionReady(projectId, toolName, branchId);
        } catch (error) {
          return {
            behavior: 'deny',
            message: error instanceof Error ? error.message : String(error),
            interrupt: false,
            decisionClassification: 'user_reject',
          };
        }
      }

      // Native subagents inherit the parent permission mode and were
      // historically auto-approved. Keep that behavior after the task gate.
      if (isSubagentSpawnTool(toolName)) {
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionClassification: 'user_temporary',
        };
      }

      const disposition = resolvePermissionDisposition(
        permissionMode,
        request.riskLevel === 'read',
        autonomyLevel,
      );
      if (disposition === 'allow') {
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionClassification: 'user_temporary',
        };
      }
      if (disposition === 'deny') {
        return {
          behavior: 'deny',
          message: 'This tool is not allowed by the active Hexestra permission policy.',
          interrupt: false,
          decisionClassification: 'user_reject',
        };
      }

      const requestId = `permission-${++this.requestCounter}`;
      const displayInput = sanitizeAgentToolInputForDisplay(toolName, input);
      if (projectId === this.activeSessionId && branchId === this.activeBranchId) this.setState('awaiting_approval');
      sender.send('agent:tool-request', {
        sessionId: projectId,
        projectId: projectId ?? undefined,
        branchId,
        request: {
          kind: 'tool_approval',
          id: requestId,
          toolUseId,
          toolName,
          input: displayInput,
          description: describeToolUse(toolName, displayInput),
          riskLevel: request.riskLevel ?? 'write',
          createdAt: new Date().toISOString(),
          ...subagentContext,
        },
      });
      if (projectId && (projectId !== this.activeSessionId || branchId !== this.activeBranchId)) {
        this.publishAttention({
          id: requestId,
          projectId,
          branchId,
          kind: 'waiting_approval',
          title: 'Agent approval required',
          detail: describeToolUse(toolName, displayInput),
          interaction: {
            id: requestId,
            kind: 'tool_approval',
            toolUseId,
            toolName,
            input,
            description: describeToolUse(toolName, displayInput),
            riskLevel: request.riskLevel ?? 'write',
            createdAt: new Date().toISOString(),
            ...subagentContext,
          } satisfies AgentAttentionInteraction,
          createdAt: new Date().toISOString(),
          read: false,
        });
      }

      const result = await this.waitForUserInteraction({
        requestId,
        webContentsId: sender.id,
        signal,
        kind: 'tool_approval',
        input,
        toolUseId,
        timeoutMs: projectId === this.activeSessionId && branchId === this.activeBranchId ? 5 * 60_000 : undefined,
        projectId: projectId ?? undefined,
        branchId,
        ...subagentContext,
      });
      if (projectId === this.activeSessionId && branchId === this.activeBranchId) this.setState(this.activeRuntimeIsRunning() ? 'running' : 'ready');
      return result;
      },
      requestAnswers: async (request) => {
        const questions = request.questions;
        const requestId = `question-${++this.requestCounter}`;
        if (projectId === this.activeSessionId && branchId === this.activeBranchId) this.setState('awaiting_input');
        sender.send('agent:tool-request', {
          sessionId: projectId,
          projectId: projectId ?? undefined,
          branchId,
          request: {
            kind: 'ask_user_question',
            id: requestId,
            toolUseId: request.toolUseId,
            toolName: 'AskUserQuestion',
            questions,
            createdAt: new Date().toISOString(),
            ...this.getSubagentContext(request.agentId, projectId ?? undefined, branchId),
          },
        });
        if (projectId && (projectId !== this.activeSessionId || branchId !== this.activeBranchId)) {
        this.publishAttention({
            id: requestId,
            projectId,
            branchId,
          kind: 'waiting_input',
          interaction: {
            id: requestId,
            kind: 'ask_user_question',
            toolUseId: request.toolUseId,
            toolName: 'AskUserQuestion',
            questions,
            createdAt: new Date().toISOString(),
            ...this.getSubagentContext(request.agentId),
          } satisfies AgentAttentionInteraction,
            title: 'Agent input required',
            createdAt: new Date().toISOString(),
            read: false,
          });
        }
        const result = await this.waitForUserInteraction({
          requestId,
          webContentsId: sender.id,
          signal: request.signal,
          kind: 'ask_user_question',
          input: request.input,
          toolUseId: request.toolUseId,
          questions,
          projectId: projectId ?? undefined,
          branchId,
          ...this.getSubagentContext(request.agentId, projectId ?? undefined, branchId),
        });
        if (projectId === this.activeSessionId && branchId === this.activeBranchId) this.setState(this.activeRuntimeIsRunning() ? 'running' : 'ready');
        if (result.behavior !== 'allow' || !result.updatedInput?.answers) {
          throw new Error(result.message ?? 'The clarifying question was not answered.');
        }
        return result.updatedInput.answers as AskUserQuestionAnswers;
      },
    };
  }

  private waitForUserInteraction(input: {
    requestId: string;
    webContentsId: number;
    signal: AbortSignal;
    kind: PendingPermission['kind'];
    input: Record<string, unknown>;
    toolUseId: string;
    questions?: AskUserQuestion[];
    timeoutMs?: number;
    agentId?: string;
    subagentRunId?: string;
    agentType?: string;
    projectId?: string;
    branchId?: string;
  }) {
    return new Promise<AgentToolPermissionDecision>((resolve) => {
      let settled = false;
      const finish = (result: AgentToolPermissionDecision) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        input.signal.removeEventListener('abort', onAbort);
        this.pendingPermissions.delete(input.requestId);
        resolve(result);
      };
      const deny = (message: string): AgentToolPermissionDecision => ({
        behavior: 'deny',
        message,
        interrupt: false,
      });
      const onAbort = () => finish(deny('The Agent request was cancelled.'));
      const timeout = input.timeoutMs
        ? setTimeout(() => finish(deny('The human approval request timed out.')), input.timeoutMs)
        : undefined;
      input.signal.addEventListener('abort', onAbort, { once: true });
      this.pendingPermissions.set(input.requestId, {
        resolve: finish,
        webContentsId: input.webContentsId,
        kind: input.kind,
        input: input.input,
        toolUseId: input.toolUseId,
        questions: input.questions,
        agentId: input.agentId,
        subagentRunId: input.subagentRunId,
        agentType: input.agentType,
        projectId: input.projectId,
        branchId: input.branchId,
      });
      this.emitStatus();
    });
  }

  private getSubagentContext(agentId?: string, projectId?: string, branchId = this.activeBranchId) {
    const scoped = projectId ? this.runtimeSubagentRuns.get(this.runtimeKey(projectId, branchId)) : undefined;
    const run = agentId
      ? scoped?.get(agentId) ?? [...(scoped?.values() ?? []), ...this.subagentRuns].find((candidate) => candidate.agentId === agentId)
      : undefined;
    return {
      ...(agentId ? { agentId } : {}),
      ...(run ? { subagentRunId: run.id, agentType: run.agentType } : {}),
    };
  }

  private resolvePermission(
    requestId: string,
    approved: boolean,
    webContentsId?: number,
    projectId?: string,
    branchId?: string,
  ) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending
      || (webContentsId !== undefined && pending.webContentsId !== webContentsId)
      || (projectId !== undefined && pending.projectId !== projectId)
      || (branchId !== undefined && pending.branchId !== branchId)) return;
    if (approved && pending.kind !== 'tool_approval') {
      throw new Error('Clarifying questions require explicit answers');
    }
    pending.resolve(approved
      ? {
          behavior: 'allow',
          updatedInput: pending.input,
          decisionClassification: 'user_temporary',
        }
      : {
          behavior: 'deny',
          message: pending.kind === 'ask_user_question'
            ? 'The human operator cancelled this question.'
            : 'The human operator rejected this tool action.',
          interrupt: false,
          decisionClassification: 'user_reject',
        });
    this.emitStatus();
    this.attentionItems.delete(requestId);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('agent:attention:resolved', { id: requestId });
    }
  }

  private answerUserQuestion(
    requestId: string,
    input: unknown,
    webContentsId?: number,
    projectId?: string,
    branchId?: string,
  ) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending || pending.kind !== 'ask_user_question' || !pending.questions) {
      throw new Error('The clarifying question is no longer active');
    }
    if (webContentsId !== undefined && pending.webContentsId !== webContentsId) {
      throw new Error('The clarifying question belongs to another window');
    }
    if ((projectId !== undefined && pending.projectId !== projectId)
      || (branchId !== undefined && pending.branchId !== branchId)) {
      throw new Error('The clarifying question belongs to another project or branch');
    }
    pending.resolve({
      behavior: 'allow',
      updatedInput: buildAskUserQuestionUpdatedInput(
        pending.input,
        pending.questions,
        input,
      ),
      decisionClassification: 'user_temporary',
    });
    this.attentionItems.delete(requestId);
    this.emitStatus();
  }

  private resolveAllPermissions(approved: boolean) {
    for (const [requestId, pending] of [...this.pendingPermissions.entries()]) {
      this.resolvePermission(requestId, approved && pending.kind === 'tool_approval');
    }
    this.pendingPermissions.clear();
  }

  private resolvePermissionsForRuntime(projectId: string | undefined, branchId: string, approved: boolean) {
    for (const [requestId, pending] of [...this.pendingPermissions.entries()]) {
      if (pending.projectId === projectId && pending.branchId === branchId) {
        this.resolvePermission(requestId, approved && pending.kind === 'tool_approval');
      }
    }
  }

  private resolvePermissionsForWebContents(
    webContentsId: number,
    approved: boolean,
    projectId?: string,
    branchId?: string,
  ) {
    for (const [requestId, pending] of [...this.pendingPermissions.entries()]) {
      if (pending.webContentsId === webContentsId
        && (projectId === undefined || pending.projectId === projectId)
        && (branchId === undefined || pending.branchId === branchId)) {
        this.resolvePermission(requestId, approved && pending.kind === 'tool_approval');
      }
    }
  }

  private emitStreamingMessage(
    sender: WebContents,
    id: string,
    content: string,
    activities: AgentActivity[],
    projectId = this.activeSessionId,
    branchId = this.activeBranchId,
  ) {
    this.emitMessage(sender, {
      id,
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      status: 'streaming',
      activities,
    }, projectId, branchId);
  }

  private emitMessage(sender: WebContents, message: PersistedChatMessage, projectId = this.activeSessionId, branchId = this.activeBranchId) {
    if (!sender.isDestroyed()) {
      sender.send('agent:message', {
        sessionId: projectId,
        projectId,
        branchId,
        message,
      });
    }
  }

  private appendRefineryInvocation(sender: WebContents, invocation: import('../contracts/knowledge-refinery').RefineryInvocation) {
    const message: PersistedChatMessage = {
      id: `refinery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'complete',
      refineryInvocation: invocation,
    };
    this.chatHistory.push(message);
    this.historyRepository?.appendMessage(this.activeBranchId, message);
    this.persistAgentState();
    this.emitMessage(sender, message);
  }

  private emitSubagentUpdates(
    sender: WebContents,
    runIds: Set<string>,
    projectId = this.activeSessionId,
    branchId = this.activeBranchId,
    scopedRuns?: Map<string, SubagentRun>,
  ) {
    if (sender.isDestroyed()) return;
    for (const runId of runIds) {
      const run = scopedRuns?.get(runId) ?? this.subagentRuns.find((candidate) => candidate.id === runId);
      if (!run) continue;
      sender.send('agent:subagent-update', {
        sessionId: projectId,
        projectId,
        branchId,
        run: cloneSubagentRun(run),
      });
    }
  }

  private mergeSubagentRuns(runs: SubagentRun[], focusedTaskId?: string) {
    if (runs.length === 0) return;
    const byId = new Map(this.subagentRuns.map((run) => [run.id, run]));
    for (const run of runs) {
      const next = cloneSubagentRun(run);
      if (!next.pttTaskId && focusedTaskId) next.pttTaskId = focusedTaskId;
      byId.set(next.id, next);
    }
    this.subagentRuns = [...byId.values()];
    this.scheduleSubagentPersistence(runs.some(isTerminalSubagentRun));
  }

  private scheduleSubagentPersistence(immediate = false) {
    if (!this.activeSessionId) return;
    if (immediate) {
      this.clearSubagentPersistTimer();
      this.persistAgentState();
      return;
    }
    if (this.subagentPersistTimer) return;
    this.subagentPersistTimer = setTimeout(() => {
      this.subagentPersistTimer = null;
      this.persistAgentState();
    }, 750);
    this.subagentPersistTimer.unref?.();
  }

  private clearSubagentPersistTimer() {
    if (!this.subagentPersistTimer) return;
    clearTimeout(this.subagentPersistTimer);
    this.subagentPersistTimer = null;
  }

  private setState(state: AgentState) {
    this.state = state;
    this.emitStatus();
    if (state === 'ready' || state === 'error') this.refineryService.resumeQueued();
  }

  private activeBackendAvailable() {
    const backendId = this.branches.find((branch) => branch.id === this.activeBranchId)?.backendId
      ?? CLAUDE_BACKEND_ID;
    return this.adapterRegistry.get(backendId)?.status().available ?? false;
  }

  private async markFocusedTaskInProgress(sessionId: string, focusedTaskId: string) {
    const tasks = await sessionService.listTasks(sessionId);
    const task = tasks.find((candidate) => candidate.id === focusedTaskId);
    if (!task || task.status === 'in_progress' || task.status === 'completed' || task.status === 'skipped' || task.status === 'blocked') return false;
    try {
      await sessionService.updateTaskStatus(sessionId, focusedTaskId, 'in_progress');
      if (task.kind === 'step') {
        const objective = tasks.find((candidate) => candidate.kind === 'objective' && candidate.id === task.parentId);
        if (objective && objective.status === 'pending') await sessionService.updateTaskStatus(sessionId, objective.id, 'in_progress');
      }
      return true;
    } catch { return false; }
  }

  private resolveFocusedTaskId(projectId: string | undefined, branchId: string, fallback?: string) {
    if (!projectId) return fallback;
    try {
      const branch = sessionService.getProjectState(projectId).agent.branches.find((candidate) => candidate.id === branchId);
      return branch ? branch.focusedTaskId ?? undefined : fallback;
    } catch {
      return fallback;
    }
  }

  private hasTaskExecutionActivity(activities: AgentActivity[], focusedTaskId: string, bindings: Map<string, string>) {
    return activities.some((activity) => (
      activity.kind === 'tool'
      && activity.status !== 'error'
      && Boolean(activity.toolName)
      && bindings.get(activity.id) === focusedTaskId
      && isTaskGuardedTool(activity.toolName!, 'write')
    ));
  }

  private bindActivitiesToFocusedTask(focusedTaskId: string | undefined, activities: AgentActivity[], bindings: Map<string, string>) {
    if (!focusedTaskId && bindings.size === 0) return activities;
    return activities.map((activity) => {
      const prior = bindings.get(activity.id) ?? activity.pttTaskId;
      const taskId = prior ?? (focusedTaskId || undefined);
      if (taskId) bindings.set(activity.id, taskId);
      return taskId ? { ...activity, pttTaskId: taskId } : activity;
    });
  }

  private getStatus(sessionId = this.activeSessionId ?? undefined): AgentStatus {
    const connectionSettings = agentSettingsService.getClaudeSettings();
    const stored = sessionId && sessionId !== this.activeSessionId
      ? sessionService.getProjectState(sessionId).agent
      : null;
    const storedBranch = stored?.branches.find(
      (branch) => branch.id === stored.activeBranchId,
    );
    const backendId = storedBranch?.backendId
      ?? this.branches.find((branch) => branch.id === this.activeBranchId)?.backendId
      ?? CLAUDE_BACKEND_ID;
    const backend = this.adapterRegistry.get(backendId);
    const currentFingerprint = backend?.fingerprint() ?? '';
    const storedSessionId = storedBranch?.runtime?.connectionFingerprint === currentFingerprint
      ? storedBranch.runtime?.sessionId ?? null
      : null;
    const activeBackendSessionId = this.connectionFingerprint === currentFingerprint
      ? this.backendSessionId
      : null;
    const backendStatus = backend?.status();
    const statusBranchId = storedBranch?.id ?? (sessionId === this.activeSessionId ? this.activeBranchId : undefined);
    const runtimePending = statusBranchId
      ? (this.queuedRequests.get(this.runtimeKey(sessionId, statusBranchId))?.length ?? 0)
      : 0;
    return {
      state: this.state,
      backendId,
      available: backendStatus?.available ?? false,
      authenticated: stored ? this.authenticated : backendStatus?.authenticated ?? this.authenticated,
      model: stored?.model ?? this.model ?? backendStatus?.model ?? null,
      backendSessionId: stored ? storedSessionId : activeBackendSessionId,
      pendingRequests: this.pendingPermissions.size + runtimePending,
      historyLength: storedBranch?.history.messageCount ?? this.chatHistory.length,
      lastError: stored?.lastError ?? backendStatus?.lastError ?? this.lastError
        ?? (backend ? null : `Agent backend "${backendId}" is unavailable`),
      runtimeMode: backendStatus?.runtimeMode ?? connectionSettings.executionMode,
      runtimeLabel: backendStatus?.runtimeLabel ?? (connectionSettings.executionMode === 'wsl'
        ? `WSL · ${connectionSettings.wslDistribution}`
        : 'Native'),
    };
  }

  private emitStatus() {
    const status = this.getStatus();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('agent:status', {
          sessionId: this.activeSessionId,
          projectId: this.activeSessionId,
          branchId: this.activeBranchId,
          status,
        });
      }
    }
  }

  private publishAttention(item: AgentAttentionItem) {
    this.attentionItems.set(item.id, item);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('agent:attention', { item });
    }
  }
}

function describeToolUse(toolName: string, input: Record<string, unknown>) {
  const summary = JSON.stringify(input, null, 2);
  return `${toolName} requests:\n${summary.length > 1_500 ? `${summary.slice(0, 1_500)}…` : summary}`;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cloneMessage(message: PersistedChatMessage): PersistedChatMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    contextRefs: message.contextRefs?.map((ref) => ({ ...ref })),
    workflowInvocation: message.workflowInvocation ? { ...message.workflowInvocation } : undefined,
    refineryInvocation: message.refineryInvocation ? { ...message.refineryInvocation } : undefined,
    activities: message.activities?.map((activity) => ({
      ...activity,
      input: activity.input ? { ...activity.input } : undefined,
    })),
  };
}

function cloneBranch(branch: PersistedConversationBranch): PersistedConversationBranch {
  return {
    ...branch,
    history: { ...branch.history },
  };
}

function mergeRuns(existing: SubagentRun[], incoming: SubagentRun[]) {
  const byId = new Map(existing.map((run) => [run.id, run]));
  incoming.forEach((run) => byId.set(run.id, run));
  return [...byId.values()];
}

function cloneSubagentRun(run: SubagentRun): SubagentRun {
  return {
    ...run,
    usage: run.usage ? { ...run.usage } : undefined,
    activities: run.activities.map((activity) => ({
      ...activity,
      input: activity.input ? { ...activity.input } : undefined,
    })),
  };
}

function isTerminalSubagentRun(run: SubagentRun) {
  return run.status === 'completed'
    || run.status === 'failed'
    || run.status === 'stopped'
    || run.status === 'killed'
    || run.status === 'interrupted';
}

function branchTitle(content: string, index: number) {
  const compact = content.trim().replace(/\s+/g, ' ');
  return compact ? compact.slice(0, 48) : `Branch ${index}`;
}

export const agentService = new AgentService();
