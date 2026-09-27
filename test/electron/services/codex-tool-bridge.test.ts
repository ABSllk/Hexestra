// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CodexToolBridge } from '@electron/services/agent-adapters/codex-tool-bridge';
import type { AgentToolPermissionDecision } from '@electron/contracts/agent-runtime';

const bridges: CodexToolBridge[] = [];
afterEach(async () => { await Promise.all(bridges.splice(0).map((bridge) => bridge.close())); });

describe('Codex MCP bridge', () => {
  it('requires its bearer token and sends project tools through Hexestra authorization', async () => {
    const bridge = new CodexToolBridge(false);
    bridges.push(bridge);
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'saved' }] }));
    await bridge.start([{ name: 'project_write', description: 'Write project data',
      inputSchema: { value: z.string() }, riskLevel: 'write', execute }]);

    const unauthorized = await fetch(bridge.url(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    expect(unauthorized.status).toBe(401);

    const authorizeTool = vi.fn(async (): Promise<AgentToolPermissionDecision> => ({ behavior: 'deny', message: 'approval required' }));
    bridge.bind([{ name: 'project_write', description: 'Write project data', inputSchema: { value: z.string() },
      riskLevel: 'write', execute }], { authorizeTool, requestAnswers: vi.fn() }, new AbortController().signal);
    const client = new Client({ name: 'test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(bridge.url()), { requestInit: {
      headers: { Authorization: `Bearer ${bridge.bearerToken}` },
    } });
    try {
      await client.connect(transport).catch((error) => { throw new Error(`${error.code}: ${error.message}`); });
      expect((await client.listTools()).tools.some((tool) => tool.name === 'project_write')).toBe(true);
      const childClient = new Client({ name: 'subagent', version: '1' });
      const childTransport = new StreamableHTTPClientTransport(new URL(bridge.url()), { requestInit: {
        headers: { Authorization: `Bearer ${bridge.bearerToken}` },
      } });
      try {
        await childClient.connect(childTransport);
        expect((await childClient.listTools()).tools.some((tool) => tool.name === 'project_write')).toBe(true);
      } finally { await childClient.close(); }
      const denied = await client.callTool({ name: 'project_write', arguments: { value: 'sample' } });
      expect(denied.isError).toBe(true);
      expect(authorizeTool).toHaveBeenCalledOnce();
      expect(execute).not.toHaveBeenCalled();
      authorizeTool.mockResolvedValueOnce({ behavior: 'allow', updatedInput: { value: 'approved' } });
      const allowed = await client.callTool({ name: 'project_write', arguments: { value: 'sample' } });
      expect(allowed.isError).not.toBe(true);
      expect(execute).toHaveBeenCalledWith({ value: 'approved' });
      const schedule = vi.fn(() => 'wake-1');
      authorizeTool.mockResolvedValueOnce({ behavior: 'allow' });
      bridge.bind([], { authorizeTool, requestAnswers: vi.fn() }, new AbortController().signal, schedule);
      const wake = await client.callTool({ name: 'ScheduleWakeup', arguments: { delaySeconds: 2, prompt: 'Continue' } });
      expect(wake.isError).not.toBe(true);
      expect(schedule).toHaveBeenCalledWith(2_000, 'Continue');
    } finally { await client.close(); }
  });
});
