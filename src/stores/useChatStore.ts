import { create } from 'zustand';
import {
  attachmentMetadata,
  agentContextRefKey,
  type AgentAttachment,
  type AgentContextRef,
  type AgentStatus,
  type AskUserQuestionAnswers,
  type AgentMessageEvent,
  type AgentStatusEvent,
  type AgentSubagentUpdateEvent,
  type AgentToolRequestEvent,
  type ChatMessage,
  type ContextTab,
  type ToolRequest,
  type AutonomyLevel,
  type AgentPermissionMode,
  type ConversationBranchSummary,
  type ProjectActivation,
  type ProjectWorkspaceState,
  type AgentHistoryPage,
  type AgentActivityPage,
  type SubagentDetailPage,
  type SubagentRun,
  type WorkflowInvocation,
} from '@/types';
import { buildAgentTargetContext } from '@/lib/networkGraph';
import { reconcileAgentActivities } from '@/lib/agentActivity';
import { buildSelectedRecordContextTab } from '@/lib/agentRecordContext';
import { useTabStore } from './useTabStore';
import { useNetMapStore } from './useNetMapStore';
import { usePentestTreeStore } from './usePentestTreeStore';
import { useSessionStore } from './useSessionStore';

const LIVE_EVENT_FLUSH_MS = 80;
let historyRequestEpoch = 0;

interface ChatStore {
  activeProjectId: string | null;
  messages: ChatMessage[];
  branches: ConversationBranchSummary[];
  activeBranchId: string;
  contextTabs: ContextTab[];
  composerText: string;
  composerContextRefs: AgentContextRef[];
  composerFocusNonce: number;
  pendingToolRequest: ToolRequest | null;
  autonomyLevel: AutonomyLevel;
  permissionMode: AgentPermissionMode;
  isProcessing: boolean;
  error: string | null;
  agentStatus: AgentStatus;
  subagentRuns: SubagentRun[];
  subagentView: 'conversation' | 'subagent-detail';
  selectedSubagentRunId: string | null;
  chatScrollTop: number;
  history: AgentHistoryPage;
  loadingEarlierHistory: boolean;
  loadingHistoryActivities: string | null;
  loadingSubagentDetail: string | null;

  activateProject: (sessionId: string) => Promise<ProjectWorkspaceState>;
  deactivateProject: () => void;
  sendMessage: (content: string, attachments?: AgentAttachment[], workflowInvocation?: WorkflowInvocation) => Promise<void>;
  newConversation: () => Promise<boolean>;
  branchFromMessage: (messageId: string, content: string) => Promise<void>;
  switchBranch: (branchId: string) => Promise<void>;
  appendMessage: (msg: ChatMessage) => void;
  clearChat: () => void;
  setContextTabs: (tabs: ContextTab[]) => void;
  syncContextTabs: (tabs: Omit<ContextTab, 'isShared'>[]) => void;
  toggleTabSharing: (tabId: string) => void;
  setComposerText: (text: string) => void;
  queueAgentContext: (ref: AgentContextRef, defaultPrompt: string) => void;
  removeComposerContext: (key: string) => void;
  setAutonomyLevel: (level: AutonomyLevel) => void;
  setPermissionMode: (mode: AgentPermissionMode) => void;
  approveToolRequest: (requestId: string) => Promise<void>;
  rejectToolRequest: (requestId: string) => void;
  answerUserQuestion: (requestId: string, answers: AskUserQuestionAnswers) => Promise<void>;
  cancelRequest: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  openSubagent: (runId: string) => void;
  closeSubagent: () => void;
  setChatScrollTop: (value: number) => void;
  loadEarlierHistory: () => Promise<boolean>;
  loadEarlierActivities: (messageId: string) => Promise<boolean>;
  loadSubagentDetail: (runId: string) => Promise<boolean>;

  /** Subscribe to agent events from main process */
  subscribeToAgent: () => () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  activeProjectId: null,
  messages: [],
  branches: [mainBranchSummary()],
  activeBranchId: 'main',
  contextTabs: [],
  composerText: '',
  composerContextRefs: [],
  composerFocusNonce: 0,
  pendingToolRequest: null,
  autonomyLevel: 'medium',
  permissionMode: 'default',
  isProcessing: false,
  error: null,
  agentStatus: {
    state: 'loading',
    backendId: 'claude',
    available: false,
    authenticated: null,
    model: null,
    backendSessionId: null,
    pendingRequests: 0,
    historyLength: 0,
    lastError: null,
    runtimeMode: 'wsl',
    runtimeLabel: 'WSL · Ubuntu-24.04',
  },
  subagentRuns: [],
  subagentView: 'conversation',
  selectedSubagentRunId: null,
  chatScrollTop: 0,
  history: emptyHistoryPage(),
  loadingEarlierHistory: false,
  loadingHistoryActivities: null,
  loadingSubagentDetail: null,

  activateProject: async (sessionId) => {
    const requestEpoch = ++historyRequestEpoch;
    set({
      activeProjectId: sessionId,
      messages: [],
      branches: [mainBranchSummary()],
      activeBranchId: 'main',
      contextTabs: [],
      composerText: '',
      composerContextRefs: [],
      pendingToolRequest: null,
      isProcessing: false,
      error: null,
      subagentRuns: [],
      subagentView: 'conversation',
      selectedSubagentRunId: null,
      chatScrollTop: 0,
      history: emptyHistoryPage(),
      loadingEarlierHistory: false,
      loadingHistoryActivities: null,
      loadingSubagentDetail: null,
    });
    if (!window.hexestra) {
      return { tabs: [], activeTabId: null, nextTabNumber: 1 };
    }
    try {
      const activation = await window.hexestra.invoke<ProjectActivation>('agent:activate', sessionId);
      if (get().activeProjectId === sessionId && requestEpoch === historyRequestEpoch) {
        set({
          messages: activation.messages,
          branches: activation.branches,
          activeBranchId: activation.activeBranchId,
          autonomyLevel: activation.preferences.autonomyLevel,
          permissionMode: activation.preferences.permissionMode,
          agentStatus: activation.status,
          subagentRuns: activation.subagentRuns ?? [],
          subagentView: 'conversation',
          selectedSubagentRunId: null,
          chatScrollTop: 0,
          history: activation.history ?? historyFromMessages(activation.messages),
          loadingEarlierHistory: false,
          loadingHistoryActivities: null,
          loadingSubagentDetail: null,
          isProcessing:
            activation.status.state === 'running'
            || activation.status.state === 'awaiting_approval'
            || activation.status.state === 'awaiting_input',
        });
      }
      return activation.workspace;
    } catch (error) {
      if (get().activeProjectId === sessionId && requestEpoch === historyRequestEpoch) set({ error: String(error) });
      throw error;
    }
  },

  deactivateProject: () => {
    historyRequestEpoch += 1;
    set({
    activeProjectId: null,
    messages: [],
    branches: [mainBranchSummary()],
    activeBranchId: 'main',
    contextTabs: [],
    composerText: '',
    composerContextRefs: [],
    pendingToolRequest: null,
    isProcessing: false,
    error: null,
    subagentRuns: [],
    subagentView: 'conversation',
    selectedSubagentRunId: null,
    chatScrollTop: 0,
    history: emptyHistoryPage(),
    loadingEarlierHistory: false,
    loadingHistoryActivities: null,
    loadingSubagentDetail: null,
    });
  },

  sendMessage: async (content, attachments = [], workflowInvocation) => {
    const session = useSessionStore.getState().currentSession;
    const activeProjectId = get().activeProjectId;
    if (!session || session.id !== activeProjectId) {
      set({ error: 'Open a project folder before chatting with Claude.' });
      return;
    }
    const contextRefs = get().composerContextRefs;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      status: 'complete',
      ...(attachments.length ? { attachments: attachments.map(attachmentMetadata) } : {}),
      ...(contextRefs.length ? { contextRefs } : {}),
      ...(workflowInvocation ? { workflowInvocation } : {}),
    };
    set((s) => ({
      messages: [...s.messages, msg],
      branches: s.branches.map((branch) =>
        branch.id === s.activeBranchId
          ? {
              ...branch,
              ...(s.messages.length === 0 ? { title: compactBranchTitle(content, s.branches.length) } : {}),
              messageCount: branch.messageCount + 1,
            }
          : branch
      ),
      history: {
        ...s.history,
        items: [...s.messages, msg],
        total: s.history.total + 1,
      },
      isProcessing: true,
      error: null,
      composerText: '',
      composerContextRefs: [],
    }));

    try {
      if (window.hexestra) {
        await window.hexestra.invoke('agent:send', buildAgentRequest(content, msg.id, get(), attachments, contextRefs, workflowInvocation));
      }
    } catch (e) {
      set({
        error: String(e),
        isProcessing: false,
      });
    }
  },

  newConversation: async () => {
    const state = get();
    const requestEpoch = ++historyRequestEpoch;
    if (!window.hexestra || !state.activeProjectId) {
      set({ error: 'Open a project folder before creating a conversation.' });
      return false;
    }
    if (state.isProcessing) {
      set({ error: 'Wait for the active Claude request to finish.' });
      return false;
    }

    const conversationId = `conversation-${crypto.randomUUID()}`;
    const previous = {
      messages: state.messages,
      branches: state.branches,
      activeBranchId: state.activeBranchId,
      subagentRuns: state.subagentRuns,
      subagentView: state.subagentView,
      selectedSubagentRunId: state.selectedSubagentRunId,
      pendingToolRequest: state.pendingToolRequest,
      history: state.history,
    };
    const optimisticConversation: ConversationBranchSummary = {
      id: conversationId,
      title: `New conversation ${state.branches.length + 1}`,
      backendId: state.agentStatus.backendId,
      createdAt: new Date().toISOString(),
      messageCount: 0,
    };
    set({
      messages: [],
      branches: [...state.branches, optimisticConversation],
      activeBranchId: conversationId,
      composerText: '',
      composerContextRefs: [],
      pendingToolRequest: null,
      subagentRuns: [],
      subagentView: 'conversation',
      selectedSubagentRunId: null,
      chatScrollTop: 0,
      history: emptyHistoryPage(),
      loadingEarlierHistory: false,
      loadingHistoryActivities: null,
      loadingSubagentDetail: null,
      error: null,
    });

    try {
      const activation = await window.hexestra.invoke<Pick<
        ProjectActivation,
        'messages' | 'history' | 'branches' | 'activeBranchId' | 'status' | 'subagentRuns'
      >>('agent:conversation:new', state.activeProjectId, conversationId);
      if (get().activeProjectId === state.activeProjectId && requestEpoch === historyRequestEpoch) {
        set({
          messages: activation.messages,
          branches: activation.branches,
          activeBranchId: activation.activeBranchId,
          agentStatus: activation.status,
          subagentRuns: activation.subagentRuns ?? [],
          subagentView: 'conversation',
          selectedSubagentRunId: null,
          chatScrollTop: 0,
          history: activation.history ?? historyFromMessages(activation.messages),
          loadingEarlierHistory: false,
          loadingHistoryActivities: null,
          loadingSubagentDetail: null,
        });
        return true;
      }
      return false;
    } catch (error) {
      if (get().activeProjectId === state.activeProjectId && requestEpoch === historyRequestEpoch) {
        set({ ...previous, error: String(error) });
      }
      return false;
    }
  },

  branchFromMessage: async (messageId, content) => {
    const state = get();
    const requestEpoch = ++historyRequestEpoch;
    const session = useSessionStore.getState().currentSession;
    const sourceIndex = state.messages.findIndex(
      (message) => message.id === messageId && message.role === 'user',
    );
    const sourceContextRefs = sourceIndex >= 0 ? state.messages[sourceIndex].contextRefs ?? [] : [];
    if (!session || session.id !== state.activeProjectId || sourceIndex < 0) {
      set({ error: 'The selected conversation turn is unavailable.' });
      return;
    }
    if (state.isProcessing) {
      set({ error: 'Wait for the active Claude request to finish before branching.' });
      return;
    }

    const newBranchId = `branch-${crypto.randomUUID()}`;
    const newMessageId = crypto.randomUUID();
    const optimisticMessage: ChatMessage = {
      id: newMessageId,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      status: 'complete',
      ...(sourceContextRefs.length ? { contextRefs: sourceContextRefs } : {}),
    };
    const previous = {
      messages: state.messages,
      branches: state.branches,
      activeBranchId: state.activeBranchId,
      subagentRuns: state.subagentRuns,
      subagentView: state.subagentView,
      selectedSubagentRunId: state.selectedSubagentRunId,
      history: state.history,
    };
    const optimisticBranch: ConversationBranchSummary = {
      id: newBranchId,
      title: compactBranchTitle(content, state.branches.length + 1),
      backendId: state.agentStatus.backendId,
      parentBranchId: state.activeBranchId,
      forkedFromMessageId: messageId,
      createdAt: new Date().toISOString(),
      messageCount: sourceIndex + 1,
    };
    set({
      messages: [...state.messages.slice(0, sourceIndex), optimisticMessage],
      branches: [...state.branches, optimisticBranch],
      activeBranchId: newBranchId,
      isProcessing: true,
      pendingToolRequest: null,
      subagentRuns: [],
      subagentView: 'conversation',
      selectedSubagentRunId: null,
      chatScrollTop: 0,
      history: historyFromMessages([optimisticMessage]),
      loadingEarlierHistory: false,
      loadingHistoryActivities: null,
      loadingSubagentDetail: null,
      error: null,
    });

    try {
      if (!window.hexestra) return;
      const activation = await window.hexestra.invoke<Pick<
        ProjectActivation,
        'messages' | 'history' | 'branches' | 'activeBranchId' | 'status' | 'subagentRuns'
      >>('agent:branch', {
        sourceMessageId: messageId,
        newBranchId,
        request: buildAgentRequest(content, newMessageId, get(), [], sourceContextRefs),
      });
      if (get().activeProjectId === session.id && requestEpoch === historyRequestEpoch) {
        set({
          messages: activation.messages,
          branches: activation.branches,
          activeBranchId: activation.activeBranchId,
          agentStatus: activation.status,
          subagentRuns: activation.subagentRuns ?? [],
          subagentView: 'conversation',
          selectedSubagentRunId: null,
          chatScrollTop: 0,
          history: activation.history ?? historyFromMessages(activation.messages),
          loadingEarlierHistory: false,
          loadingHistoryActivities: null,
          loadingSubagentDetail: null,
          isProcessing: false,
        });
      }
    } catch (error) {
      set({
        ...previous,
        isProcessing: false,
        error: String(error),
      });
    }
  },

  switchBranch: async (branchId) => {
    const state = get();
    const requestEpoch = ++historyRequestEpoch;
    if (branchId === state.activeBranchId || state.isProcessing) return;
    if (!window.hexestra || !state.activeProjectId) return;
    const previous = {
      activeBranchId: state.activeBranchId,
      messages: state.messages,
      pendingToolRequest: state.pendingToolRequest,
      subagentRuns: state.subagentRuns,
      subagentView: state.subagentView,
      selectedSubagentRunId: state.selectedSubagentRunId,
      history: state.history,
    };
    set({
      activeBranchId: branchId,
      messages: [],
      composerText: '',
      composerContextRefs: [],
      pendingToolRequest: null,
      subagentRuns: [],
      subagentView: 'conversation',
      selectedSubagentRunId: null,
      chatScrollTop: 0,
      history: emptyHistoryPage(),
      loadingEarlierHistory: false,
      loadingHistoryActivities: null,
      loadingSubagentDetail: null,
      error: null,
    });
    try {
      const activation = await window.hexestra.invoke<Pick<
        ProjectActivation,
        'messages' | 'history' | 'branches' | 'activeBranchId' | 'status' | 'subagentRuns'
      >>('agent:branch:activate', state.activeProjectId, branchId);
      if (get().activeProjectId === state.activeProjectId && requestEpoch === historyRequestEpoch) {
        set({
          messages: activation.messages,
          branches: activation.branches,
          activeBranchId: activation.activeBranchId,
          agentStatus: activation.status,
          subagentRuns: activation.subagentRuns ?? [],
          subagentView: 'conversation',
          selectedSubagentRunId: null,
          chatScrollTop: 0,
          history: activation.history ?? historyFromMessages(activation.messages),
          loadingEarlierHistory: false,
          loadingHistoryActivities: null,
          loadingSubagentDetail: null,
        });
      }
    } catch (error) {
      set({ ...previous, error: String(error) });
    }
  },

  appendMessage: (msg) =>
    set((s) => {
      const msgs = [...s.messages];
      const idx = msgs.findIndex((candidate) => candidate.id === msg.id);
      const previousActivityCount = idx >= 0 ? (msgs[idx].activities?.length ?? 0) : 0;
      if (idx >= 0) {
        const activities = reconcileAgentActivities(msgs[idx].activities, msg.activities);
        msgs[idx] = activities === msg.activities ? msg : { ...msg, activities };
      }
      else msgs.push(msg);
      const activeBranch = s.branches.find((branch) => branch.id === s.activeBranchId);
      const isNewMessage = idx < 0;
      const nextActivityCount = idx >= 0 ? (msgs[idx].activities?.length ?? 0) : (msg.activities?.length ?? 0);
      const activityDelta = isNewMessage ? nextActivityCount : Math.max(0, nextActivityCount - previousActivityCount);
      return {
        messages: msgs,
        branches: activeBranch
          ? s.branches.map((branch) =>
              branch.id === s.activeBranchId
                ? {
                    ...branch,
                    // messageCount is the backend total, never the loaded window length.
                    messageCount: Math.max(branch.messageCount, isNewMessage ? branch.messageCount + 1 : branch.messageCount),
                  }
                : branch
            )
          : s.branches,
        history: {
          ...s.history,
          total: isNewMessage ? s.history.total + 1 : s.history.total,
          totalActivities: s.history.totalActivities + activityDelta,
          items: msgs,
        },
        isProcessing: msg.status === 'streaming' || msg.status === 'sending',
      };
    }),

  clearChat: async () => {
    historyRequestEpoch += 1;
    const sessionId = get().activeProjectId;
    if (window.hexestra) {
      await window.hexestra.invoke('agent:clear', sessionId);
    }
    set({
      messages: [],
      branches: [mainBranchSummary()],
      activeBranchId: 'main',
      composerText: '',
      composerContextRefs: [],
      pendingToolRequest: null,
      error: null,
      subagentRuns: [],
      subagentView: 'conversation',
      selectedSubagentRunId: null,
      chatScrollTop: 0,
      history: emptyHistoryPage(),
      loadingEarlierHistory: false,
      loadingHistoryActivities: null,
      loadingSubagentDetail: null,
    });
  },

  setContextTabs: (tabs) => set({ contextTabs: tabs }),
  syncContextTabs: (tabs) =>
    set((state) => ({
      contextTabs: tabs.map((tab) => ({
        ...tab,
        isShared:
          state.contextTabs.find((existing) => existing.tabId === tab.tabId)?.isShared ?? true,
      })),
    })),
  toggleTabSharing: (tabId) =>
    set((s) => ({
      contextTabs: s.contextTabs.map((t) =>
        t.tabId === tabId ? { ...t, isShared: !t.isShared } : t
      ),
    })),
  setComposerText: (composerText) => set({ composerText }),
  queueAgentContext: (ref, defaultPrompt) => set((state) => {
    const key = agentContextRefKey(ref);
    const next = [...state.composerContextRefs.filter((candidate) => agentContextRefKey(candidate) !== key), ref].slice(-8);
    return {
      composerContextRefs: next,
      composerText: state.composerText.trim() ? state.composerText : defaultPrompt,
      composerFocusNonce: state.composerFocusNonce + 1,
    };
  }),
  removeComposerContext: (key) => set((state) => ({
    composerContextRefs: state.composerContextRefs.filter((ref) => agentContextRefKey(ref) !== key),
  })),

  setAutonomyLevel: (level) => {
    set({ autonomyLevel: level });
    const sessionId = get().activeProjectId;
    if (window.hexestra && sessionId) {
      void window.hexestra.invoke('project:update', sessionId, {
        preferences: { autonomyLevel: level },
      });
    }
  },
  setPermissionMode: (mode) => {
    set({ permissionMode: mode });
    const sessionId = get().activeProjectId;
    if (window.hexestra && sessionId) {
      void window.hexestra.invoke('project:update', sessionId, {
        preferences: { permissionMode: mode },
      });
    }
  },

  approveToolRequest: async (requestId) => {
    if (window.hexestra) {
      await window.hexestra.invoke('agent:approve-tool', requestId);
    }
    set({ pendingToolRequest: null });
  },

  rejectToolRequest: (requestId) => {
    if (window.hexestra) {
      window.hexestra.invoke('agent:reject-tool', requestId);
    }
    set({ pendingToolRequest: null });
  },

  answerUserQuestion: async (requestId, answers) => {
    if (!window.hexestra) return;
    try {
      await window.hexestra.invoke('agent:answer-question', requestId, answers);
      if (get().pendingToolRequest?.id === requestId) {
        set({ pendingToolRequest: null, error: null });
      }
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  cancelRequest: async () => {
    if (window.hexestra) await window.hexestra.invoke('agent:cancel', get().activeProjectId);
    set({ isProcessing: false, pendingToolRequest: null });
  },

  openSubagent: (runId) => {
    if (!get().subagentRuns.some((run) => run.id === runId)) return;
    set({ selectedSubagentRunId: runId, subagentView: 'subagent-detail' });
  },

  closeSubagent: () => set({ selectedSubagentRunId: null, subagentView: 'conversation' }),
  setChatScrollTop: (chatScrollTop) => set({ chatScrollTop }),

  loadEarlierHistory: async () => {
    const state = get();
    const requestEpoch = historyRequestEpoch;
    const sessionId = state.activeProjectId;
    const branchId = state.activeBranchId;
    if (!window.hexestra || !sessionId || !state.history.hasEarlier || state.loadingEarlierHistory) return false;
    set({ loadingEarlierHistory: true });
    try {
      const page = await window.hexestra.invoke<AgentHistoryPage>(
        'agent:history:page',
        sessionId,
        branchId,
        state.history.beforeCursor,
      );
      if (get().activeProjectId !== sessionId || get().activeBranchId !== branchId || requestEpoch !== historyRequestEpoch) return false;
      set((current) => {
        const existingIds = new Set(current.messages.map((message) => message.id));
        const earlier = page.items.filter((message) => !existingIds.has(message.id));
        return {
          messages: [...earlier, ...current.messages],
          history: {
            ...page,
            items: [...earlier, ...current.messages],
          },
        };
      });
      return true;
    } catch (error) {
      if (get().activeProjectId === sessionId && get().activeBranchId === branchId && requestEpoch === historyRequestEpoch) {
        set({ error: String(error) });
      }
      return false;
    } finally {
      if (get().activeProjectId === sessionId && get().activeBranchId === branchId && requestEpoch === historyRequestEpoch) {
        set({ loadingEarlierHistory: false });
      }
    }
  },

  loadEarlierActivities: async (messageId) => {
    const state = get();
    const requestEpoch = historyRequestEpoch;
    const sessionId = state.activeProjectId;
    const branchId = state.activeBranchId;
    const message = state.messages.find((candidate) => candidate.id === messageId);
    if (!window.hexestra || !sessionId || !message || state.loadingHistoryActivities === messageId) return false;
    const hiddenActivityCount = message.hiddenActivityCount ?? 0;
    if (hiddenActivityCount <= 0) return false;
    set({ loadingHistoryActivities: messageId });
    try {
      const page = await window.hexestra.invoke<AgentActivityPage>(
        'agent:history:activities',
        sessionId,
        branchId,
        messageId,
        String(hiddenActivityCount),
      );
      if (get().activeProjectId !== sessionId || get().activeBranchId !== branchId || requestEpoch !== historyRequestEpoch) return false;
      set((current) => ({
        messages: current.messages.map((candidate) => {
          if (candidate.id !== messageId) return candidate;
          const currentActivities = candidate.activities ?? [];
          const existingIds = new Set(currentActivities.map((activity) => activity.id));
          const earlier = page.items.filter((activity) => !existingIds.has(activity.id));
          const nextHidden = page.beforeCursor ? Number(page.beforeCursor) : 0;
          return {
            ...candidate,
            activities: [...earlier, ...currentActivities],
            hiddenActivityCount: nextHidden > 0 ? nextHidden : undefined,
          };
        }),
      }));
      set((current) => ({ history: { ...current.history, items: current.messages } }));
      return true;
    } catch (error) {
      if (get().activeProjectId === sessionId && get().activeBranchId === branchId && requestEpoch === historyRequestEpoch) {
        set({ error: String(error) });
      }
      return false;
    } finally {
      if (get().activeProjectId === sessionId && get().activeBranchId === branchId && requestEpoch === historyRequestEpoch) {
        set({ loadingHistoryActivities: null });
      }
    }
  },

  loadSubagentDetail: async (runId) => {
    const state = get();
    const requestEpoch = historyRequestEpoch;
    const sessionId = state.activeProjectId;
    const branchId = state.activeBranchId;
    const run = state.subagentRuns.find((candidate) => candidate.id === runId);
    if (!window.hexestra || !sessionId || !run || state.loadingSubagentDetail === runId) return false;
    set({ loadingSubagentDetail: runId });
    try {
      const page = await window.hexestra.invoke<SubagentDetailPage>(
        'agent:subagent:detail',
        sessionId,
        branchId,
        runId,
        run.hiddenActivityCount ? String(run.hiddenActivityCount) : undefined,
      );
      if (get().activeProjectId !== sessionId || get().activeBranchId !== branchId || requestEpoch !== historyRequestEpoch || !page.run) return false;
      set((current) => ({
        subagentRuns: current.subagentRuns.map((candidate) =>
          candidate.id === runId
            ? (() => {
                const existingActivities = candidate.activities ?? [];
                const existingIds = new Set(existingActivities.map((activity) => activity.id));
                const earlierActivities = page.run!.activities.filter((activity) => !existingIds.has(activity.id));
                return {
                  ...page.run!,
                  activities: [...earlierActivities, ...existingActivities],
                  hiddenActivityCount: page.page?.beforeCursor
                    ? Number(page.page.beforeCursor)
                    : undefined,
                };
              })()
            : candidate,
        ),
      }));
      return true;
    } catch (error) {
      if (get().activeProjectId === sessionId && get().activeBranchId === branchId && requestEpoch === historyRequestEpoch) {
        set({ error: String(error) });
      }
      return false;
    } finally {
      if (get().activeProjectId === sessionId && get().activeBranchId === branchId && requestEpoch === historyRequestEpoch) {
        set({ loadingSubagentDetail: null });
      }
    }
  },

  refreshStatus: async () => {
    const sessionId = get().activeProjectId;
    if (!window.hexestra || !sessionId) return;
    const agentStatus = await window.hexestra.invoke<AgentStatus>('agent:status', sessionId);
    if (get().activeProjectId === sessionId) set({ agentStatus });
  },

  /** Subscribe to agent events from main process */
  subscribeToAgent: () => {
    if (!window.hexestra) return () => {};

    const pendingMessages = new Map<string, AgentMessageEvent>();
    const pendingSubagents = new Map<string, AgentSubagentUpdateEvent>();
    let messageFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let subagentFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const applyMessage = (event: AgentMessageEvent) => {
      if (
        event.sessionId === get().activeProjectId
        && event.branchId === get().activeBranchId
      ) get().appendMessage(event.message);
    };
    const flushMessages = () => {
      messageFlushTimer = null;
      const events = [...pendingMessages.values()];
      pendingMessages.clear();
      events.forEach(applyMessage);
    };
    const applySubagent = (event: AgentSubagentUpdateEvent) => {
      if (event.sessionId !== get().activeProjectId || event.branchId !== get().activeBranchId) return;
      set((state) => {
        const index = state.subagentRuns.findIndex((run) => run.id === event.run.id);
        if (index < 0) return { subagentRuns: [...state.subagentRuns, event.run] };
        const next = [...state.subagentRuns];
        next[index] = event.run;
        return { subagentRuns: next };
      });
    };
    const flushSubagents = () => {
      subagentFlushTimer = null;
      const events = [...pendingSubagents.values()];
      pendingSubagents.clear();
      events.forEach(applySubagent);
    };

    const unsub = window.hexestra.on('agent:message', (data: unknown) => {
      const event = data as AgentMessageEvent;
      if (event.sessionId !== get().activeProjectId || event.branchId !== get().activeBranchId) return;
      const isLiveUpdate = event.message.status === 'streaming' || event.message.status === 'sending';
      const alreadyProjected = get().messages.some((message) => message.id === event.message.id);
      if (!isLiveUpdate || !alreadyProjected) {
        pendingMessages.delete(event.message.id);
        applyMessage(event);
        return;
      }
      pendingMessages.set(event.message.id, event);
      if (!messageFlushTimer) messageFlushTimer = setTimeout(flushMessages, LIVE_EVENT_FLUSH_MS);
    });

    const unsubTool = window.hexestra.on('agent:tool-request', (data: unknown) => {
      const event = data as AgentToolRequestEvent;
      if (event.sessionId === get().activeProjectId) {
        set({ pendingToolRequest: event.request });
      }
    });

    const unsubStatus = window.hexestra.on('agent:status', (data: unknown) => {
      const event = data as AgentStatusEvent;
      if (event.sessionId !== get().activeProjectId) return;
      const agentStatus = event.status;
      set({
        agentStatus,
        isProcessing:
          agentStatus.state === 'running'
          || agentStatus.state === 'awaiting_approval'
          || agentStatus.state === 'awaiting_input',
      });
    });

    const unsubSubagent = window.hexestra.on('agent:subagent-update', (data: unknown) => {
      const event = data as AgentSubagentUpdateEvent;
      if (event.sessionId !== get().activeProjectId || event.branchId !== get().activeBranchId) return;
      const alreadyProjected = get().subagentRuns.some((run) => run.id === event.run.id);
      if (!alreadyProjected || isTerminalSubagentStatus(event.run.status)) {
        pendingSubagents.delete(event.run.id);
        applySubagent(event);
        return;
      }
      pendingSubagents.set(event.run.id, event);
      if (!subagentFlushTimer) subagentFlushTimer = setTimeout(flushSubagents, LIVE_EVENT_FLUSH_MS);
    });

    void get().refreshStatus();

    return () => {
      if (messageFlushTimer) clearTimeout(messageFlushTimer);
      if (subagentFlushTimer) clearTimeout(subagentFlushTimer);
      pendingMessages.clear();
      pendingSubagents.clear();
      unsub();
      unsubTool();
      unsubStatus();
      unsubSubagent();
    };
  },
}));

function buildAgentRequest(
  content: string,
  clientMessageId: string,
  state: ChatStore,
  attachments: AgentAttachment[] = [],
  contextRefs: AgentContextRef[] = [],
  workflowInvocation?: WorkflowInvocation,
) {
  const session = useSessionStore.getState().currentSession;
  const netmap = useNetMapStore.getState();
  const selectedContext = buildAgentTargetContext(
    netmap.selectedNodeId,
    netmap.nodes,
    netmap.edges,
    useSessionStore.getState().targets,
    useSessionStore.getState().assets,
  );
  const selectedTarget = selectedContext
    ? {
        ...selectedContext.target,
        relationships: selectedContext.relationships,
        neighbors: selectedContext.neighbors,
        pathFromLocal: selectedContext.pathFromLocal,
      }
    : undefined;
  const contextTabs = state.contextTabs
    .filter((tab) => tab.type !== 'record' && tab.isShared)
    .map(({ isShared: _isShared, ...tab }) => tab);
  const selectedRecord = buildSelectedRecordContextTab(
    useTabStore.getState().activeTab(),
    useSessionStore.getState(),
  );
  const selectedRecordPreference = selectedRecord
    ? state.contextTabs.find((tab) => tab.tabId === selectedRecord.tabId)
    : undefined;
  if (selectedRecord && selectedRecordPreference?.isShared !== false) {
    contextTabs.push(selectedRecord);
  }
  return {
    content,
    clientMessageId,
    autonomyLevel: state.autonomyLevel,
    permissionMode: state.permissionMode,
    session: session
      ? { id: session.id, name: session.name, scope: session.scope }
      : undefined,
    selectedTarget,
    tasks: usePentestTreeStore.getState().tasks.map((task) => ({
      id: task.id,
      primaryTacticId: task.primaryTacticId,
      techniqueIds: task.techniqueIds,
      title: task.title,
      status: task.status,
    })),
    contextTabs,
    attachments,
    contextRefs,
    ...(workflowInvocation ? { workflowInvocation } : {}),
  };
}


function mainBranchSummary(): ConversationBranchSummary {
  return {
    id: 'main',
    title: 'Main',
    backendId: 'claude',
    createdAt: new Date().toISOString(),
    messageCount: 0,
  };
}

function emptyHistoryPage(): AgentHistoryPage {
  return {
    items: [],
    beforeCursor: null,
    hasEarlier: false,
    total: 0,
    totalActivities: 0,
  };
}

function historyFromMessages(messages: ChatMessage[]): AgentHistoryPage {
  return {
    items: messages,
    beforeCursor: null,
    hasEarlier: false,
    total: messages.length,
    totalActivities: messages.reduce((sum, message) => sum + (message.activities?.length ?? 0), 0),
  };
}

function isTerminalSubagentStatus(status: SubagentRun['status']) {
  return status !== 'pending' && status !== 'running';
}

function compactBranchTitle(content: string, index: number) {
  const compact = content.trim().replace(/\s+/g, ' ');
  return compact ? compact.slice(0, 48) : `Branch ${index}`;
}
