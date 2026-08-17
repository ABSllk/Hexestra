// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  query: vi.fn(),
  tool: vi.fn((name, description, inputSchema, handler) => ({ name, description, inputSchema, handler })),
  createSdkMcpServer: vi.fn((options) => ({ type: 'sdk', name: options.name, instance: options })),
  executable: ['Z:', 'hexestra-test', 'npm', 'claude.cmd'].join('/'),
  path: ['Z:', 'hexestra-test', 'npm'].join('/'),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdk.query,
  tool: sdk.tool,
  createSdkMcpServer: sdk.createSdkMcpServer,
}));
vi.mock('@electron/services/agent-settings.service', () => ({
  agentConnectionFingerprint: () => 'native-test',
  agentSettingsService: {
    getClaudeSettings: () => ({
      executionMode: 'native',
      wslDistribution: 'Ubuntu-24.04',
      claudeExecutable: '',
      model: null,
      settingSources: ['user', 'project', 'local'],
    }),
  },
}));
vi.mock('@electron/services/claude-runtime', () => ({
  resolveClaudeRuntime: vi.fn(async () => ({
    executionMode: 'native',
    executablePath: sdk.executable,
    source: 'process-path',
    environment: { PATH: sdk.path },
    error: null,
    installGuidance: 'Install Claude Code',
  })),
  runtimeFingerprint: vi.fn(() => `native:${sdk.executable}`),
}));

import { ClaudeAgentAdapter } from '@electron/services/agent-adapters/claude-agent-adapter';
import type {
  AgentInteractionHandler,
  AgentRunEvent,
  AgentRunInput,
} from '@electron/contracts/agent-runtime';

const interactions: AgentInteractionHandler = {
  authorizeTool: vi.fn(async (request) => ({ behavior: 'allow' as const, updatedInput: request.input })),
  requestAnswers: vi.fn(async () => ({})),
};

function runInput(dynamicSystemContext: string): AgentRunInput {
  return {
    conversationId: 'main',
    prompt: 'Continue the task',
    systemInstructions: 'Stable Hexestra instructions',
    dynamicSystemContext,
    signal: new AbortController().signal,
    attachments: [],
    cwd: 'D:\\missing-project',
    model: 'deepseek-v4-pro',
    permissionMode: 'bypassPermissions',
    runtime: null,
    fork: false,
    settingSources: ['user', 'project', 'local'],
    tools: [],
    projectId: 'project-1',
  };
}

async function collect(iterable: AsyncIterable<AgentRunEvent>) {
  const events: AgentRunEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('ClaudeAgentAdapter MCP runtime status', () => {
  beforeEach(() => {
    sdk.query.mockReset();
    sdk.tool.mockClear();
    sdk.createSdkMcpServer.mockClear();
  });

  it('keeps one streaming query alive across turns in the same conversation', async () => {
    const prompts: unknown[] = [];
    const contexts: string[] = [];
    const setPermissionMode = vi.fn(async () => undefined);
    const close = vi.fn();
    sdk.query.mockImplementation((params) => ({
      supportedCommands: vi.fn(async () => []),
      setPermissionMode,
      interrupt: vi.fn(async () => undefined),
      close,
      async *[Symbol.asyncIterator]() {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-1', model: 'deepseek-v4-pro' };
        for await (const prompt of params.prompt) {
          prompts.push(prompt);
          const hook = params.options.hooks.UserPromptSubmit[0].hooks[0];
          const hookOutput = await hook({ hook_event_name: 'UserPromptSubmit' });
          contexts.push(hookOutput.hookSpecificOutput?.additionalContext ?? '');
          yield { type: 'result', subtype: 'success', result: `reply-${prompts.length}` };
        }
      },
    }));

    const adapter = new ClaudeAgentAdapter();
    const first = await collect(adapter.runTurn(runInput('context-one'), interactions));
    const second = await collect(adapter.runTurn(runInput('context-two'), interactions));

    expect(sdk.query).toHaveBeenCalledTimes(1);
    expect(sdk.query.mock.calls[0]?.[0].options.permissionMode).toBe('default');
    expect(sdk.query.mock.calls[0]?.[0].options.allowDangerouslySkipPermissions).toBe(true);
    expect(setPermissionMode).toHaveBeenNthCalledWith(1, 'bypassPermissions');
    expect(setPermissionMode).toHaveBeenNthCalledWith(2, 'bypassPermissions');
    expect(prompts).toHaveLength(2);
    expect(contexts).toEqual(['context-one', 'context-two']);
    expect(first.at(-1)).toEqual(expect.objectContaining({ type: 'turn_completed', content: 'reply-1' }));
    expect(second.at(-1)).toEqual(expect.objectContaining({ type: 'turn_completed', content: 'reply-2' }));
    expect(close).not.toHaveBeenCalled();

    await adapter.disposeConversation('project-1', 'main');
    expect(close).toHaveBeenCalled();
  });

  it('interrupts only the active turn and reuses the streaming process afterwards', async () => {
    let releaseInterruptedTurn!: () => void;
    const interruptedTurn = new Promise<void>((resolve) => { releaseInterruptedTurn = resolve; });
    let firstPromptReceived!: () => void;
    const promptReceived = new Promise<void>((resolve) => { firstPromptReceived = resolve; });
    const interrupt = vi.fn(async () => releaseInterruptedTurn());
    const close = vi.fn();
    sdk.query.mockImplementation((params) => ({
      supportedCommands: vi.fn(async () => []),
      setPermissionMode: vi.fn(async () => undefined),
      interrupt,
      close,
      async *[Symbol.asyncIterator]() {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-1', model: 'deepseek-v4-pro' };
        let turn = 0;
        for await (const _prompt of params.prompt) {
          turn += 1;
          if (turn === 1) {
            firstPromptReceived();
            await interruptedTurn;
          }
          yield { type: 'result', subtype: 'success', result: `reply-${turn}` };
        }
      },
    }));

    const adapter = new ClaudeAgentAdapter();
    const controller = new AbortController();
    const firstInput = runInput('context-one');
    firstInput.signal = controller.signal;
    const first = collect(adapter.runTurn(firstInput, interactions));
    await promptReceived;
    controller.abort();

    await expect(first).rejects.toThrow('cancelled');
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    const second = await collect(adapter.runTurn(runInput('context-two'), interactions));
    expect(second.at(-1)).toEqual(expect.objectContaining({ type: 'turn_completed', content: 'reply-2' }));
    expect(sdk.query).toHaveBeenCalledTimes(1);
    await adapter.disposeConversation('project-1', 'main');
  });

  it('closes the previous streaming query when the conversation changes', async () => {
    const closes: Array<ReturnType<typeof vi.fn>> = [];
    sdk.query.mockImplementation((params) => {
      const close = vi.fn();
      closes.push(close);
      return {
        supportedCommands: vi.fn(async () => []),
        setPermissionMode: vi.fn(async () => undefined),
        interrupt: vi.fn(async () => undefined),
        close,
        async *[Symbol.asyncIterator]() {
          yield { type: 'system', subtype: 'init', session_id: `claude-session-${closes.length}`, model: 'deepseek-v4-pro' };
          for await (const _prompt of params.prompt) {
            yield { type: 'result', subtype: 'success', result: 'done' };
          }
        },
      };
    });

    const adapter = new ClaudeAgentAdapter();
    await collect(adapter.runTurn(runInput('main-context'), interactions));
    const secondConversation = runInput('secondary-context');
    secondConversation.conversationId = 'secondary';
    await collect(adapter.runTurn(secondConversation, interactions));

    expect(sdk.query).toHaveBeenCalledTimes(2);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).not.toHaveBeenCalled();

    await adapter.disposeConversation('project-1', 'secondary');
    expect(closes[1]).toHaveBeenCalledTimes(1);
  });

  it('uses an idle non-persisted query and returns only sanitized status fields', async () => {
    const close = vi.fn();
    const mcpServerStatus = vi.fn(async () => [{
      name: 'docs',
      status: 'failed' as const,
      error: 'Authorization: Bearer private at https://example.com/mcp?token=private',
      scope: 'user',
      tools: [{ name: 'search', description: 'must not cross IPC' }],
      config: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'private' } },
      serverInfo: { name: 'docs', version: '1.0.0' },
    }]);
    sdk.query.mockReturnValue({ close, mcpServerStatus });

    const result = await new ClaudeAgentAdapter().listMcpServerStatuses({ cwd: 'D:\\project' });

    expect(result.items).toEqual([{
      name: 'docs',
      status: 'failed',
      error: 'Authorization: Bearer <redacted> at https://example.com/mcp?redacted',
      scope: 'user',
      toolCount: 1,
    }]);
    expect(result.items[0]).not.toHaveProperty('config');
    expect(result.items[0]).not.toHaveProperty('tools');
    expect(result.items[0]).not.toHaveProperty('serverInfo');
    expect(mcpServerStatus).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        cwd: 'D:\\project',
        persistSession: false,
        settingSources: ['user', 'project', 'local'],
        pathToClaudeCodeExecutable: sdk.executable,
        env: { PATH: sdk.path },
      }),
    }));
    const queryInput = sdk.query.mock.calls[0]?.[0];
    expect(queryInput.options.abortController.signal.aborted).toBe(true);
  });
});
