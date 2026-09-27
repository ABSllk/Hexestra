// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AgentRunInput } from '@electron/contracts/agent-runtime';

const rpc = vi.hoisted(() => ({ calls: [] as Array<{ method: string; params: unknown }>, failStart: false }));

vi.mock('@electron/services/agent-settings.service', () => ({ agentSettingsService: {
  getCodexSettings: () => ({ version: 1, executionMode: 'native', wslDistribution: 'Ubuntu-24.04',
    codexExecutable: 'codex', model: null }),
} }));

vi.mock('@electron/services/agent-adapters/codex-tool-bridge', () => ({
  CodexToolBridge: class {
    bearerToken = 'test-token';
    async start() {}
    bind() {}
    unbind() {}
    url() { return 'http://127.0.0.1:12345/mcp'; }
    async close() {}
  },
}));

vi.mock('@electron/services/agent-adapters/codex-app-server', async () => {
  const { EventEmitter } = await import('events');
  return { CodexAppServer: class extends EventEmitter {
    async start() { if (rpc.failStart) throw new Error('spawn codex ENOENT'); }
    close() {}
    async request(method: string, params: unknown) {
      rpc.calls.push({ method, params });
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'model/list') {
        const cursor = (params as { cursor?: string | null }).cursor;
        return cursor ? { data: [{ model: 'gpt-next', displayName: 'GPT Next', hidden: false }], nextCursor: null }
          : { data: [{ model: 'gpt-codex', displayName: 'GPT Codex', hidden: false, isDefault: true,
            defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
              { reasoningEffort: 'low' }, { reasoningEffort: 'medium', description: 'Balanced reasoning' }, { reasoningEffort: 'high' }] },
            { model: 'hidden', displayName: 'Hidden', hidden: true }], nextCursor: 'page-2' };
      }
      if (method === 'thread/start') return { thread: { id: 'thread-new' } };
      if (method === 'thread/resume') return { thread: { id: 'thread-old' } };
      if (method === 'thread/fork') return { thread: { id: 'thread-fork' } };
      if (method === 'turn/interrupt') {
        queueMicrotask(() => this.emit('message', { method: 'turn/completed', params: {
          threadId: (params as { threadId: string }).threadId,
          turn: { id: (params as { turnId: string }).turnId, status: 'interrupted' },
        } }));
        return {};
      }
      if (method === 'turn/start') {
        const threadId = (params as { threadId: string }).threadId;
        const prompt = (params as { input: Array<{ text?: string }> }).input[0]?.text;
        if (prompt === 'Wait for cancellation') {
          return { turn: { id: 'turn-1' } };
        }
        if (prompt === 'Multi-message') {
          queueMicrotask(() => {
            this.emit('message', { method: 'item/started', params: { threadId, turnId: 'turn-1', item: { id: 'message-1', type: 'agentMessage' } } });
            this.emit('message', { method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', itemId: 'message-1', delta: 'First step.' } });
            this.emit('message', { method: 'item/completed', params: { threadId, turnId: 'turn-1', item: { id: 'message-1', type: 'agentMessage', text: 'First step.' } } });
            this.emit('message', { method: 'item/completed', params: { threadId, turnId: 'turn-1', item: { id: 'tool-1', type: 'mcpToolCall', tool: 'hexestra.project_read', status: 'completed' } } });
            this.emit('message', { method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', itemId: 'message-2', delta: 'Final answer.' } });
            this.emit('message', { method: 'item/completed', params: { threadId, turnId: 'turn-1', item: { id: 'message-2', type: 'agentMessage', text: 'Final answer.' } } });
            this.emit('message', { method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', status: 'completed' } } });
          });
          return { turn: { id: 'turn-1' } };
        }
        queueMicrotask(() => {
          this.emit('message', { method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', delta: 'hello' } });
          this.emit('message', { method: 'item/completed', params: { threadId, turnId: 'turn-1', item: { id: 'answer-1', type: 'agentMessage', text: 'hello' } } });
          this.emit('message', { method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', status: 'completed' } } });
        });
        return { turn: { id: 'turn-1' } };
      }
      return {};
    }
  } };
});

import { CodexAgentAdapter } from '@electron/services/agent-adapters/codex-agent-adapter';

function input(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return { conversationId: 'main', inputId: 'input-1', prompt: 'Say hello', systemInstructions: 'System',
    signal: new AbortController().signal, attachments: [], cwd: process.cwd(), model: null,
    permissionMode: 'default', runtime: null, fork: false, tools: [], projectId: 'project-1', ...overrides };
}

const interactions = { authorizeTool: vi.fn(), requestAnswers: vi.fn() };

describe('Codex Agent adapter protocol', () => {
  it('explains how to recover when the configured Codex executable is absent', async () => {
    rpc.failStart = true;
    try {
      await expect(new CodexAgentAdapter().listModels({ cwd: process.cwd() }))
        .rejects.toThrow('Check the executable path under Settings → Connection → Codex');
    } finally {
      rpc.failStart = false;
    }
  });
  it('loads visible models from every App Server catalog page', async () => {
    rpc.calls.length = 0;
    const adapter = new CodexAgentAdapter();
    await expect(adapter.listModels({ cwd: process.cwd() })).resolves.toEqual([
      { id: 'gpt-codex', displayName: 'GPT Codex', isDefault: true, defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: ['low', 'medium', 'high'], reasoningEffortDescriptions: { medium: 'Balanced reasoning' } },
      { id: 'gpt-next', displayName: 'GPT Next', isDefault: undefined,
        defaultReasoningEffort: undefined, supportedReasoningEfforts: undefined, reasoningEffortDescriptions: undefined },
    ]);
    expect(rpc.calls.filter((call) => call.method === 'model/list')).toHaveLength(2);
  });
  it('projects App Server text and completion into generic Agent events', async () => {
    rpc.calls.length = 0;
    const adapter = new CodexAgentAdapter();
    const events = [];
    for await (const event of adapter.runTurn(input({ reasoningEffort: 'high' }), interactions)) events.push(event);
    expect(events.find((event) => event.type === 'session')).toMatchObject({ sessionId: 'thread-new' });
    expect(events.find((event) => event.type === 'turn_completed')).toMatchObject({ content: 'hello', backendMessageId: 'turn-1' });
    expect(rpc.calls.find((call) => call.method === 'thread/start')?.params).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'never' });
    expect(rpc.calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({ sandboxPolicy: { type: 'readOnly' }, effort: 'high' });
    await adapter.disposeConversation('project-1', 'main');
  });

  it('keeps each Codex message around tool activity instead of replacing earlier text', async () => {
    const adapter = new CodexAgentAdapter();
    const events = [];
    for await (const event of adapter.runTurn(input({ conversationId: 'multi', prompt: 'Multi-message' }), interactions)) events.push(event);
    const completed = events.find((event) => event.type === 'turn_completed');
    expect(completed).toMatchObject({ content: 'First step.\n\nFinal answer.', activities: [
      { id: 'message-1', kind: 'text', content: 'First step.', status: 'complete' },
      { id: 'tool-1', kind: 'tool', status: 'complete' },
      { id: 'message-2', kind: 'text', content: 'Final answer.', status: 'complete' },
    ] });
    const snapshots = events.filter((event) => event.type === 'turn_snapshot');
    expect(snapshots.at(-1)).toMatchObject({ content: 'First step.\n\nFinal answer.' });
    await adapter.disposeConversation('project-1', 'multi');
  });

  it('uses the catalog default effort when the user switches back to Default', async () => {
    rpc.calls.length = 0;
    const adapter = new CodexAgentAdapter();
    for await (const _event of adapter.runTurn(input({ conversationId: 'default-effort' }), interactions)) { /* consume */ }
    expect(rpc.calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({ effort: 'medium' });
    await adapter.disposeConversation('project-1', 'default-effort');
  });

  it('forks through the selected completed turn', async () => {
    rpc.calls.length = 0;
    const adapter = new CodexAgentAdapter();
    for await (const _event of adapter.runTurn(input({ conversationId: 'forked',
      runtime: { backendId: 'codex', sessionId: 'thread-old', connectionFingerprint: null },
      fork: true, resumeAt: 'turn-previous' }), interactions)) { /* consume */ }
    expect(rpc.calls.find((call) => call.method === 'thread/fork')?.params).toEqual({ threadId: 'thread-old', lastTurnId: 'turn-previous' });
    await adapter.disposeConversation('project-1', 'forked');
  });

  it('resumes a persisted Codex thread without starting a new one', async () => {
    rpc.calls.length = 0;
    const adapter = new CodexAgentAdapter();
    for await (const _event of adapter.runTurn(input({ conversationId: 'resumed',
      runtime: { backendId: 'codex', sessionId: 'thread-old', connectionFingerprint: null } }), interactions)) { /* consume */ }
    expect(rpc.calls.find((call) => call.method === 'thread/resume')?.params).toMatchObject({ threadId: 'thread-old' });
    expect(rpc.calls.some((call) => call.method === 'thread/start')).toBe(false);
    await adapter.disposeConversation('project-1', 'resumed');
  });

  it('interrupts the active turn when cancelled', async () => {
    rpc.calls.length = 0;
    const adapter = new CodexAgentAdapter();
    const controller = new AbortController();
    const events: unknown[] = [];
    const running = (async () => {
      for await (const event of adapter.runTurn(input({ conversationId: 'cancelled',
        prompt: 'Wait for cancellation', signal: controller.signal }), interactions)) events.push(event);
    })();
    await vi.waitFor(() => expect(rpc.calls.some((call) => call.method === 'turn/start')).toBe(true));
    controller.abort();
    await expect(running).rejects.toThrow(/interrupted/i);
    expect(rpc.calls.find((call) => call.method === 'turn/interrupt')?.params).toEqual({ threadId: 'thread-new', turnId: 'turn-1' });
    await adapter.disposeConversation('project-1', 'cancelled');
  });
});
