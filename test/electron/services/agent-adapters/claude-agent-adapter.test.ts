// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  query: vi.fn(),
  executable: ['Z:', 'hexestra-test', 'npm', 'claude.cmd'].join('/'),
  path: ['Z:', 'hexestra-test', 'npm'].join('/'),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdk.query }));
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

describe('ClaudeAgentAdapter MCP runtime status', () => {
  beforeEach(() => {
    sdk.query.mockReset();
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
