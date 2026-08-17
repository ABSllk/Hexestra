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
      scopeAnnotation: target.scopeAnnotation,
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
      scopeAnnotation: asset.scopeAnnotation,
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

export function buildNetworkProjection(nodes: GraphNode[], edges: GraphEdge[]): GraphProjection {
  return projectTypes(nodes, edges, new Set(['local', 'subnet', 'host', 'port', 'service']), true);
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
    || (node.type === 'host' && associatedHosts.has(node.id)),
  );
  includeRelatedSecurityAssets(visible, nodes, edges);
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

export function buildApplicationProjection(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expandedNodeIds: ReadonlySet<string> = new Set(),
): GraphProjection {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, GraphNode[]>();
  for (const edge of edges) {
    if (edge.semantic !== 'endpoint_of' && edge.semantic !== 'parameter_of') continue;
    const child = nodeById.get(edge.source);
    const parent = nodeById.get(edge.target);
    if (!child || !parent) continue;
    const existing = children.get(parent.id) ?? [];
    existing.push(child);
    children.set(parent.id, existing);
  }

  const visible = nodes
    .filter((node) => node.type === 'webapp' || node.type === 'api')
    .map((node) => withChildCount(node, children.get(node.id)?.filter((child) => child.type === 'endpoint').length ?? 0));
  for (const api of visible.filter((node) => node.type === 'api')) {
    if (!expandedNodeIds.has(api.id)) continue;
    for (const endpoint of children.get(api.id) ?? []) {
      if (endpoint.type !== 'endpoint') continue;
      visible.push(withChildCount(
        endpoint,
        children.get(endpoint.id)?.filter((child) => child.type === 'parameter').length ?? 0,
      ));
      if (!expandedNodeIds.has(endpoint.id)) continue;
      visible.push(...(children.get(endpoint.id) ?? []).filter((child) => child.type === 'parameter'));
    }
  }
  includeRelatedSecurityAssets(visible, nodes, edges);
  const ids = new Set(visible.map((node) => node.id));
  return {
    nodes: visible,
    edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}

export function ancestorsToReveal(nodeId: string, nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const result = new Set<string>();
  let cursor = nodeById.get(nodeId);
  while (cursor?.type === 'endpoint' || cursor?.type === 'parameter') {
    const semantic = cursor.type === 'endpoint' ? 'endpoint_of' : 'parameter_of';
    const parentId = edges.find((edge) => edge.source === cursor?.id && edge.semantic === semantic)?.target;
    if (!parentId) break;
    result.add(parentId);
    cursor = nodeById.get(parentId);
  }
  return result;
}

export function perspectiveForNode(type: GraphNode['type']): 'network' | 'domain' | 'application' {
  if (type === 'subnet' || type === 'host' || type === 'port' || type === 'service' || type === 'local') {
    return 'network';
  }
  if (type === 'endpoint' || type === 'parameter') return 'application';
  return 'domain';
}

export function perspectiveForAsset(
  nodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): 'network' | 'domain' | 'application' {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return 'domain';
  if (node.type !== 'certificate' && node.type !== 'identity') return perspectiveForNode(node.type);
  const nodeById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const neighborTypes = edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => nodeById.get(edge.source === nodeId ? edge.target : edge.source)?.type);
  if (neighborTypes.some((type) => type === 'endpoint' || type === 'parameter')) return 'application';
  if (neighborTypes.some((type) => type === 'domain' || type === 'webapp' || type === 'api')) return 'domain';
  return 'network';
}

function projectTypes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  types: ReadonlySet<GraphNode['type']>,
  securityAssets: boolean,
): GraphProjection {
  const visible = nodes.filter((node) => types.has(node.type));
  if (securityAssets) includeRelatedSecurityAssets(visible, nodes, edges);
  const ids = new Set(visible.map((node) => node.id));
  return { nodes: visible, edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
}

function includeRelatedSecurityAssets(visible: GraphNode[], nodes: GraphNode[], edges: GraphEdge[]) {
  const ids = new Set(visible.map((node) => node.id));
  const securityById = new Map(nodes
    .filter((node) => node.type === 'certificate' || node.type === 'identity')
    .map((node) => [node.id, node]));
  for (const edge of edges) {
    if (ids.has(edge.source) && securityById.has(edge.target) && !ids.has(edge.target)) {
      visible.push(securityById.get(edge.target)!);
      ids.add(edge.target);
    }
    if (ids.has(edge.target) && securityById.has(edge.source) && !ids.has(edge.source)) {
      visible.push(securityById.get(edge.source)!);
      ids.add(edge.source);
    }
  }
}

function withChildCount(node: GraphNode, childCount: number): GraphNode {
  return childCount > 0
    ? { ...node, properties: { ...node.properties, childCount } }
    : node;
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
