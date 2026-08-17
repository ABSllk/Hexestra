import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import fs from 'fs';
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
import { sanitizeAgentToolInputForDisplay } from './agent-tool-policy';
import { ClaudeAgentAdapter } from './agent-adapters/claude-agent-adapter';
import { KnowledgeRefineryService, refineryInvocation } from './knowledge-refinery.service';
import { buildAgentDistillPrompt, resolveAgentInputCommand } from './agent-distill';
import { AgentAdapterRegistry } from './agent-adapters/registry';
import { AgentStreamScheduler } from './agent-stream-scheduler';
import {
  CLAUDE_BACKEND_ID,
  type AgentInteractionHandler,
  type AgentToolPermissionDecision,
  type AgentToolPermissionRequest,
  type AgentState,
  type AgentStatus,
  type AgentBackendId,
  AgentBackendError,
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

  constructor() {
    this.adapterRegistry.register(this.claudeAdapter);
    this.refineryService = new KnowledgeRefineryService({
      analyze: (input) => this.claudeAdapter.distillKnowledge(input),
      isMainAgentBusy: () => this.abortController !== null,
      modelSnapshot: () => this.claudeAdapter.status().model ?? agentSettingsService.getClaudeSettings().model ?? 'Current Agent',
    });
    agentSettingsService.setRuntimeGuard(() => this.abortController !== null);
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

    ipcMain.handle('agent:approve-tool', (event, requestId: string) => {
      this.resolvePermission(requestId, true, event.sender.id);
    });

    ipcMain.handle('agent:reject-tool', (event, requestId: string) => {
      this.resolvePermission(requestId, false, event.sender.id);
    });

    ipcMain.handle(
      'agent:answer-question',
      (event, requestId: string, answers: AskUserQuestionAnswers) => {
        this.answerUserQuestion(requestId, answers, event.sender.id);
      },
    );

    ipcMain.handle('agent:cancel', (_event, sessionId?: string) => {
      if (sessionId && sessionId !== this.activeSessionId) return;
      this.abortController?.abort();
      this.resolveAllPermissions(false);
      if (!this.abortController) this.setState(this.activeBackendAvailable() ? 'ready' : 'error');
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
      await this.stopActiveRequest();
      await this.disposeActiveConversationRuntime();
    }
    if (previousSessionId && previousSessionId !== sessionId) {
      shellService.destroyProject(previousSessionId);
    }
    return this.loadProject(sessionId);
  }

  private async stopActiveRequest() {
    if (!this.abortController) return;
    this.abortController.abort();
    this.resolveAllPermissions(false);
    await this.waitForActiveRequest();
  }

  private async disposeActiveConversationRuntime() {
    const branch = this.branches.find((candidate) => candidate.id === this.activeBranchId);
    if (!branch) return;
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
    this.model = project.agent.model;
    this.lastError = project.agent.lastError;
    if (!this.abortController) this.state = this.activeBackendAvailable() ? 'ready' : 'loading';
    const status = this.getStatus(sessionId);
    this.emitStatus();
    return this.buildActivation(sessionId, status, project.preferences, project.workspace);
  }

  private waitForActiveRequest() {
    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 10_000;
      const check = () => {
        if (!this.abortController) resolve();
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
    this.chatHistory = this.historyRepository?.getMessages(branch.id).map(cloneMessage) ?? [];
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
    const items = activeRealtimeMessage && (activeRealtimeMessage.status === 'streaming' || activeRealtimeMessage.status === 'sending')
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
    if (this.abortController) throw new Error('Cannot switch branches while Claude is running');
    this.ensureActiveProject(sessionId);
    const branch = this.branches.find((candidate) => candidate.id === branchId);
    if (!branch) throw new Error(`Conversation branch ${branchId} not found`);
    if (branch.id !== this.activeBranchId) {
      await this.disposeActiveConversationRuntime();
      this.syncActiveBranchMetadata();
      this.activeBranchId = branch.id;
      this.hydrateActiveBranch();
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
    if (this.abortController) {
      throw new Error('Cannot create a conversation while Claude is running');
    }
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
    await this.disposeActiveConversationRuntime();
    this.historyRepository?.ensureBranch(conversation);
    this.branches.push(conversation);
    this.activeBranchId = conversation.id;
    this.hydrateActiveBranch();
    this.persistAgentState();

    const project = sessionService.getProjectState(sessionId);
    return this.buildActivation(sessionId, this.getStatus(sessionId), project.preferences, project.workspace);
  }

  private async branchFromMessage(sender: WebContents, input: AgentBranchRequest) {
    if (this.abortController) throw new Error('Cannot branch while Claude is running');
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
    await this.disposeActiveConversationRuntime();
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

  private async sendMessage(
    sender: WebContents,
    request: AgentRequest,
    resumeOptions: BranchResumeOptions = { fork: false },
  ) {
    if (!request.content.trim()) return;
    if (this.abortController) {
      throw new Error('Claude is already processing a request');
    }
    this.ensureActiveProject(request.session?.id);
    const contextRefs = normalizeAgentContextRefs(request.contextRefs, request.session?.id);

    const activeBranch = this.branches.find((branch) => branch.id === this.activeBranchId);
    if (!activeBranch) throw new Error('Active conversation branch is missing');
    const focusedTaskId = activeBranch.focusedTaskId ?? undefined;
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

    const userMessageId = request.clientMessageId ?? `user-${Date.now()}`;
    if (this.chatHistory.length === 0) {
      const activeConversation = this.branches.find(
        (branch) => branch.id === this.activeBranchId,
      );
      if (activeConversation) {
        activeConversation.title = branchTitle(request.content, this.branches.length);
      }
    }
    this.lastError = null;
    this.chatHistory.push({
      id: userMessageId,
      role: 'user',
      content: request.content,
      timestamp: new Date().toISOString(),
      status: 'complete',
      ...(request.attachments?.length
        ? { attachments: request.attachments.map(attachmentMetadata) }
        : {}),
      ...(contextRefs.length ? { contextRefs } : {}),
      ...(request.workflowInvocation ? { workflowInvocation: request.workflowInvocation } : {}),
    });
    this.historyRepository?.appendMessage(this.activeBranchId, this.chatHistory.at(-1)!);
    this.persistAgentState();
    this.abortController = new AbortController();
    this.setState('running');

    const messageId = `msg-${Date.now()}`;
    let latestContent = '';
    let latestActivities: AgentActivity[] = [];
    const activityTaskBindings = new Map<string, string>();
    let focusedTaskTransitionChecked = false;
    let completedEvent: Extract<import('../contracts/agent-runtime').AgentRunEvent, { type: 'turn_completed' }> | undefined;
    const streamScheduler = new AgentStreamScheduler();
    const pendingSubagentRunIds = new Set<string>();
    let mainProjectionDirty = false;
    let lastLivePersistedAt = 0;
    const publishPendingProjection = () => {
      if (mainProjectionDirty) {
        mainProjectionDirty = false;
        this.emitStreamingMessage(sender, messageId, latestContent, latestActivities);
      }
      if (pendingSubagentRunIds.size > 0) {
        this.emitSubagentUpdates(sender, pendingSubagentRunIds);
        pendingSubagentRunIds.clear();
      }
    };
    const persistLiveSnapshotIfDue = () => {
      const now = Date.now();
      if (lastLivePersistedAt > 0 && now - lastLivePersistedAt < LIVE_PERSIST_INTERVAL_MS) return;
      this.historyRepository?.writeLive(this.activeBranchId, {
        id: messageId,
        role: 'assistant',
        content: latestContent,
        timestamp: new Date().toISOString(),
        status: 'streaming',
        activities: latestActivities,
      }, this.subagentRuns);
      lastLivePersistedAt = now;
    };
    this.emitMessage(sender, {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
      activities: latestActivities,
    });

    const sessionPath = request.session?.id
      ? sessionService.getSessionPath(request.session.id)
      : null;
    const permissionMode = normalizeAgentMode(request.permissionMode);
    const interactions = this.createInteractionHandler(
      sender,
      request.autonomyLevel ?? 'medium',
      permissionMode,
    );
    let projectContext: AgentProjectSystemContext | undefined;
    let focusedTaskContext: TaskContextPackage | undefined;
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
      selectedTargetId: request.selectedTarget?.id,
      selectedTargetAdvisory: request.selectedTarget?.id
        ? focusedTaskContext?.targets.find((target) => target.id === request.selectedTarget?.id)?.scopeAdvisory
        : undefined,
    });
    const hexestraTools = this.createHexestraToolDefinitions(
      sender,
      request.session?.id,
      request.selectedTarget?.id,
      permissionMode,
    );
    const queryCwd = sessionPath && fs.existsSync(sessionPath) ? sessionPath : process.cwd();
    const connectionSettings = agentSettingsService.getClaudeSettings();
    const runtime = this.backendSessionId || this.connectionFingerprint
      ? {
          backendId: activeBranch.backendId,
          sessionId: resumeOptions.sessionId ?? this.backendSessionId,
          connectionFingerprint: this.connectionFingerprint,
        }
      : null;

    try {
      const runInput = {
        conversationId: this.activeBranchId,
        prompt,
        command: command ?? undefined,
        systemInstructions: buildSystemInstructions(),
        dynamicSystemContext,
        signal: this.abortController.signal,
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
      for await (const event of adapter.runTurn(runInput, interactions)) {
        if (event.type === 'session') {
          this.backendSessionId = event.sessionId;
          this.model = event.model;
          this.authenticated = true;
          this.persistAgentState();
          this.emitStatus();
        } else if (event.type === 'turn_snapshot') {
          latestContent = event.content;
          latestActivities = this.bindActivitiesToFocusedTask(focusedTaskId, event.activities, activityTaskBindings);
          if (!focusedTaskTransitionChecked && request.session?.id && focusedTaskId && event.activities.some((activity) => activity.kind === 'tool' && activity.toolName && !/^(task_|restriction_list|tool_catalog_)/.test(activity.toolName))) {
            focusedTaskTransitionChecked = true;
            await this.markFocusedTaskInProgress(request.session.id, focusedTaskId);
          }
          mainProjectionDirty = true;
          streamScheduler.schedule(publishPendingProjection);
          persistLiveSnapshotIfDue();
        } else if (event.type === 'subagent_snapshot') {
          this.mergeSubagentRuns([event.run]);
          const terminal = isTerminalSubagentRun(event.run);
          if (terminal) this.historyRepository?.appendSubagent(this.activeBranchId, event.run);
          pendingSubagentRunIds.add(event.run.id);
          if (terminal) {
            streamScheduler.cancel();
            publishPendingProjection();
          } else {
            streamScheduler.schedule(publishPendingProjection);
          }
          persistLiveSnapshotIfDue();
        } else if (event.type === 'commands_changed') {
          this.emitCommandsChanged(sender, request.session?.id ?? this.activeSessionId, event.commands);
        } else if (event.type === 'turn_completed') {
          completedEvent = event;
          latestContent = event.content;
          latestActivities = this.bindActivitiesToFocusedTask(focusedTaskId, event.activities, activityTaskBindings);
        }
      }
      if (!completedEvent) throw new Error('Agent backend ended without a completion event');
      streamScheduler.cancel();
      publishPendingProjection();
      const finalContent = completedEvent.content;
      const finalMessage: PersistedChatMessage = {
        id: messageId,
        role: 'assistant',
        content: finalContent,
        timestamp: new Date().toISOString(),
        status: 'complete',
        activities: latestActivities,
        backendMessageId: completedEvent.backendMessageId,
      };
      this.chatHistory.push(finalMessage);
      this.historyRepository?.appendMessage(this.activeBranchId, finalMessage);
      this.historyRepository?.clearLive(this.activeBranchId);
      this.persistAgentState();
      this.emitMessage(sender, finalMessage);
      this.setState('ready');
    } catch (error) {
      streamScheduler.cancel();
      publishPendingProjection();
      const message = toErrorMessage(error);
      const cancelled = this.abortController?.signal.aborted || /cancelled|canceled/i.test(message);
      this.lastError = cancelled ? null : message;
      if (error instanceof AgentBackendError && error.code === 'authentication') {
        this.authenticated = false;
      }
      const failureContent = cancelled ? 'Request cancelled.' : formatAgentFailure(message);
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
      this.chatHistory.push(failureMessage);
      this.historyRepository?.appendMessage(this.activeBranchId, failureMessage);
      this.historyRepository?.clearLive(this.activeBranchId);
      this.persistAgentState();
      this.emitMessage(sender, failureMessage);
      this.setState(cancelled ? 'ready' : 'error');
    } finally {
      streamScheduler.cancel();
      this.abortController = null;
      this.resolvePermissionsForWebContents(sender.id, false);
      this.emitStatus();
      this.refineryService.resumeQueued();
    }
  }

  private createHexestraToolDefinitions(
    sender: WebContents,
    sessionId?: string,
    selectedTargetId?: string,
    permissionMode: SupportedAgentMode = 'default',
  ) {
    return createHexestraAgentTools({
      sender,
      sessionId,
      selectedTargetId,
      permissionMode,
      taskGuard: sessionId ? (toolName) => sessionService.assertTaskExecutionReady(sessionId, toolName) : undefined,
    });
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
  ): AgentInteractionHandler {
    return {
      authorizeTool: async (request): Promise<AgentToolPermissionDecision> => {
      const { toolName, input, signal, toolUseId, agentId } = request;
      const subagentContext = this.getSubagentContext(agentId);

      if (this.activeSessionId && !/^(task_|restriction_|tool_catalog_)/.test(toolName) && /^(browser|shell|traffic|egress-proxy|mcp|subagent|Task$|Agent)/.test(toolName)) {
        try {
          await sessionService.assertTaskExecutionReady(this.activeSessionId, toolName);
        } catch (error) {
          return {
            behavior: 'deny',
            message: error instanceof Error ? error.message : String(error),
            interrupt: false,
            decisionClassification: 'user_reject',
          };
        }
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
      this.setState('awaiting_approval');
      sender.send('agent:tool-request', {
        sessionId: this.activeSessionId,
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

      const result = await this.waitForUserInteraction({
        requestId,
        webContentsId: sender.id,
        signal,
        kind: 'tool_approval',
        input,
        toolUseId,
        timeoutMs: 5 * 60_000,
        ...subagentContext,
      });
      this.setState(this.abortController ? 'running' : 'ready');
      return result;
      },
      requestAnswers: async (request) => {
        const questions = request.questions;
        const requestId = `question-${++this.requestCounter}`;
        this.setState('awaiting_input');
        sender.send('agent:tool-request', {
          sessionId: this.activeSessionId,
          request: {
            kind: 'ask_user_question',
            id: requestId,
            toolUseId: request.toolUseId,
            toolName: 'AskUserQuestion',
            questions,
            createdAt: new Date().toISOString(),
            ...this.getSubagentContext(request.agentId),
          },
        });
        const result = await this.waitForUserInteraction({
          requestId,
          webContentsId: sender.id,
          signal: request.signal,
          kind: 'ask_user_question',
          input: request.input,
          toolUseId: request.toolUseId,
          questions,
          ...this.getSubagentContext(request.agentId),
        });
        this.setState(this.abortController ? 'running' : 'ready');
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
      });
      this.emitStatus();
    });
  }

  private getSubagentContext(agentId?: string) {
    const run = agentId
      ? this.subagentRuns.find((candidate) => candidate.agentId === agentId)
      : undefined;
    return {
      ...(agentId ? { agentId } : {}),
      ...(run ? { subagentRunId: run.id, agentType: run.agentType } : {}),
    };
  }

  private resolvePermission(requestId: string, approved: boolean, webContentsId?: number) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending || (webContentsId !== undefined && pending.webContentsId !== webContentsId)) return;
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
  }

  private answerUserQuestion(
    requestId: string,
    input: unknown,
    webContentsId?: number,
  ) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending || pending.kind !== 'ask_user_question' || !pending.questions) {
      throw new Error('The clarifying question is no longer active');
    }
    if (webContentsId !== undefined && pending.webContentsId !== webContentsId) {
      throw new Error('The clarifying question belongs to another window');
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
    this.emitStatus();
  }

  private resolveAllPermissions(approved: boolean) {
    for (const [requestId, pending] of [...this.pendingPermissions.entries()]) {
      this.resolvePermission(requestId, approved && pending.kind === 'tool_approval');
    }
    this.pendingPermissions.clear();
  }

  private resolvePermissionsForWebContents(webContentsId: number, approved: boolean) {
    for (const [requestId, pending] of [...this.pendingPermissions.entries()]) {
      if (pending.webContentsId === webContentsId) {
        this.resolvePermission(requestId, approved && pending.kind === 'tool_approval');
      }
    }
  }

  private emitStreamingMessage(
    sender: WebContents,
    id: string,
    content: string,
    activities: AgentActivity[],
  ) {
    this.emitMessage(sender, {
      id,
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      status: 'streaming',
      activities,
    });
  }

  private emitMessage(sender: WebContents, message: PersistedChatMessage) {
    if (!sender.isDestroyed()) {
      sender.send('agent:message', {
        sessionId: this.activeSessionId,
        branchId: this.activeBranchId,
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

  private emitSubagentUpdates(sender: WebContents, runIds: Set<string>) {
    if (sender.isDestroyed()) return;
    for (const runId of runIds) {
      const run = this.subagentRuns.find((candidate) => candidate.id === runId);
      if (!run) continue;
      sender.send('agent:subagent-update', {
        sessionId: this.activeSessionId,
        branchId: this.activeBranchId,
        run: cloneSubagentRun(run),
      });
    }
  }

  private mergeSubagentRuns(runs: SubagentRun[]) {
    if (runs.length === 0) return;
    const byId = new Map(this.subagentRuns.map((run) => [run.id, run]));
    const focusedTaskId = this.branches.find((branch) => branch.id === this.activeBranchId)?.focusedTaskId ?? undefined;
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

  private bindActivitiesToFocusedTask(focusedTaskId: string | undefined, activities: AgentActivity[], bindings: Map<string, string>) {
    if (!focusedTaskId && bindings.size === 0) return activities;
    return activities.map((activity) => {
      const prior = bindings.get(activity.id);
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
    return {
      state: this.state,
      backendId,
      available: backendStatus?.available ?? false,
      authenticated: stored ? this.authenticated : backendStatus?.authenticated ?? this.authenticated,
      model: stored?.model ?? this.model ?? backendStatus?.model ?? null,
      backendSessionId: stored ? storedSessionId : activeBackendSessionId,
      pendingRequests: this.pendingPermissions.size,
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
          status,
        });
      }
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
