import { z } from 'zod';
import type { EgressProxyNodeInput } from '../../contracts/egress-proxy';
import { egressProxyService } from '../egress-proxy.service';
import type { AgentToolContext } from './context';
import { createAgentTool } from './contract';

export function createProxyAgentTools({ sessionId }: AgentToolContext) {
  const projectId = () => {
    if (!sessionId) throw new Error('No active engagement');
    return sessionId;
  };
  const nodeInput = {
    source: z.enum(['uri', 'form', 'yaml']).describe('Use uri for one proxy URI, form for one structured proxy object, or yaml for one Mihomo proxy object only'),
    name: z.string().trim().min(1).max(100).optional(),
    value: z.union([
      z.string().min(1).max(100_000),
      z.record(z.string().min(1).max(100), z.unknown()),
    ]).describe('Write-only proxy URI, form object, or single-proxy YAML. This value is redacted from approval UI and persisted Agent history.'),
  };
  return [
    createAgentTool('proxy_status', 'Read the active project proxy state, active-chain latency, exit IP, and errors. No controller or node secrets are returned.', {}, async () => text(withoutCapabilities(await egressProxyService.status(projectId(), false)))),
    createAgentTool('proxy_nodes_list', 'List sanitized global proxy node identities. Credentials, capability flags, and complete Mihomo objects are never returned.', {}, () => text(egressProxyService.nodesList().map(withoutCapabilities))),
    createAgentTool('proxy_node_import', 'Import one proxy node from a URI, structured form object, or single Mihomo proxy YAML object. Credentials are write-only: the stored secret and raw input are never returned.', nodeInput, async (input) => text(withoutCapabilities(await egressProxyService.nodeSave(input as EgressProxyNodeInput)))),
    createAgentTool('proxy_nodes_import', 'Atomically import 1-200 proxy node URIs with one URI per non-empty line. Blank lines are ignored; if any line is invalid, no nodes are imported. The complete URI batch is write-only and never returned.', {
      value: z.string().min(1).max(500_000).describe('Write-only proxy URIs, one per line. URI fragments may provide individual node names.'),
    }, async ({ value }) => text((await egressProxyService.nodesImportBatch(value)).map(withoutCapabilities))),
    createAgentTool('proxy_node_update', 'Replace an existing proxy node using a complete URI, structured form object, or single Mihomo proxy YAML object. The prior credentials cannot be read; provide the complete replacement value.', {
      nodeId: z.string().min(1).max(200),
      ...nodeInput,
    }, async ({ nodeId, ...input }) => text(withoutCapabilities(await egressProxyService.nodeSave(input as EgressProxyNodeInput, nodeId)))),
    createAgentTool('proxy_node_delete', 'Delete a saved proxy node by sanitized node ID. Chains that still reference the node remain blocked until repaired.', {
      nodeId: z.string().min(1).max(200),
    }, async ({ nodeId }) => text({ nodeId, deleted: await egressProxyService.nodeDelete(nodeId) })),
    createAgentTool('proxy_nodes_test', 'Test every saved node independently from the host network and return latency in milliseconds or null for timeout. This starts a temporary Mihomo probe runtime and makes network requests.', {}, async () => text(await egressProxyService.nodesTest())),
    createAgentTool('proxy_chains_list', 'List project proxy chains as ordered node IDs without node secrets.', {}, () => text(egressProxyService.chainsList(projectId()))),
    createAgentTool('proxy_chain_test', 'Actively validate and measure the total and per-hop latency of the active project proxy chain. This can make network requests through the selected nodes.', { chainId: z.string().min(1).max(200) }, async ({ chainId }) => text(withoutCapabilities(await egressProxyService.chainTest(projectId(), chainId)))),
    createAgentTool('proxy_chain_save', 'Validate and save a linear 1-8 hop chain using existing sanitized node IDs.', {
      id: z.string().min(1).max(200).optional(),
      name: z.string().min(1).max(100),
      nodeIds: z.array(z.string().min(1).max(200)).min(1).max(8).describe('Unique node IDs in Hexestra-to-exit traffic order'),
    }, async (chain) => text(await egressProxyService.chainSave(projectId(), chain))),
    createAgentTool('proxy_chain_delete', 'Delete a project proxy chain. Deleting the active chain leaves the enabled project blocked until another chain is activated.', { chainId: z.string().min(1).max(200) }, async ({ chainId }) => text({ chainId, deleted: await egressProxyService.chainDelete(projectId(), chainId) })),
    createAgentTool('proxy_chain_activate', 'Validate and activate an existing proxy chain. Existing managed connections are closed after the atomic switch.', { chainId: z.string().min(1).max(200) }, async ({ chainId }) => text(withoutCapabilities(await egressProxyService.chainActivate(projectId(), chainId)))),
    createAgentTool('proxy_enforcement_set', 'Turn the project proxy on or off. Turning it on starts the active chain; turning it off stops Mihomo and uses the direct connection.', { enabled: z.boolean() }, async ({ enabled }) => text(withoutCapabilities(await egressProxyService.setEnforcement(projectId(), enabled)))),
    createAgentTool('proxy_runtime_start', 'Start Mihomo. This does not turn the project proxy on.', {}, async () => text(withoutCapabilities(await egressProxyService.start(projectId())))),
    createAgentTool('proxy_runtime_stop', 'Stop Mihomo. If the project proxy is on, network access remains blocked.', {}, async () => text(withoutCapabilities(await egressProxyService.stop(projectId())))),
  ];
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function withoutCapabilities<T extends { tcpReady?: unknown; udpReady?: unknown; tcp?: unknown; udp?: unknown }>(value: T) {
  const visible = { ...value };
  delete visible.tcpReady;
  delete visible.udpReady;
  delete visible.tcp;
  delete visible.udp;
  return visible;
}
