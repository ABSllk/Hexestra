// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(async () => ({
    projectId: 'project-1', revision: 3, state: 'ready', enabled: true,
    activeChainId: 'chain-1', activeChainName: 'Two hop', mixedPort: 41000,
    tcpReady: true, udpReady: false, exitIp: '203.0.113.8', lastCheckedAt: null, error: null,
    chainLatencyMs: 64, latencyCheckedAt: '2026-08-10T00:00:00.000Z',
    nodeLatencyMs: { 'node-1': 28, 'node-2': 64 },
  })),
  nodesList: vi.fn(() => [{
    id: 'node-1', name: 'Hop', protocol: 'hysteria2', tcp: true, udp: true,
    updatedAt: '2026-08-10T00:00:00.000Z',
  }]),
  chainTest: vi.fn(async () => ({
    chainId: 'chain-1', tcpReady: true, udpReady: false, latencyMs: 64,
    nodeLatencyMs: { 'node-1': 28, 'node-2': 64 }, error: null,
  })),
  nodeSave: vi.fn(async (_input, nodeId?: string) => ({
    id: nodeId ?? 'node-new', name: 'Imported', protocol: 'vmess', tcp: true, udp: true,
    updatedAt: '2026-08-11T00:00:00.000Z',
  })),
  nodesImportBatch: vi.fn(async () => [
    { id: 'node-batch-1', name: 'One', protocol: 'trojan', tcp: true, udp: false, updatedAt: '2026-08-11T00:00:00.000Z' },
    { id: 'node-batch-2', name: 'Two', protocol: 'socks5', tcp: true, udp: true, updatedAt: '2026-08-11T00:00:00.000Z' },
  ]),
  nodeDelete: vi.fn(async () => true),
  nodesTest: vi.fn(async () => ({
    checkedAt: '2026-08-11T00:00:00.000Z', nodeLatencyMs: { 'node-1': 31 },
  })),
  chainSave: vi.fn(async (_projectId, chain) => chain),
  chainDelete: vi.fn(async () => true),
  chainActivate: vi.fn(async () => ({
    projectId: 'project-1', state: 'ready', enabled: true, tcpReady: true, udpReady: false,
  })),
  setEnforcement: vi.fn(async (_projectId, enabled) => ({
    projectId: 'project-1', state: enabled ? 'ready' : 'off', enabled, tcpReady: true, udpReady: false,
  })),
  start: vi.fn(async () => ({ projectId: 'project-1', state: 'ready', tcpReady: true, udpReady: false })),
  stop: vi.fn(async () => ({ projectId: 'project-1', state: 'blocked', tcpReady: false, udpReady: false })),
}));

vi.mock('@electron/services/egress-proxy.service', () => ({
  egressProxyService: {
    status: mocks.status,
    nodesList: mocks.nodesList,
    chainsList: vi.fn(() => []),
    chainTest: mocks.chainTest,
    nodeSave: mocks.nodeSave,
    nodesImportBatch: mocks.nodesImportBatch,
    nodeDelete: mocks.nodeDelete,
    nodesTest: mocks.nodesTest,
    chainSave: mocks.chainSave,
    chainDelete: mocks.chainDelete,
    chainActivate: mocks.chainActivate,
    setEnforcement: mocks.setEnforcement,
    start: mocks.start,
    stop: mocks.stop,
  },
}));

import { createProxyAgentTools } from '@electron/services/agent-tools/proxy-tools';

describe('proxy Agent tool projections', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns latency without TCP or UDP readiness fields', async () => {
    const tools = createProxyAgentTools({
      sender: {} as never,
      sessionId: 'project-1',
      permissionMode: 'default',
    });

    const status = await executeJson(tools, 'proxy_status', {});
    const nodes = await executeJson(tools, 'proxy_nodes_list', {});
    const tested = await executeJson(tools, 'proxy_chain_test', { chainId: 'chain-1' });

    expect(status).toMatchObject({ chainLatencyMs: 64, nodeLatencyMs: { 'node-1': 28, 'node-2': 64 } });
    expect(status).not.toHaveProperty('tcpReady');
    expect(status).not.toHaveProperty('udpReady');
    expect(nodes[0]).not.toHaveProperty('tcp');
    expect(nodes[0]).not.toHaveProperty('udp');
    expect(tested).toMatchObject({ latencyMs: 64 });
    expect(tested).not.toHaveProperty('tcpReady');
    expect(tested).not.toHaveProperty('udpReady');
  });

  it('exposes complete proxy lifecycle tools with only sanitized reads classified as read-only', () => {
    const tools = createTools();
    expect(tools.map(({ name }) => name)).toEqual([
      'proxy_status', 'proxy_nodes_list', 'proxy_node_import', 'proxy_nodes_import', 'proxy_node_update',
      'proxy_node_delete', 'proxy_nodes_test', 'proxy_chains_list', 'proxy_chain_test',
      'proxy_chain_save', 'proxy_chain_delete', 'proxy_chain_activate',
      'proxy_enforcement_set', 'proxy_runtime_start', 'proxy_runtime_stop',
    ]);
    expect(tools.filter(({ riskLevel }) => riskLevel === 'read').map(({ name }) => name)).toEqual([
      'proxy_status', 'proxy_nodes_list', 'proxy_chains_list',
    ]);
  });

  it('writes node credentials to the service but only returns sanitized metadata', async () => {
    const tools = createTools();
    const uri = 'vmess://credential-bearing-value';
    const imported = await executeJson(tools, 'proxy_node_import', {
      source: 'uri', name: 'Exit', value: uri,
    });
    const updated = await executeJson(tools, 'proxy_node_update', {
      nodeId: 'node-1', source: 'form', value: { type: 'trojan', password: 'new-secret' },
    });

    expect(mocks.nodeSave).toHaveBeenNthCalledWith(1, { source: 'uri', name: 'Exit', value: uri });
    expect(mocks.nodeSave).toHaveBeenNthCalledWith(2, {
      source: 'form', value: { type: 'trojan', password: 'new-secret' },
    }, 'node-1');
    expect(JSON.stringify([imported, updated])).not.toContain('credential-bearing-value');
    expect(JSON.stringify([imported, updated])).not.toContain('new-secret');
    expect(imported).not.toHaveProperty('tcp');
    expect(updated).not.toHaveProperty('udp');
  });

  it('atomically imports a write-only one-URI-per-line batch', async () => {
    const tools = createTools();
    const value = 'trojan://first-secret@192.0.2.1:443#One\n\nsocks5://second-secret@192.0.2.2:1080#Two';
    const imported = await executeJson(tools, 'proxy_nodes_import', { value });

    expect(mocks.nodesImportBatch).toHaveBeenCalledWith(value);
    expect(imported).toEqual([
      expect.objectContaining({ id: 'node-batch-1', name: 'One' }),
      expect.objectContaining({ id: 'node-batch-2', name: 'Two' }),
    ]);
    expect(JSON.stringify(imported)).not.toContain('first-secret');
    expect(JSON.stringify(imported)).not.toContain('second-secret');
    expect(imported[0]).not.toHaveProperty('tcp');
    expect(imported[1]).not.toHaveProperty('udp');
  });

  it('dispatches node, chain, enforcement, and runtime mutations through the shared service', async () => {
    const tools = createTools();
    await executeJson(tools, 'proxy_node_delete', { nodeId: 'node-1' });
    await executeJson(tools, 'proxy_nodes_test', {});
    await executeJson(tools, 'proxy_chain_save', { id: 'chain-1', name: 'Exit', nodeIds: ['node-1'] });
    await executeJson(tools, 'proxy_chain_delete', { chainId: 'chain-1' });
    await executeJson(tools, 'proxy_chain_activate', { chainId: 'chain-1' });
    const enforcement = await executeJson(tools, 'proxy_enforcement_set', { enabled: true });
    const started = await executeJson(tools, 'proxy_runtime_start', {});
    const stopped = await executeJson(tools, 'proxy_runtime_stop', {});

    expect(mocks.nodeDelete).toHaveBeenCalledWith('node-1');
    expect(mocks.nodesTest).toHaveBeenCalledOnce();
    expect(mocks.chainSave).toHaveBeenCalledWith('project-1', { id: 'chain-1', name: 'Exit', nodeIds: ['node-1'] });
    expect(mocks.chainDelete).toHaveBeenCalledWith('project-1', 'chain-1');
    expect(mocks.chainActivate).toHaveBeenCalledWith('project-1', 'chain-1');
    expect(mocks.setEnforcement).toHaveBeenCalledWith('project-1', true);
    expect(mocks.start).toHaveBeenCalledWith('project-1');
    expect(mocks.stop).toHaveBeenCalledWith('project-1');
    for (const result of [enforcement, started, stopped]) {
      expect(result).not.toHaveProperty('tcpReady');
      expect(result).not.toHaveProperty('udpReady');
    }
  });

  it('lets the agent enable the proxy but rejects disabling it', async () => {
    const tools = createTools();
    await executeJson(tools, 'proxy_enforcement_set', { enabled: true });
    expect(mocks.setEnforcement).toHaveBeenCalledWith('project-1', true);

    mocks.setEnforcement.mockClear();
    await expect(executeJson(tools, 'proxy_enforcement_set', { enabled: false }))
      .rejects.toThrow(/cannot disable/i);
    expect(mocks.setEnforcement).not.toHaveBeenCalled();
  });
});

function createTools() {
  return createProxyAgentTools({
    sender: {} as never,
    sessionId: 'project-1',
    permissionMode: 'default',
  });
}

async function executeJson(
  tools: ReturnType<typeof createProxyAgentTools>,
  name: string,
  input: unknown,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  const result = await tool.execute(input);
  const content = result.content[0];
  if (content.type !== 'text') throw new Error(`Tool ${name} did not return text`);
  return JSON.parse(content.text);
}
