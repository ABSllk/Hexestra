import { describe, expect, it } from 'vitest';
import type { GraphNode } from '@/types';
import {
  layoutDomain,
  netmapLayoutFingerprint,
  netmapNodeCollisionRadius,
  netmapNodeScale,
  NETMAP_PREVIEW,
  resolveNodeOverlaps,
} from '@/lib/netmapLayout';

describe('netmapLayout', () => {
  it('returns an empty layout for an empty graph', () => {
    expect(layoutDomain([], [], { width: 800, height: 400 })).toEqual([]);
  });

  it('keeps the relationship hub near the usable canvas center and all nodes finite', () => {
    const result = layoutDomain(NETMAP_PREVIEW.nodes, NETMAP_PREVIEW.edges, {
      width: 1000,
      height: 420,
    });
    const root = result.find((node) => node.id === 'preview-core');

    expect(root?.depth).toBe(0);
    expect(Math.hypot(root!.x - 500, root!.y - 210)).toBeLessThan(70);
    expect(result).toHaveLength(NETMAP_PREVIEW.nodes.length);
    for (const node of result) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThan(0);
      expect(node.y).toBeGreaterThan(0);
    }
  });

  it('keeps disconnected nodes on an outer depth', () => {
    const isolated: GraphNode = {
      id: 'isolated',
      label: 'ISOLATED',
      type: 'host',
      status: 'untested',
      ip: '10.0.0.99',
      portCount: 0,
      vulnCount: 0,
    };
    const result = layoutDomain(
      [...NETMAP_PREVIEW.nodes, isolated],
      NETMAP_PREVIEW.edges,
      { width: 900, height: 360 },
    );
    const isolatedNode = result.find((node) => node.id === isolated.id);
    const connectedDepths = result
      .filter((node) => node.id !== isolated.id)
      .map((node) => node.depth);

    expect(isolatedNode?.depth).toBeGreaterThan(Math.max(...connectedDepths));
  });

  it('keeps compact preview nodes inside a short bottom panel', () => {
    const result = layoutDomain(NETMAP_PREVIEW.nodes, NETMAP_PREVIEW.edges, {
      width: 1000,
      height: 165,
    });

    for (const node of result) {
      expect(node.y).toBeGreaterThanOrEqual(34);
      expect(node.y).toBeLessThanOrEqual(131);
    }
  });

  it('leaves collision-safe space between compact peer nodes', () => {
    const result = layoutDomain(NETMAP_PREVIEW.nodes, NETMAP_PREVIEW.edges, {
      width: 1388,
      height: 217,
    });
    expectNoNodeOverlap(result, { width: 1388, height: 217 });
  });

  it('keeps compact connected nodes gathered without stacking peers', () => {
    const result = layoutDomain(NETMAP_PREVIEW.nodes, NETMAP_PREVIEW.edges, {
      width: 1200,
      height: 165,
    });
    const web = result.find((node) => node.id === 'preview-web')!;
    const firstDepthPeers = result.filter((node) => node.depth === web.depth);

    for (const edge of NETMAP_PREVIEW.edges) {
      const source = result.find((node) => node.id === edge.source)!;
      const target = result.find((node) => node.id === edge.target)!;
      expect(Math.hypot(source.x - target.x, source.y - target.y)).toBeLessThan(180);
    }
    expect(new Set(firstDepthPeers.map((node) => `${Math.round(node.x)}:${Math.round(node.y)}`)).size)
      .toBe(firstDepthPeers.length);
  });

  it('keeps a wide compact topology gathered in a central cluster', () => {
    const result = layoutDomain(NETMAP_PREVIEW.nodes, NETMAP_PREVIEW.edges, {
      width: 2048,
      height: 165,
    });
    const xPositions = result.map((node) => node.x);
    const yPositions = result.map((node) => node.y);

    expect(Math.max(...xPositions) - Math.min(...xPositions)).toBeLessThanOrEqual(560);
    expect(Math.min(...xPositions)).toBeGreaterThan(300);
    expect(new Set(yPositions.map((value) => Math.round(value))).size).toBeGreaterThan(1);
  });

  it('uses the horizontal canvas for a large relationship graph', () => {
    const nodes: GraphNode[] = Array.from({ length: 48 }, (_, index) => ({
      id: `wide-${index}`, label: `node-${index}.example.com`, type: 'domain',
      status: 'scanned', portCount: 0, vulnCount: 0,
    }));
    const edges = nodes.slice(1).map((node, index) => ({
      id: `wide-edge-${index}`, source: nodes[Math.floor(index / 3)].id,
      target: node.id, type: 'belongs_to' as const,
    }));
    const result = layoutDomain(nodes, edges, { width: 2200, height: 420 });
    const xs = result.map((node) => node.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1500);
    expectNoNodeOverlap(result, { width: 2200, height: 420 });
  });

  it('keeps direct domain relationships tighter than two-hop relationships', () => {
    const nodes: GraphNode[] = [
      { id: 'root', label: 'example.com', type: 'domain', status: 'scanned', portCount: 0, vulnCount: 0 },
      { id: 'child', label: 'api.example.com', type: 'domain', status: 'scanned', portCount: 0, vulnCount: 0 },
      { id: 'app', label: 'https://api.example.com', type: 'webapp', status: 'scanned', portCount: 1, vulnCount: 0 },
      { id: 'host', label: '192.0.2.10', type: 'host', status: 'scanned', portCount: 1, vulnCount: 0 },
    ];
    const result = layoutDomain(nodes, [
      { id: 'child-root', source: 'child', target: 'root', type: 'belongs_to' },
      { id: 'app-child', source: 'app', target: 'child', type: 'belongs_to' },
      { id: 'child-host', source: 'child', target: 'host', type: 'resolves_to' },
    ], { width: 1200, height: 220 });
    const byId = new Map(result.map((node) => [node.id, node]));

    const distance = (left: string, right: string) => Math.hypot(
      byId.get(left)!.x - byId.get(right)!.x,
      byId.get(left)!.y - byId.get(right)!.y,
    );
    expect(distance('root', 'child')).toBeLessThan(distance('root', 'app'));
    expect(distance('child', 'host')).toBeLessThan(distance('root', 'host'));
  });

  it('keeps Domain ownership relationships tighter than runtime-only links', () => {
    const nodes: GraphNode[] = [
      { id: 'hub', label: 'hub', type: 'domain', status: 'scanned', portCount: 0, vulnCount: 0 },
      { id: 'owned', label: 'owned', type: 'webapp', status: 'scanned', portCount: 0, vulnCount: 0 },
      { id: 'peer', label: 'peer', type: 'host', status: 'scanned', portCount: 0, vulnCount: 0 },
    ];
    const edges = [
      { id: 'ownership', source: 'owned', target: 'hub', type: 'belongs_to' as const },
      { id: 'runtime', source: 'peer', target: 'hub', type: 'connected_to' as const },
    ];
    const domain = new Map(layoutDomain(nodes, edges, { width: 900, height: 360 }).map((node) => [node.id, node]));
    const distance = (layout: typeof domain, nodeId: string) => Math.hypot(
      layout.get('hub')!.x - layout.get(nodeId)!.x,
      layout.get('hub')!.y - layout.get(nodeId)!.y,
    );

    expect(distance(domain, 'owned')).toBeLessThan(distance(domain, 'peer'));
  });

  it('returns identical automatic positions for identical graph input', () => {
    const first = layoutDomain(NETMAP_PREVIEW.nodes, NETMAP_PREVIEW.edges, { width: 1200, height: 320 });
    const second = layoutDomain(NETMAP_PREVIEW.nodes, NETMAP_PREVIEW.edges, { width: 1200, height: 320 });
    expect(second).toEqual(first);
  });

  it('uses only geometry-relevant graph fields in the layout fingerprint', () => {
    const nodes = NETMAP_PREVIEW.nodes.map((node) => ({ ...node }));
    const edges = NETMAP_PREVIEW.edges.map((edge) => ({ ...edge }));
    const reorderedNodes = [...nodes].reverse().map((node) => ({
      ...node,
      label: `renamed-${node.label}`,
      portCount: node.portCount + 1,
    }));
    const reorderedEdges = [...edges].reverse().map((edge) => ({
      ...edge,
      id: `refreshed-${edge.id}`,
      label: 'Updated evidence label',
    }));

    expect(netmapLayoutFingerprint(reorderedNodes, reorderedEdges))
      .toBe(netmapLayoutFingerprint(nodes, edges));
    expect(netmapLayoutFingerprint(
      nodes.map((node, index) => index === 0 ? { ...node, vulnCount: node.vulnCount + 1 } : node),
      edges,
    )).not.toBe(netmapLayoutFingerprint(nodes, edges));
  });

  it('separates unrelated components while gathering nodes within each component', () => {
    const nodes: GraphNode[] = ['a', 'b', 'c', 'x', 'y'].map((id) => ({
      id, label: id, type: 'host', status: 'scanned', portCount: 0, vulnCount: 0,
    }));
    const edges = [
      { id: 'ab', source: 'a', target: 'b', type: 'connected_to' as const },
      { id: 'bc', source: 'b', target: 'c', type: 'connected_to' as const },
      { id: 'xy', source: 'x', target: 'y', type: 'connected_to' as const },
    ];
    const result = new Map(layoutDomain(nodes, edges, { width: 1200, height: 360 }).map((node) => [node.id, node]));
    const centroid = (ids: string[]) => ({
      x: ids.reduce((sum, id) => sum + result.get(id)!.x, 0) / ids.length,
      y: ids.reduce((sum, id) => sum + result.get(id)!.y, 0) / ids.length,
    });
    const first = centroid(['a', 'b', 'c']);
    const second = centroid(['x', 'y']);
    const componentDistance = Math.hypot(first.x - second.x, first.y - second.y);
    const longestRelationship = Math.max(...edges.map((edge) => Math.hypot(
      result.get(edge.source)!.x - result.get(edge.target)!.x,
      result.get(edge.source)!.y - result.get(edge.target)!.y,
    )));

    expect(componentDistance).toBeGreaterThan(longestRelationship);
  });

  it('keeps dense connected nodes from occupying the same visual position', () => {
    const nodes: GraphNode[] = Array.from({ length: 64 }, (_, index) => ({
      id: `asset-${index}`,
      label: `asset-${index}`,
      type: index === 0 ? 'domain' : 'host',
      status: 'scanned',
      portCount: 0,
      vulnCount: 0,
    }));
    const edges = nodes.slice(1).map((node, index) => ({
      id: `relation-${index}`,
      source: 'asset-0',
      target: node.id,
      type: index % 2 === 0 ? 'resolves_to' as const : 'connected_to' as const,
    }));
    const result = layoutDomain(nodes, edges, { width: 1800, height: 430 });
    expectNoNodeOverlap(result, { width: 1800, height: 430 });
  });

  it('uses collision-spaced placement for a dense disconnected domain graph', () => {
    const nodes: GraphNode[] = Array.from({ length: 118 }, (_, index) => ({
      id: `domain-${index}`,
      label: `node-${index}.example.com`,
      type: 'domain',
      status: 'scanned',
      portCount: 0,
      vulnCount: 0,
    }));
    const result = layoutDomain(nodes, [], { width: 2560, height: 430 });
    expectNoNodeOverlap(result, { width: 2560, height: 430 });
    expect(new Set(result.map((node) => Math.round(node.x))).size).toBeGreaterThan(10);

    const compressed = layoutDomain(nodes, [], { width: 480, height: 160 });
    expectNoNodeOverlap(compressed, { width: 480, height: 160 });
    expect(netmapNodeScale(nodes.length, { width: 480, height: 160 })).toBeLessThan(1);
  });

  it('separates nodes that start at the exact same manual position', () => {
    const viewport = { width: 1000, height: 320 };
    const nodes = NETMAP_PREVIEW.nodes.slice(0, 3).map((node) => ({
      ...node,
      x: 240,
      y: 120,
      depth: 1,
    }));

    expectNoNodeOverlap(resolveNodeOverlaps(nodes, viewport), viewport);
  });

  it('lays out a representative large project graph deterministically without overlap', () => {
    const nodes: GraphNode[] = Array.from({ length: 381 }, (_, index) => ({
      id: `large-${index}`,
      label: `node-${index}.example.com`,
      type: 'domain',
      status: 'scanned',
      portCount: 0,
      vulnCount: index % 29 === 0 ? 1 : 0,
    }));
    const edges = nodes.slice(1, 199).map((node, index) => ({
      id: `large-edge-${index}`,
      source: node.id,
      target: nodes[0].id,
      type: 'belongs_to' as const,
    }));
    const viewport = { width: 1_920, height: 480 };

    const first = layoutDomain(nodes, edges, viewport);
    const second = layoutDomain(nodes, edges, viewport);

    expect(second).toEqual(first);
    expectNoNodeOverlap(first, viewport);
  });
});

function expectNoNodeOverlap(
  nodes: ReturnType<typeof layoutDomain>,
  viewport: { width: number; height: number },
) {
  const dense = nodes.length > 36;
  const scale = netmapNodeScale(nodes.length, viewport);
  const overlaps: string[] = [];
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const minimum = netmapNodeCollisionRadius(nodes[left], dense, scale)
        + netmapNodeCollisionRadius(nodes[right], dense, scale)
        + 4 * scale;
      if (Math.hypot(nodes[left].x - nodes[right].x, nodes[left].y - nodes[right].y) + 0.01 < minimum) {
        overlaps.push(`${nodes[left].id}:${nodes[right].id}`);
      }
    }
  }
  expect(overlaps).toEqual([]);
}
