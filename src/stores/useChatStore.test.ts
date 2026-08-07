import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessageEvent, AgentStatus, ProjectActivation } from '@/types';
import { useChatStore } from './useChatStore';
import { useSessionStore } from './useSessionStore';

const readyStatus: AgentStatus = {
  state: 'ready',
  available: true,
  backendId: 'claude',
  authenticated: true,
  model: 'test-model',
  backendSessionId: null,
  pendingRequests: 0,
  historyLength: 0,
  lastError: null,
  runtimeMode: 'wsl',
  runtimeLabel: 'WSL · Ubuntu-24.04',
};

function activation(sessionId: string, content: string): ProjectActivation {
  return {
    sessionId,
    messages: content ? [{
      id: `message-${sessionId}`,
      role: 'assistant',
      content,
      timestamp: '2026-07-18T00:00:00.000Z',
      status: 'complete',
    }] : [],
    activeBranchId: 'main',
    branches: [{
      id: 'main',
      title: 'Main',
      backendId: 'claude',
      createdAt: '2026-07-18T00:00:00.000Z',
      messageCount: content ? 1 : 0,
    }],
    status: { ...readyStatus, historyLength: content ? 1 : 0 },
    preferences: {
      permissionMode: sessionId === 'project-b' ? 'auto' : 'default',
      autonomyLevel: 'medium',
    },
    workspace: {
      tabs: [{ id: `welcome-${sessionId}`, type: 'welcome', title: 'Welcome', closable: false }],
      activeTabId: `welcome-${sessionId}`,
      nextTabNumber: 1,
    },
  };
}

describe('useChatStore project isolation', () => {
  const listeners = new Map<string, (data: unknown) => void>();
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'agent:activate') {
      const sessionId = args[0] as string;
      return activation(sessionId, sessionId === 'project-a' ? 'A history' : 'B history');
    }
    if (channel === 'agent:status') return readyStatus;
    if (channel === 'agent:branch') {
      const input = args[0] as {
        newBranchId: string;
        request: { clientMessageId: string; content: string };
      };
      return {
        messages: [{
          id: input.request.clientMessageId,
          role: 'user',
          content: input.request.content,
          timestamp: '2026-07-31T00:00:00.000Z',
          status: 'complete',
        }],
        activeBranchId: input.newBranchId,
        branches: [
          { id: 'main', title: 'Main', backendId: 'claude', createdAt: '2026-07-18T00:00:00.000Z', messageCount: 2 },
          { id: input.newBranchId, title: input.request.content, backendId: 'claude', createdAt: '2026-07-31T00:00:00.000Z', messageCount: 1 },
        ],
        status: readyStatus,
      };
    }
    if (channel === 'agent:conversation:new') {
      const [sessionId, conversationId] = args as [string, string];
      return {
        messages: [],
        activeBranchId: conversationId,
        branches: [
          { id: 'main', title: 'Main', backendId: 'claude', createdAt: '2026-07-18T00:00:00.000Z', messageCount: 1 },
          { id: conversationId, title: 'New conversation 2', backendId: 'claude', createdAt: '2026-07-31T00:02:00.000Z', messageCount: 0 },
        ],
        status: { ...readyStatus, historyLength: 0 },
        sessionId,
      };
    }
    if (channel === 'agent:branch:activate') {
      const [sessionId, branchId] = args as [string, string];
      return {
        messages: [{
          id: `message-${branchId}`,
          role: 'assistant',
          content: `History for ${branchId}`,
          timestamp: '2026-07-31T00:03:00.000Z',
          status: 'complete',
        }],
        activeBranchId: branchId,
        branches: [
          { id: 'main', title: 'Main', backendId: 'claude', createdAt: '2026-07-18T00:00:00.000Z', messageCount: 1 },
          { id: branchId, title: 'Web path', backendId: 'claude', createdAt: '2026-07-31T00:02:00.000Z', messageCount: 1 },
        ],
        status: { ...readyStatus, historyLength: 1 },
        sessionId,
      };
    }
    return undefined;
  });

  beforeEach(() => {
    listeners.clear();
    invoke.mockClear();
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((channel: string, callback: (data: unknown) => void) => {
          listeners.set(channel, callback);
          return () => listeners.delete(channel);
        }),
        once: vi.fn(),
        send: vi.fn(),
      },
    });
    useChatStore.getState().deactivateProject();
    useSessionStore.setState({ currentSession: null, targets: [], assets: [] });
  });

  it('loads each project history and ignores late events from the previous project', async () => {
    const unsubscribe = useChatStore.getState().subscribeToAgent();
    await useChatStore.getState().activateProject('project-a');
    expect(useChatStore.getState().messages[0].content).toBe('A history');

    await useChatStore.getState().activateProject('project-b');
    expect(useChatStore.getState()).toMatchObject({
      activeProjectId: 'project-b',
      permissionMode: 'auto',
    });

    listeners.get('agent:message')?.({
      sessionId: 'project-a',
      branchId: 'main',
      message: {
        id: 'late-a', role: 'assistant', content: 'must not leak',
        timestamp: '2026-07-18T00:00:01.000Z', status: 'complete',
      },
    } satisfies AgentMessageEvent);
    listeners.get('agent:message')?.({
      sessionId: 'project-b',
      branchId: 'main',
      message: {
        id: 'new-b', role: 'assistant', content: 'belongs to B',
        timestamp: '2026-07-18T00:00:02.000Z', status: 'complete',
      },
    } satisfies AgentMessageEvent);

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'B history',
      'belongs to B',
    ]);
    unsubscribe();
  });

  it('projects only the active branch subagent updates and keeps detail navigation local', async () => {
    const unsubscribe = useChatStore.getState().subscribeToAgent();
    await useChatStore.getState().activateProject('project-a');
    const run = {
      id: 'run-a',
      taskId: 'task-a',
      description: 'Read-only review',
      status: 'running' as const,
      startedAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:01.000Z',
      activities: [],
    };

    listeners.get('agent:subagent-update')?.({
      sessionId: 'project-b', branchId: 'main', run,
    });
    expect(useChatStore.getState().subagentRuns).toEqual([]);

    listeners.get('agent:subagent-update')?.({
      sessionId: 'project-a', branchId: 'other-branch', run,
    });
    expect(useChatStore.getState().subagentRuns).toEqual([]);

    listeners.get('agent:subagent-update')?.({
      sessionId: 'project-a', branchId: 'main', run,
    });
    useChatStore.getState().openSubagent('run-a');
    expect(useChatStore.getState()).toMatchObject({
      subagentRuns: [run],
      subagentView: 'subagent-detail',
      selectedSubagentRunId: 'run-a',
    });
    useChatStore.getState().closeSubagent();
    expect(useChatStore.getState()).toMatchObject({
      subagentView: 'conversation',
      selectedSubagentRunId: null,
    });
    unsubscribe();
  });

  it('persists permission changes to the active project only', async () => {
    await useChatStore.getState().activateProject('project-b');
    useChatStore.getState().setPermissionMode('bypassPermissions');

    expect(invoke).toHaveBeenCalledWith('project:update', 'project-b', {
      preferences: { permissionMode: 'bypassPermissions' },
    });
  });

  it('sends attachment payloads while persisting only metadata in the optimistic message', async () => {
    await useChatStore.getState().activateProject('project-a');
    useSessionStore.setState({
      currentSession: {
        id: 'project-a', name: 'Project A', createdAt: '', updatedAt: '', status: 'active',
        opsecLevel: 'balanced', autonomyLevel: 'medium', basePath: '', targetCount: 0,
        findingCount: 0, vulnerabilityCount: 0,
      },
    });
    const attachment = {
      id: 'attachment-1', name: 'screen.png', path: 'C:\\screen.png', kind: 'image' as const,
      mimeType: 'image/png', size: 3, base64: 'YWJj',
    };

    await useChatStore.getState().sendMessage('Inspect this', [attachment]);

    expect(useChatStore.getState().messages.at(-1)?.attachments).toEqual([{
      id: 'attachment-1', name: 'screen.png', path: 'C:\\screen.png', kind: 'image',
      mimeType: 'image/png', size: 3,
    }]);
    expect(invoke).toHaveBeenCalledWith('agent:send', expect.objectContaining({
      content: 'Inspect this',
      attachments: [attachment],
    }));
  });

  it('queues bounded deduplicated context without overwriting a typed draft and persists it with the message', async () => {
    await useChatStore.getState().activateProject('project-a');
    useSessionStore.setState({
      currentSession: {
        id: 'project-a', name: 'Project A', createdAt: '', updatedAt: '', status: 'active',
        opsecLevel: 'balanced', autonomyLevel: 'medium', basePath: '', targetCount: 0,
        findingCount: 0, vulnerabilityCount: 0,
      },
    });
    useChatStore.getState().setComposerText('Keep my existing question');
    const ref = {
      kind: 'traffic-flow' as const, projectId: 'project-a', flowId: 'flow-1', method: 'GET',
      url: 'https://example.test/', state: 'completed', scopeState: 'out_of_scope' as const,
    };
    useChatStore.getState().queueAgentContext(ref, 'Default prompt');
    useChatStore.getState().queueAgentContext(ref, 'Different default');
    expect(useChatStore.getState().composerText).toBe('Keep my existing question');
    expect(useChatStore.getState().composerContextRefs).toEqual([ref]);

    await useChatStore.getState().sendMessage('Keep my existing question');
    expect(useChatStore.getState().messages.at(-1)?.contextRefs).toEqual([ref]);
    expect(useChatStore.getState().composerContextRefs).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('agent:send', expect.objectContaining({ contextRefs: [ref] }));
  });

  it('edits a prior user turn into a new active branch', async () => {
    await useChatStore.getState().activateProject('project-a');
    useSessionStore.setState({
      currentSession: {
        id: 'project-a',
        name: 'Project A',
        status: 'active',
        opsecLevel: 'balanced',
        autonomyLevel: 'medium',
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
        basePath: 'project-a',
        targetCount: 0,
        findingCount: 0,
        vulnerabilityCount: 0,
      },
    });
    useChatStore.setState({
      messages: [
        {
          id: 'user-original',
          role: 'user',
          content: 'Original request',
          timestamp: '2026-07-31T00:00:00.000Z',
          status: 'complete',
        },
        {
          id: 'assistant-original',
          role: 'assistant',
          content: 'Original answer',
          timestamp: '2026-07-31T00:00:01.000Z',
          status: 'complete',
          backendMessageId: 'sdk-assistant-original',
        },
      ],
    });

    await useChatStore.getState().branchFromMessage('user-original', 'Edited request');

    expect(invoke).toHaveBeenCalledWith('agent:branch', expect.objectContaining({
      sourceMessageId: 'user-original',
      request: expect.objectContaining({ content: 'Edited request' }),
    }));
    expect(useChatStore.getState()).toMatchObject({
      activeBranchId: expect.stringMatching(/^branch-/),
      messages: [expect.objectContaining({ content: 'Edited request' })],
      isProcessing: false,
    });
    expect(useChatStore.getState().branches).toHaveLength(2);
  });

  it('creates an independent persisted conversation without clearing the old one', async () => {
    await useChatStore.getState().activateProject('project-a');

    await useChatStore.getState().newConversation();

    const state = useChatStore.getState();
    expect(invoke).toHaveBeenCalledWith(
      'agent:conversation:new',
      'project-a',
      expect.stringMatching(/^conversation-/),
    );
    expect(state.messages).toEqual([]);
    expect(state.branches).toHaveLength(2);
    expect(state.activeBranchId).toMatch(/^conversation-/);
  });

  it('switches conversations and hydrates the selected history', async () => {
    await useChatStore.getState().activateProject('project-a');
    useChatStore.setState({
      branches: [
        ...useChatStore.getState().branches,
        {
          id: 'conversation-web',
          title: 'Web path',
          backendId: 'claude',
          createdAt: '2026-07-31T00:02:00.000Z',
          messageCount: 1,
        },
      ],
    });

    await useChatStore.getState().switchBranch('conversation-web');

    expect(invoke).toHaveBeenCalledWith(
      'agent:branch:activate',
      'project-a',
      'conversation-web',
    );
    expect(useChatStore.getState()).toMatchObject({
      activeBranchId: 'conversation-web',
      messages: [expect.objectContaining({ content: 'History for conversation-web' })],
    });
  });

  it('receives and answers an active Claude clarifying question', async () => {
    const unsubscribe = useChatStore.getState().subscribeToAgent();
    await useChatStore.getState().activateProject('project-a');

    listeners.get('agent:tool-request')?.({
      sessionId: 'project-a',
      request: {
        kind: 'ask_user_question',
        id: 'question-1',
        toolUseId: 'tool-1',
        toolName: 'AskUserQuestion',
        createdAt: '2026-07-31T00:04:00.000Z',
        questions: [{
          question: 'Which target should I test?',
          header: 'Target',
          options: [
            { label: 'API', description: 'Test the API' },
            { label: 'Admin', description: 'Test the admin site' },
          ],
          multiSelect: false,
        }],
      },
    });
    expect(useChatStore.getState().pendingToolRequest).toMatchObject({
      kind: 'ask_user_question',
      id: 'question-1',
    });

    await useChatStore.getState().answerUserQuestion('question-1', {
      'Which target should I test?': 'API',
    });
    expect(invoke).toHaveBeenCalledWith('agent:answer-question', 'question-1', {
      'Which target should I test?': 'API',
    });
    expect(useChatStore.getState().pendingToolRequest).toBeNull();
    unsubscribe();
  });
});
