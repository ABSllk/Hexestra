// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentRunInput } from '@electron/contracts/agent-runtime';

const rpc = vi.hoisted(() => ({ calls: [] as Array<{ method: string; params: unknown }>, failStart: false,
  responses: [] as Array<{ id: number | string; result: unknown }>,
  server: null as null | { emit: (event: string, message: unknown) => void },
  launchConfigs: [] as Array<Record<string, unknown>>,
  skillsOverride: null as null | Array<{ name: string; path: string; scope: string; enabled: boolean }>,
  mcpProjectOrigin: false,
  pluginStatus: false,
  executionMode: 'native' as 'native' | 'wsl' }));

vi.mock('@electron/services/agent-settings.service', () => ({ agentSettingsService: {
  getCodexSettings: () => ({ version: 1, executionMode: rpc.executionMode, wslDistribution: 'Ubuntu-24.04',
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
    constructor(...args: unknown[]) { super(); rpc.launchConfigs.push(args[2] as Record<string, unknown>); rpc.server = this; }
    async start() { if (rpc.failStart) throw new Error('spawn codex ENOENT'); }
    close() {}
    respond(id: number | string, result: unknown) {
      rpc.responses.push({ id, result });
      if (id === 'question-1') queueMicrotask(() => this.emit('message', { method: 'turn/completed', params: {
        threadId: 'thread-new', turn: { id: 'turn-1', status: 'completed' },
      } }));
    }
    async request(method: string, params: unknown) {
      rpc.calls.push({ method, params });
      if (method === 'fs/getMetadata') return { isSymlink: false };
      if (method === 'fs/readFile') {
        const fs = await import('fs');
        return { dataBase64: fs.readFileSync((params as { path: string }).path).toString('base64') };
      }
      if (method === 'fs/writeFile') {
        const fs = await import('fs');
        const file = params as { path: string; dataBase64: string };
        fs.writeFileSync(file.path, Buffer.from(file.dataBase64, 'base64'));
        return {};
      }
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'skills/list' && rpc.skillsOverride) return { data: [{ skills: rpc.skillsOverride }] };
      if (method === 'skills/list') return { data: [{ skills: [
        { name: 'recon-helper', description: 'Recon from disk', enabled: true,
          interface: { shortDescription: 'Run reconnaissance' } },
        { name: 'disabled-skill', description: 'Disabled', enabled: false },
        { name: 'bad name', description: 'Invalid token', enabled: true },
      ] }] };
      if (method === 'config/read') return { origins: rpc.mcpProjectOrigin ? {
        'mcp_servers.probe': { name: { type: 'project', dotCodexFolder: 'C:/work/project/.codex' } },
      } : undefined, config: { mcp_servers: {
        probe: { command: 'echo', args: ['ok'], tool_timeout_sec: null },
      } } };
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'probe', runtimeStatus: 'connected', tools: { ping: {} }, toolsError: null },
        ...(rpc.pluginStatus ? [{ name: 'plugin-tools', pluginId: 'sample.plugin@test', runtimeStatus: 'connected', tools: { search: {} }, toolsError: null }] : [])] };
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
        if (prompt === 'Tool-error') {
          queueMicrotask(() => {
            this.emit('message', { method: 'item/completed', params: { threadId, turnId: 'turn-1', item: {
              id: 'tool-error', type: 'mcpToolCall', tool: 'hexestra.restriction_list', status: 'failed',
              error: { message: 'MCP tool call requires approval, but approval policy is never' },
            } } });
            this.emit('message', { method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', status: 'completed' } } });
          });
          return { turn: { id: 'turn-1' } };
        }
        if (prompt === 'Wait for cancellation') {
          return { turn: { id: 'turn-1' } };
        }
        if (prompt === 'Ask operator') {
          queueMicrotask(() => this.emit('message', { id: 'question-1', method: 'item/tool/requestUserInput', params: {
            threadId, turnId: 'turn-1', itemId: 'input-item-1', isBlocking: true,
            questions: [
              { id: 'access', header: 'Access', question: 'How should I proceed?', isOther: false, isSecret: false,
                options: [{ label: 'Anonymous', description: 'Test without signing in' },
                  { label: 'Account', description: 'Use a test account' }] },
              { id: 'note', header: 'Note', question: 'How should I proceed?', isOther: true, isSecret: true, options: null },
            ],
          } }));
          return { turn: { id: 'turn-1' } };
        }
        if (prompt === 'Ask asynchronously') {
          queueMicrotask(() => {
            this.emit('message', { id: 'async-question', method: 'item/tool/requestUserInput', params: {
              threadId, turnId: 'turn-1', itemId: 'async-item', isBlocking: false,
              questions: [{ id: 'choice', header: 'Path', question: 'Choose a path', isOther: false, isSecret: false,
                options: [{ label: 'Anonymous', description: 'Public route' }, { label: 'Account', description: 'Test account' }] }],
            } });
            this.emit('message', { method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', status: 'completed' } } });
          });
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
  it('reads Codex MCP config and strips nullable defaults before writing TOML', async () => {
    rpc.calls.length = 0;
    const adapter = new CodexAgentAdapter();
    const listed = await adapter.listMcpServers();
    expect(listed.items).toMatchObject([{ name: 'probe', status: 'connected', toolCount: 1 }]);
    await adapter.saveMcpServer({ name: 'probe', originalName: 'probe', definition: listed.items[0].definition });
    expect(rpc.calls.find((call) => call.method === 'config/value/write')?.params).toEqual({
      keyPath: 'mcp_servers.probe', value: { command: 'echo', args: ['ok'] }, mergeStrategy: 'replace',
    });
    expect(rpc.calls.some((call) => call.method === 'config/mcpServer/reload')).toBe(true);
    await adapter.deleteMcpServer('probe');
    expect(rpc.calls.filter((call) => call.method === 'config/value/write').at(-1)?.params).toEqual({
      keyPath: 'mcp_servers.probe', value: null, mergeStrategy: 'replace',
    });
  });

  it('reads project MCP layers without attempting unsupported project config RPC writes', async () => {
    rpc.mcpProjectOrigin = true;
    rpc.calls.length = 0;
    try {
      const adapter = new CodexAgentAdapter();
      const listed = await adapter.listMcpServers({ cwd: 'C:/work/project' });
      expect(rpc.calls.find((call) => call.method === 'config/read')?.params)
        .toEqual({ includeLayers: true, cwd: 'C:/work/project' });
      expect(listed.items[0]).toMatchObject({ name: 'probe', scope: 'project', configFile: path.join('C:/work/project/.codex', 'config.toml') });
      await expect(adapter.saveMcpServer({ name: 'probe', originalName: 'probe', scope: 'project', definition: listed.items[0].definition },
        { cwd: 'C:/work/project' })).rejects.toThrow('file editor');
      expect(rpc.calls.some((call) => call.method === 'config/value/write')).toBe(false);
    } finally {
      rpc.mcpProjectOrigin = false;
    }
  });

  it('includes plugin-provided MCP servers and controls their enabled state', async () => {
    rpc.pluginStatus = true;
    rpc.calls.length = 0;
    try {
      const adapter = new CodexAgentAdapter();
      const listed = await adapter.listMcpServers();
      expect(listed.items).toContainEqual(expect.objectContaining({ name: 'plugin-tools', scope: 'plugin', pluginId: 'sample.plugin@test', toolCount: 1 }));
      await adapter.toggleMcpServer('plugin-tools', false);
      expect(rpc.calls.filter((call) => call.method === 'config/value/write').at(-1)?.params)
        .toEqual({ keyPath: 'plugins."sample.plugin@test".mcp_servers."plugin-tools".enabled', value: false, mergeStrategy: 'replace' });
    } finally {
      rpc.pluginStatus = false;
    }
  });

  it('copies a managed Skill and its resources into an editable project folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-skill-copy-'));
    const source = path.join(root, 'system', 'managed-skill');
    fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: managed-skill\ndescription: Managed skill\n---\n\nSee scripts/run.sh\n');
    fs.writeFileSync(path.join(source, 'scripts', 'run.sh'), 'echo ready\n');
    rpc.skillsOverride = [{ name: 'managed-skill', path: path.join(source, 'SKILL.md'), scope: 'system', enabled: true }];
    try {
      const adapter = new CodexAgentAdapter();
      const copied = await adapter.copySkill({ cwd: root }, { sourcePath: path.join(source, 'SKILL.md'), scope: 'repo', name: 'managed-skill-copy' });
      expect(copied).toBe(path.join(root, '.agents', 'skills', 'managed-skill-copy', 'SKILL.md'));
      expect(fs.readFileSync(copied, 'utf8')).toContain('name: managed-skill-copy');
      expect(fs.readFileSync(path.join(path.dirname(copied), 'scripts', 'run.sh'), 'utf8')).toBe('echo ready\n');
    } finally {
      rpc.skillsOverride = null;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

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
  it('discovers enabled Codex Skills from the selected cwd with a fresh runtime read', async () => {
    rpc.calls.length = 0;
    const adapter = new CodexAgentAdapter();
    await expect(adapter.listSkills({ cwd: process.cwd() })).resolves.toEqual([
      { name: 'recon-helper', description: 'Run reconnaissance' },
    ]);
    expect(rpc.calls.find((call) => call.method === 'skills/list')?.params)
      .toEqual({ cwds: [process.cwd()], forceReload: true });
    const changed = vi.fn();
    adapter.onSkillsChanged(changed);
    rpc.server?.emit('message', { method: 'skills/changed' });
    expect(changed).toHaveBeenCalledOnce();
  });
  it('queries Codex Skills with a WSL path in WSL mode', async () => {
    rpc.executionMode = 'wsl';
    rpc.calls.length = 0;
    try {
      await new CodexAgentAdapter().listSkills({ cwd: 'C:\\work\\project' });
      expect(rpc.calls.find((call) => call.method === 'skills/list')?.params)
        .toEqual({ cwds: ['/mnt/c/work/project'], forceReload: true });
    } finally {
      rpc.executionMode = 'native';
    }
  });
  it('projects App Server text and completion into generic Agent events', async () => {
    rpc.calls.length = 0;
    rpc.launchConfigs.length = 0;
    const adapter = new CodexAgentAdapter();
    const events = [];
    for await (const event of adapter.runTurn(input({ reasoningEffort: 'high' }), interactions)) events.push(event);
    expect(events.find((event) => event.type === 'session')).toMatchObject({ sessionId: 'thread-new' });
    expect(events.find((event) => event.type === 'turn_completed')).toMatchObject({ content: 'hello', backendMessageId: 'turn-1' });
    expect(rpc.calls.find((call) => call.method === 'thread/start')?.params).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'never' });
    expect(rpc.calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({ sandboxPolicy: { type: 'readOnly' }, effort: 'high' });
    expect(rpc.launchConfigs.at(-1)).toMatchObject({
      'mcp_servers.hexestra.default_tools_approval_mode': 'approve',
      'mcp_servers.hexestra.required': true,
    });
    await adapter.disposeConversation('project-1', 'main');
  });

  it('routes native Codex questions to the operator and returns answers by question ID', async () => {
    rpc.responses.length = 0;
    const requestAnswers = vi.fn(async () => ({ access: 'Anonymous', note: 'Use the public page only' }));
    const adapter = new CodexAgentAdapter();
    for await (const _event of adapter.runTurn(input({ conversationId: 'question', prompt: 'Ask operator' }), {
      authorizeTool: vi.fn(), requestAnswers,
    })) { /* consume */ }
    expect(requestAnswers).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'input-item-1',
      questions: [
        expect.objectContaining({ id: 'access', isOther: false, options: expect.any(Array) }),
        expect.objectContaining({ id: 'note', isSecret: true, options: [] }),
      ],
    }));
    expect(rpc.responses).toContainEqual({ id: 'question-1', result: { answers: {
      access: { answers: ['Anonymous'] }, note: { answers: ['Use the public page only'] },
    } } });
    await adapter.disposeConversation('project-1', 'question');
  });

  it('keeps an asynchronous Codex question open after the turn completes', async () => {
    rpc.responses.length = 0;
    let provideAnswer!: (answers: Record<string, string>) => void;
    const requestAnswers = vi.fn(() => new Promise<Record<string, string>>((resolve) => { provideAnswer = resolve; }));
    const adapter = new CodexAgentAdapter();
    let finished = false;
    const running = (async () => {
      for await (const _event of adapter.runTurn(input({ conversationId: 'async-question', prompt: 'Ask asynchronously' }), {
        authorizeTool: vi.fn(), requestAnswers,
      })) { /* consume */ }
      finished = true;
    })();
    await vi.waitFor(() => expect(requestAnswers).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    provideAnswer({ choice: 'Anonymous' });
    await running;
    expect(rpc.responses).toContainEqual({ id: 'async-question', result: { answers: { choice: { answers: ['Anonymous'] } } } });
    await adapter.disposeConversation('project-1', 'async-question');
  });

  it('shows the actual Codex MCP error instead of an object placeholder', async () => {
    const adapter = new CodexAgentAdapter();
    const events = [];
    for await (const event of adapter.runTurn(input({ conversationId: 'tool-error', prompt: 'Tool-error' }), interactions)) events.push(event);
    expect(events.find((event) => event.type === 'turn_completed')).toMatchObject({ activities: [
      { id: 'tool-error', kind: 'tool', status: 'error',
        outputSummary: 'MCP tool call requires approval, but approval policy is never' },
    ] });
    await adapter.disposeConversation('project-1', 'tool-error');
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
