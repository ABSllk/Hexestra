import type { AssetRecord, GraphEdge, GraphNode, Target } from '@/types';

export const LOCAL_NODE_ID = 'local-operator';

export const LOCAL_GRAPH_NODE: GraphNode = {
  id: LOCAL_NODE_ID,
  label: 'THIS DEVICE',
  type: 'local',
  status: 'scanned',
  hostname: 'LOCAL',
  portCount: 0,
  vulnCount: 0,
};

export interface AgentTargetContext {
  target: GraphNode & Pick<Partial<Target>, 'ports' | 'services' | 'os' | 'domains' | 'tags' | 'aiSummary'>;
  relationships: GraphEdge[];
  neighbors: Array<{
    id: string;
    label: string;
    ip?: string;
    hostname?: string;
    type: GraphNode['type'];
    key?: string;
    status: GraphNode['status'];
    relation: GraphEdge['type'];
    direction: 'outbound' | 'inbound';
    portCount: number;
    vulnCount: number;
  }>;
  pathFromLocal: Array<{ id: string; label: string; ip?: string }>;
}

export function projectNetMapNodes(targets: Target[], assets: AssetRecord[] = []): GraphNode[] {
  return [
    LOCAL_GRAPH_NODE,
    ...targets.map((target) => ({
      id: target.id,
      label: target.hostname || target.ip,
      type: 'host' as const,
      status: target.status,
      ip: target.ip,
      hostname: target.hostname,
      portCount: target.ports.filter((port) => port.state === 'open').length,
      vulnCount: target.vulnCount,
    })),
    ...assets.map((asset) => ({
      id: asset.id,
      key: asset.key,
      label: asset.label,
      type: asset.type,
      status: asset.status,
      ip: typeof asset.properties.ip === 'string' ? asset.properties.ip : undefined,
      hostname: asset.type === 'domain' ? asset.label : undefined,
      properties: asset.properties,
      aiSummary: asset.aiSummary,
      portCount: typeof asset.properties.port === 'number' ? 1 : 0,
      vulnCount: asset.vulnCount,
    })),
  ];
}

export interface GraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildDomainProjection(nodes: GraphNode[], edges: GraphEdge[]): GraphProjection {
  const domainFacingTypes = new Set<GraphNode['type']>(['domain', 'webapp', 'api']);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const associatedHosts = new Set<string>();
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    if (source.type === 'host' && domainFacingTypes.has(target.type)) associatedHosts.add(source.id);
    if (target.type === 'host' && domainFacingTypes.has(source.type)) associatedHosts.add(target.id);
  }

  const visible = nodes.filter((node) =>
    domainFacingTypes.has(node.type)
    || node.type === 'service'
    || (node.type === 'host' && associatedHosts.has(node.id)),
  );
  const unassociatedHosts = nodes.filter((node) => node.type === 'host' && !associatedHosts.has(node.id));
  if (unassociatedHosts.length > 0) {
    visible.push({
      id: 'virtual:unassociated-hosts',
      label: `UNASSOCIATED HOSTS × ${unassociatedHosts.length}`,
      type: 'host',
      status: 'untested',
      portCount: unassociatedHosts.reduce((sum, node) => sum + node.portCount, 0),
      vulnCount: unassociatedHosts.reduce((sum, node) => sum + node.vulnCount, 0),
      properties: { memberIds: unassociatedHosts.map((node) => node.id) },
      virtual: true,
    });
  }
  const ids = new Set(visible.map((node) => node.id));
  return {
    nodes: visible,
    edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}

export function buildAgentTargetContext(
  selectedNodeId: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
  targets: Target[],
  assets: AssetRecord[] = [],
): AgentTargetContext | undefined {
  if (!selectedNodeId) return undefined;
  const node = nodes.find((candidate) => candidate.id === selectedNodeId);
  if (!node) return undefined;

  const fullTarget = targets.find((candidate) => candidate.id === selectedNodeId);
  const fullAsset = assets.find((candidate) => candidate.id === selectedNodeId);
  const relationships = edges.filter(
    (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
  );
  const nodeById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const neighbors = relationships.flatMap((edge) => {
    const outbound = edge.source === selectedNodeId;
    const neighbor = nodeById.get(outbound ? edge.target : edge.source);
    return neighbor
      ? [{
          id: neighbor.id,
          label: neighbor.label,
          ip: neighbor.ip,
          hostname: neighbor.hostname,
          type: neighbor.type,
          key: neighbor.key,
          status: neighbor.status,
          relation: edge.type,
          direction: outbound ? 'outbound' as const : 'inbound' as const,
          portCount: neighbor.portCount,
          vulnCount: neighbor.vulnCount,
        }]
      : [];
  });

  return {
    target: {
      ...node,
      ports: fullTarget?.ports,
      services: fullTarget?.services,
      os: fullTarget?.os,
      domains: fullTarget?.domains,
      tags: fullTarget?.tags,
      aiSummary: fullTarget?.aiSummary,
      key: fullAsset?.key ?? node.key,
      properties: fullAsset?.properties ?? node.properties,
      ...(fullAsset?.aiSummary && !fullTarget ? { aiSummary: fullAsset.aiSummary } : {}),
    },
    relationships,
    neighbors,
    pathFromLocal: shortestPath(LOCAL_NODE_ID, selectedNodeId, nodes, edges)
      .map((id) => nodeById.get(id))
      .filter((candidate): candidate is GraphNode => Boolean(candidate))
      .map(({ id, label, ip }) => ({ id, label, ip })),
  };
}

function shortestPath(
  sourceId: string,
  targetId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
) {
  if (sourceId === targetId) return [sourceId];
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return [];

  const adjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const previous = new Map<string, string | null>([[sourceId, null]]);
  const queue = [sourceId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      if (neighbor === targetId) {
        const path = [targetId];
        let cursor: string | null = current;
        while (cursor) {
          path.push(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return [];
}
