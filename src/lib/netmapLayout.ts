import type { GraphEdge, GraphNode } from '@/types';

export interface PositionedGraphNode extends GraphNode {
  x: number;
  y: number;
  depth: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const NETMAP_SCANLINE_NODE_LIMIT = 220;

interface Point {
  x: number;
  y: number;
}

export function netmapNodeCoreSize(node: GraphNode, dense: boolean) {
  return dense
    ? clampLayout(9.5 + node.vulnCount * 0.85 + (node.status === 'compromised' ? 1.5 : 0), 9.5, 14)
    : clampLayout(13 + node.vulnCount * 1.35 + (node.status === 'compromised' ? 2 : 0), 13, 20);
}

export function netmapNodeScale(nodeCount: number, viewport: ViewportSize) {
  if (nodeCount === 0) return 1;
  const bounds = layoutBounds(viewport);
  const availableWidth = Math.max(1, bounds.right - bounds.left);
  const availableHeight = Math.max(1, bounds.bottom - bounds.top);
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodeCount * (availableWidth / availableHeight))));
  const rows = Math.max(1, Math.ceil(nodeCount / columns));
  const baseCellSize = nodeCount > 36 ? 46 : 58;
  const availableCellSize = Math.min(availableWidth / columns, availableHeight / rows);
  return clampLayout((availableCellSize / baseCellSize) * 0.92, 0.08, 1);
}

export function netmapNodeCollisionRadius(node: GraphNode, dense: boolean, scale = 1) {
  return (netmapNodeCoreSize(node, dense) + 7) * scale;
}

export function layoutDomain(
  nodes: GraphNode[],
  edges: GraphEdge[],
  viewport: ViewportSize,
): PositionedGraphNode[] {
  return layoutRelationships(nodes, edges, viewport);
}

export function netmapLayoutFingerprint(nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeSignatures = nodes.map((node) => JSON.stringify([
    node.id,
    node.type,
    node.status === 'compromised',
    node.vulnCount,
  ])).sort();
  const edgeSignatures = edges.map((edge) => JSON.stringify([
    edge.source,
    edge.target,
    edge.type,
  ])).sort();
  return JSON.stringify([nodeSignatures, edgeSignatures]);
}

interface WeightedNeighbor {
  id: string;
  weight: number;
}

interface LayoutParticle extends PositionedGraphNode {
  vx: number;
  vy: number;
  component: number;
}

interface LayoutBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

class SpatialPointIndex<T extends Point> {
  private readonly rows = new Map<number, Map<number, T[]>>();

  constructor(private readonly cellSize: number) {}

  add(point: T) {
    const { column, row } = this.cell(point);
    let columns = this.rows.get(row);
    if (!columns) {
      columns = new Map();
      this.rows.set(row, columns);
    }
    const points = columns.get(column) ?? [];
    points.push(point);
    columns.set(column, points);
  }

  nearby(point: Point) {
    const { column, row } = this.cell(point);
    const nearby: T[] = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      const columns = this.rows.get(row + rowOffset);
      if (!columns) continue;
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        const points = columns.get(column + columnOffset);
        if (points) nearby.push(...points);
      }
    }
    return nearby;
  }

  private cell(point: Point) {
    return {
      column: Math.floor(point.x / this.cellSize),
      row: Math.floor(point.y / this.cellSize),
    };
  }
}

const RELATION_WEIGHTS: Record<GraphEdge['type'], number> = {
  belongs_to: 1.7,
  resolves_to: 1.6,
  connected_to: 0.75,
  attack_path: 2.1,
};

function layoutRelationships(
  nodes: GraphNode[],
  edges: GraphEdge[],
  viewport: ViewportSize,
): PositionedGraphNode[] {
  if (nodes.length === 0) return [];

  const height = Math.max(viewport.height, 160);
  const bounds = layoutBounds(viewport);
  const visualScale = netmapNodeScale(nodes.length, viewport);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const validEdges = edges.filter((edge) => (
    edge.source !== edge.target && nodeById.has(edge.source) && nodeById.has(edge.target)
  ));
  const adjacency = buildWeightedAdjacency(nodes, validEdges);
  const components = findConnectedComponents(nodes, adjacency);
  const connectedComponents = components.filter((component) => (
    component.length > 1 || (adjacency.get(component[0]?.id)?.length ?? 0) > 0
  ));
  const isolatedNodes = components
    .filter((component) => component.length === 1 && (adjacency.get(component[0].id)?.length ?? 0) === 0)
    .flat();
  const centers = componentCenters(connectedComponents.length, bounds);
  const componentByNode = new Map<string, number>();
  const depthById = new Map<string, number>();
  const particles: LayoutParticle[] = [];

  connectedComponents.forEach((component, componentIndex) => {
    const hub = chooseComponentHub(component, adjacency);
    const depths = relationshipDepths(hub.id, component, adjacency);
    const center = centers[componentIndex];
    const grouped = groupNodesByDepth(component, depths);
    const maxRadius = Math.max(
      48,
      Math.min(
        (bounds.right - bounds.left) * (connectedComponents.length > 1 ? 0.22 : 0.43),
        (bounds.bottom - bounds.top) * 0.46,
        54 + Math.sqrt(component.length) * 24,
      ),
    );

    for (const node of component) {
      componentByNode.set(node.id, componentIndex);
      const depth = depths.get(node.id) ?? 0;
      depthById.set(node.id, depth);
      const peers = grouped.get(depth) ?? [node];
      const peerIndex = peers.findIndex((candidate) => candidate.id === node.id);
      const radius = depth === 0
        ? 0
        : Math.min(maxRadius, 46 + depth * 48 + Math.max(0, peers.length - 5) * 2.5);
      const angle = stableAngle(`domain:${node.id}`) + (Math.PI * 2 * peerIndex) / peers.length;
      particles.push({
        ...node,
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius * compactYScale(height),
        depth,
        vx: 0,
        vy: 0,
        component: componentIndex,
      });
    }
  });

  relaxRelationships(particles, validEdges, centers, componentByNode, bounds, visualScale);
  const connected = particles.map(({ vx: _vx, vy: _vy, component: _component, ...node }) => node);
  const isolatedDepth = Math.max(0, ...connected.map((node) => node.depth)) + 1;
  const isolated = layoutIsolatedNodes(isolatedNodes, bounds, connected.length > 0, isolatedDepth, visualScale);
  const separated = resolveNodeOverlaps([...connected, ...isolated], viewport);
  const spread = spreadAcrossWideCanvas(separated, bounds, viewport);
  const byId = new Map(spread.map((node) => [node.id, node]));

  return nodes.map((node) => byId.get(node.id) ?? {
    ...node,
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
    depth: depthById.get(node.id) ?? 0,
  });
}

function buildWeightedAdjacency(
  nodes: GraphNode[],
  edges: GraphEdge[],
) {
  const adjacency = new Map<string, WeightedNeighbor[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const weight = RELATION_WEIGHTS[edge.type];
    adjacency.get(edge.source)?.push({ id: edge.target, weight });
    adjacency.get(edge.target)?.push({ id: edge.source, weight });
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
  }
  return adjacency;
}

function findConnectedComponents(nodes: GraphNode[], adjacency: Map<string, WeightedNeighbor[]>) {
  const unvisited = new Set(nodes.map((node) => node.id));
  const sortedNodeIds = [...unvisited].sort();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const components: GraphNode[][] = [];
  let nextStartIndex = 0;

  while (unvisited.size > 0) {
    while (!unvisited.has(sortedNodeIds[nextStartIndex])) nextStartIndex += 1;
    const start = sortedNodeIds[nextStartIndex];
    const queue = [start];
    const component: GraphNode[] = [];
    unvisited.delete(start);
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const current = queue[queueIndex];
      const node = nodeById.get(current);
      if (node) component.push(node);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!unvisited.delete(neighbor.id)) continue;
        queue.push(neighbor.id);
      }
    }
    components.push(component.sort((left, right) => left.id.localeCompare(right.id)));
  }

  return components.sort((left, right) => {
    const size = right.length - left.length;
    if (size !== 0) return size;
    const leftStrength = componentStrength(left, adjacency);
    const rightStrength = componentStrength(right, adjacency);
    return rightStrength - leftStrength || left[0].id.localeCompare(right[0].id);
  });
}

function componentStrength(component: GraphNode[], adjacency: Map<string, WeightedNeighbor[]>) {
  return component.reduce(
    (sum, node) => sum + (adjacency.get(node.id) ?? []).reduce((total, neighbor) => total + neighbor.weight, 0),
    0,
  );
}

function componentCenters(count: number, bounds: LayoutBounds) {
  const center = {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  };
  if (count <= 1) return count === 0 ? [] : [center];

  const radiusX = (bounds.right - bounds.left) * 0.32;
  const radiusY = (bounds.bottom - bounds.top) * 0.3;
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return center;
    const angle = -Math.PI / 2 + (Math.PI * 2 * (index - 1)) / Math.max(1, count - 1);
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    };
  });
}

function chooseComponentHub(
  component: GraphNode[],
  adjacency: Map<string, WeightedNeighbor[]>,
) {
  return [...component].sort((left, right) => {
    const score = (node: GraphNode) => {
      const relationshipScore = (adjacency.get(node.id) ?? [])
        .reduce((sum, neighbor) => sum + neighbor.weight, 0);
      const semanticBoost = node.type === 'domain'
        ? 1.4
        : node.type === 'webapp' || node.type === 'api' ? 0.45 : 0;
      return relationshipScore + semanticBoost;
    };
    return score(right) - score(left) || left.id.localeCompare(right.id);
  })[0];
}

function relationshipDepths(
  rootId: string,
  component: GraphNode[],
  adjacency: Map<string, WeightedNeighbor[]>,
) {
  const componentIds = new Set(component.map((node) => node.id));
  const depths = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const current = queue[queueIndex];
    const nextDepth = (depths.get(current) ?? 0) + 1;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!componentIds.has(neighbor.id) || depths.has(neighbor.id)) continue;
      depths.set(neighbor.id, nextDepth);
      queue.push(neighbor.id);
    }
  }
  return depths;
}

function groupNodesByDepth(nodes: GraphNode[], depths: Map<string, number>) {
  const groups = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    const group = groups.get(depth) ?? [];
    group.push(node);
    groups.set(depth, group);
  }
  return groups;
}

function relaxRelationships(
  particles: LayoutParticle[],
  edges: GraphEdge[],
  centers: Point[],
  componentByNode: Map<string, number>,
  bounds: LayoutBounds,
  visualScale: number,
) {
  if (particles.length < 2) return;
  const byId = new Map(particles.map((particle) => [particle.id, particle]));
  const dense = particles.length > 36;
  const iterations = particles.length <= 80 ? 140 : particles.length <= 220 ? 96 : 60;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = 1 - iteration / iterations;
    for (const edge of edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const weight = RELATION_WEIGHTS[edge.type];
      const desired = (dense ? 54 : 78) / Math.sqrt(weight);
      const force = (distance - desired) * 0.018 * weight * (0.35 + cooling * 0.65);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    applyParticleRepulsion(particles, dense, visualScale);

    for (const particle of particles) {
      const center = centers[componentByNode.get(particle.id) ?? 0];
      if (center) {
        const gravity = particle.depth === 0 ? 0.028 : 0.006;
        particle.vx += (center.x - particle.x) * gravity;
        particle.vy += (center.y - particle.y) * gravity;
      }
      const speed = Math.max(1, Math.hypot(particle.vx, particle.vy));
      const speedLimit = 8 * (0.4 + cooling * 0.6);
      if (speed > speedLimit) {
        particle.vx = (particle.vx / speed) * speedLimit;
        particle.vy = (particle.vy / speed) * speedLimit;
      }
      particle.x = clampLayout(particle.x + particle.vx, bounds.left, bounds.right);
      particle.y = clampLayout(particle.y + particle.vy, bounds.top, bounds.bottom);
      particle.vx *= 0.72;
      particle.vy *= 0.72;
    }
  }
}

function applyParticleRepulsion(
  particles: LayoutParticle[],
  dense: boolean,
  visualScale: number,
) {
  if (particles.length <= 80) {
    for (let left = 0; left < particles.length; left += 1) {
      for (let right = left + 1; right < particles.length; right += 1) {
        repelParticlePair(particles[left], particles[right], dense, visualScale);
      }
    }
    return;
  }

  const maximumRadius = Math.max(
    ...particles.map((particle) => netmapNodeCollisionRadius(particle, dense, visualScale)),
  );
  const maximumInfluenceRadius = (maximumRadius * 2 + 4 * visualScale) * 4.5;
  const index = new SpatialPointIndex<Point & { particleIndex: number }>(maximumInfluenceRadius);
  particles.forEach((particle, particleIndex) => index.add({
    x: particle.x,
    y: particle.y,
    particleIndex,
  }));

  for (let left = 0; left < particles.length; left += 1) {
    const nearbyIndices = index.nearby(particles[left])
      .map((particle) => particle.particleIndex)
      .filter((right) => right > left)
      .sort((first, second) => first - second);
    for (const right of nearbyIndices) {
      repelParticlePair(particles[left], particles[right], dense, visualScale);
    }
  }
}

function repelParticlePair(
  first: LayoutParticle,
  second: LayoutParticle,
  dense: boolean,
  visualScale: number,
) {
  let dx = second.x - first.x;
  let dy = second.y - first.y;
  let distance = Math.hypot(dx, dy);
  if (distance < 0.001) {
    const angle = stableAngle(`${first.id}:${second.id}`);
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    distance = 1;
  }
  const minimumSeparation = collisionDistance(first, second, dense, visualScale);
  const influenceRadius = minimumSeparation * (first.component === second.component ? 3.2 : 4.5);
  if (distance >= influenceRadius) return;
  const collision = Math.max(0, minimumSeparation - distance) * 0.16;
  const repulsion = ((influenceRadius - distance) / influenceRadius) * 0.34 + collision;
  const fx = (dx / distance) * repulsion;
  const fy = (dy / distance) * repulsion;
  first.vx -= fx;
  first.vy -= fy;
  second.vx += fx;
  second.vy += fy;
}

function layoutIsolatedNodes(
  nodes: GraphNode[],
  bounds: LayoutBounds,
  keepPeripheral: boolean,
  depth: number,
  visualScale: number,
): PositionedGraphNode[] {
  if (nodes.length === 0) return [];
  const dense = nodes.length > 36;
  const gap = Math.max(
    12,
    ...nodes.map((node) => netmapNodeCollisionRadius(node, dense, visualScale) * 2 + 4 * visualScale),
  );
  const width = bounds.right - bounds.left;
  const columns = Math.max(1, Math.floor(width / gap));
  const rows = Math.ceil(nodes.length / columns);
  const usedColumns = Math.min(columns, nodes.length);
  const gridWidth = Math.max(0, (usedColumns - 1) * gap);
  const startX = bounds.left + Math.max(0, (width - gridWidth) / 2);
  const availableHeight = bounds.bottom - bounds.top;
  const gridHeight = Math.max(0, (rows - 1) * gap);
  const startY = keepPeripheral
    ? Math.max(bounds.top, bounds.bottom - gridHeight)
    : bounds.top + Math.max(0, (availableHeight - gridHeight) / 2);

  return [...nodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node, index) => ({
      ...node,
      x: startX + (index % columns) * gap,
      y: clampLayout(startY + Math.floor(index / columns) * gap, bounds.top, bounds.bottom),
      depth: keepPeripheral ? depth : 0,
    }));
}

export function resolveNodeOverlaps(
  nodes: PositionedGraphNode[],
  viewport: ViewportSize,
): PositionedGraphNode[] {
  if (nodes.length < 2) return nodes;
  const bounds = layoutBounds(viewport);
  const dense = nodes.length > 36;
  const visualScale = netmapNodeScale(nodes.length, viewport);
  const placed: PositionedGraphNode[] = [];
  const maximumRadius = Math.max(
    ...nodes.map((node) => netmapNodeCollisionRadius(node, dense, visualScale)),
  );
  const spatialIndex = new SpatialPointIndex<PositionedGraphNode>(
    maximumRadius * 2 + 4 * visualScale,
  );
  const ordered = [...nodes].sort((left, right) => (
    left.depth - right.depth || left.id.localeCompare(right.id)
  ));

  for (const node of ordered) {
    const positioned = findNearestFreePosition(
      node,
      placed,
      spatialIndex,
      bounds,
      dense,
      visualScale,
    );
    placed.push(positioned);
    spatialIndex.add(positioned);
  }

  const byId = new Map(placed.map((node) => [node.id, node]));
  return nodes.map((node) => byId.get(node.id) ?? node);
}

function findNearestFreePosition(
  node: PositionedGraphNode,
  placed: PositionedGraphNode[],
  spatialIndex: SpatialPointIndex<PositionedGraphNode>,
  bounds: LayoutBounds,
  dense: boolean,
  visualScale: number,
) {
  const preferred = {
    x: clampLayout(node.x, bounds.left, bounds.right),
    y: clampLayout(node.y, bounds.top, bounds.bottom),
  };
  if (positionIsFree(node, preferred, spatialIndex.nearby(preferred), dense, visualScale)) {
    return { ...node, ...preferred };
  }

  const ownRadius = netmapNodeCollisionRadius(node, dense, visualScale);
  const radialStep = Math.max(5, ownRadius * 0.72);
  const maxDistance = Math.hypot(bounds.right - bounds.left, bounds.bottom - bounds.top);
  const angleOffset = stableAngle(`collision:${node.id}`);
  for (let distance = radialStep; distance <= maxDistance; distance += radialStep) {
    const points = Math.max(12, Math.ceil((Math.PI * 2 * distance) / radialStep));
    for (let index = 0; index < points; index += 1) {
      const angle = angleOffset + (Math.PI * 2 * index) / points;
      const candidate = {
        x: clampLayout(preferred.x + Math.cos(angle) * distance, bounds.left, bounds.right),
        y: clampLayout(preferred.y + Math.sin(angle) * distance, bounds.top, bounds.bottom),
      };
      if (positionIsFree(
        node,
        candidate,
        spatialIndex.nearby(candidate),
        dense,
        visualScale,
      )) {
        return { ...node, ...candidate };
      }
    }
  }

  // Extremely small panels can run out of room at the current scale. Keep the
  // deterministic least-overlapping candidate instead of returning the exact
  // occupied point; normal NetMap sizes always resolve before this fallback.
  const fallback = leastOverlappingGridPoint(node, placed, bounds, dense, visualScale);
  return { ...node, ...fallback };
}

function positionIsFree(
  node: PositionedGraphNode,
  point: Point,
  placed: PositionedGraphNode[],
  dense: boolean,
  visualScale: number,
) {
  return placed.every((other) => Math.hypot(point.x - other.x, point.y - other.y) + 0.01 >= (
    collisionDistance(node, other, dense, visualScale)
  ));
}

function leastOverlappingGridPoint(
  node: PositionedGraphNode,
  placed: PositionedGraphNode[],
  bounds: LayoutBounds,
  dense: boolean,
  visualScale: number,
) {
  const step = Math.max(4, netmapNodeCollisionRadius(node, dense, visualScale) * 0.7);
  let best = { x: bounds.left, y: bounds.top };
  let bestClearance = Number.NEGATIVE_INFINITY;
  for (let y = bounds.top; y <= bounds.bottom; y += step) {
    for (let x = bounds.left; x <= bounds.right; x += step) {
      const clearance = placed.reduce((minimum, other) => Math.min(
        minimum,
        Math.hypot(x - other.x, y - other.y) - collisionDistance(node, other, dense, visualScale),
      ), Number.POSITIVE_INFINITY);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = { x, y };
      }
      if (clearance >= -0.01) return { x, y };
    }
  }
  return best;
}

function collisionDistance(
  left: GraphNode,
  right: GraphNode,
  dense: boolean,
  visualScale: number,
) {
  return netmapNodeCollisionRadius(left, dense, visualScale)
    + netmapNodeCollisionRadius(right, dense, visualScale)
    + 4 * visualScale;
}

function compactYScale(height: number) {
  return height < 220 ? 0.3 : height < 320 ? 0.62 : 0.82;
}

function layoutBounds(viewport: ViewportSize): LayoutBounds {
  const width = Math.max(viewport.width, 480);
  const height = Math.max(viewport.height, 160);
  return {
    left: 42,
    right: width - 42,
    top: 34,
    bottom: height - 42,
  };
}

function spreadAcrossWideCanvas(
  nodes: PositionedGraphNode[],
  bounds: LayoutBounds,
  viewport: ViewportSize,
) {
  if (nodes.length < 12 || viewport.width / Math.max(viewport.height, 1) < 2.2) return nodes;
  const xs = nodes.map((node) => node.x);
  const minimum = Math.min(...xs);
  const maximum = Math.max(...xs);
  const currentSpan = maximum - minimum;
  const availableSpan = bounds.right - bounds.left;
  const targetSpan = availableSpan * 0.84;
  if (currentSpan <= 0 || currentSpan >= targetSpan * 0.82) return nodes;
  const sourceCenter = (minimum + maximum) / 2;
  const targetCenter = (bounds.left + bounds.right) / 2;
  const scale = targetSpan / currentSpan;
  return nodes.map((node) => ({
    ...node,
    x: clampLayout(targetCenter + (node.x - sourceCenter) * scale, bounds.left, bounds.right),
  }));
}

function stableAngle(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function clampLayout(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const NETMAP_PREVIEW = {
  nodes: [
    {
      id: 'preview-gateway',
      label: 'GATEWAY',
      type: 'host',
      status: 'scanned',
      ip: '10.24.0.1',
      portCount: 4,
      vulnCount: 0,
    },
    {
      id: 'preview-web',
      label: 'WEB-NODE',
      type: 'domain',
      status: 'vulnerable',
      ip: '10.24.0.12',
      hostname: 'portal.local',
      portCount: 3,
      vulnCount: 2,
    },
    {
      id: 'preview-core',
      label: 'CORE',
      type: 'host',
      status: 'in_progress',
      ip: '10.24.0.20',
      portCount: 6,
      vulnCount: 1,
    },
    {
      id: 'preview-db',
      label: 'DATA',
      type: 'host',
      status: 'compromised',
      ip: '10.24.0.31',
      portCount: 2,
      vulnCount: 3,
    },
    {
      id: 'preview-ops',
      label: 'OPS',
      type: 'host',
      status: 'untested',
      ip: '10.24.0.44',
      portCount: 1,
      vulnCount: 0,
    },
  ] satisfies GraphNode[],
  edges: [
    { id: 'preview-e1', source: 'preview-gateway', target: 'preview-web', type: 'connected_to' },
    { id: 'preview-e2', source: 'preview-gateway', target: 'preview-core', type: 'connected_to' },
    { id: 'preview-e3', source: 'preview-core', target: 'preview-db', type: 'attack_path' },
    { id: 'preview-e4', source: 'preview-core', target: 'preview-ops', type: 'connected_to' },
    { id: 'preview-e5', source: 'preview-web', target: 'preview-core', type: 'connected_to' },
  ] satisfies GraphEdge[],
};
