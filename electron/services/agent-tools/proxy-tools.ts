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
    source: z.enum(['uri', 'form', 'yaml']).describe('Input kind: uri, form, or yaml'),
    name: z.string().trim().min(1).max(100).optional(),
    value: z.union([
      z.string().min(1).max(100_000),
      z.record(z.string().min(1).max(100), z.unknown()),
    ]).describe('Write-only proxy URI, form object, or single-proxy YAML; redacted in approval UI and Agent history.'),
  };
  return [
    createAgentTool('proxy_status', 'Read project proxy state, latency, exit IP, and errors; secrets are omitted.', {}, async () => text(withoutCapabilities(await egressProxyService.status(projectId(), false)))),
    createAgentTool('proxy_nodes_list', 'List global proxy node identities without credentials or capability flags; complete Mihomo objects are never returned.', {}, () => text(egressProxyService.nodesList().map(withoutCapabilities))),
    createAgentTool('proxy_node_import', 'Import a proxy node from a URI, form object, or Mihomo proxy YAML. Credentials are write-only; stored secrets and raw input are not returned.', nodeInput, async (input) => text(withoutCapabilities(await egressProxyService.nodeSave(input as EgressProxyNodeInput)))),
    createAgentTool('proxy_nodes_import', 'Atomically import 1-200 proxy node URIs, one per non-empty line. Blank lines are ignored; any invalid line rejects the batch. Input is write-only.', {
      value: z.string().min(1).max(500_000).describe('Write-only proxy URIs, one per line; URI fragments may set node names.'),
    }, async ({ value }) => text((await egressProxyService.nodesImportBatch(value)).map(withoutCapabilities))),
    createAgentTool('proxy_node_update', 'Replace a proxy node from a URI, form object, or Mihomo proxy YAML. Provide the full value; stored credentials are unreadable.', {
      nodeId: z.string().min(1).max(200),
      ...nodeInput,
    }, async ({ nodeId, ...input }) => text(withoutCapabilities(await egressProxyService.nodeSave(input as EgressProxyNodeInput, nodeId)))),
    createAgentTool('proxy_node_delete', 'Delete a saved proxy node by ID. Referencing chains remain blocked until repaired.', {
      nodeId: z.string().min(1).max(200),
    }, async ({ nodeId }) => text({ nodeId, deleted: await egressProxyService.nodeDelete(nodeId) })),
    createAgentTool('proxy_nodes_test', 'Test saved nodes from the host; return latency in milliseconds or null on timeout. Uses a temporary Mihomo runtime and makes network requests.', {}, async () => text(await egressProxyService.nodesTest())),
    createAgentTool('proxy_chains_list', 'List project proxy chains as ordered node IDs without node secrets.', {}, () => text(egressProxyService.chainsList(projectId()))),
    createAgentTool('proxy_chain_test', 'Validate the active chain and return total and per-hop latency. Makes network requests through selected nodes.', { chainId: z.string().min(1).max(200) }, async ({ chainId }) => text(withoutCapabilities(await egressProxyService.chainTest(projectId(), chainId)))),
    createAgentTool('proxy_chain_save', 'Validate and save a linear 1-8 hop chain from node IDs.', {
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
