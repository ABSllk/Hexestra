import { beforeEach, describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@/types';
import { useNetMapStore } from '@/stores/useNetMapStore';

const node: GraphNode = {
  id: 'host-a',
  label: 'HOST-A',
  type: 'host',
  status: 'untested',
  ip: '10.0.0.1',
  portCount: 0,
  vulnCount: 0,
};

const secondNode: GraphNode = {
  ...node,
  id: 'host-b',
  label: 'HOST-B',
  ip: '10.0.0.2',
};

const edge: GraphEdge = {
  id: 'edge-a-b',
  source: node.id,
  target: secondNode.id,
  type: 'connected_to',
};

describe('useNetMapStore', () => {
  beforeEach(() => {
    useNetMapStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      highlightedNodeIds: [],
      layout: 'force',
      isLoading: false,
      error: null,
      view: { x: 0, y: 0, scale: 1 },
      positions: {},
    });
  });

  it('applies graph updates without duplicating nodes or edges', () => {
    const store = useNetMapStore.getState();
    store.applyUpdate({ action: 'add_node', node });
    store.applyUpdate({ action: 'add_node', node });
    store.applyUpdate({ action: 'add_node', node: secondNode });
    store.applyUpdate({ action: 'add_edge', edge });
    store.applyUpdate({ action: 'add_edge', edge });

    expect(useNetMapStore.getState().nodes).toHaveLength(2);
    expect(useNetMapStore.getState().edges).toHaveLength(1);
  });

  it('updates selection, risk data, and removes connected edges with a node', () => {
    useNetMapStore.getState().setGraphData([node, secondNode], [edge]);
    useNetMapStore.getState().selectNode(node.id);
    useNetMapStore.getState().applyUpdate({
      action: 'update_node',
      nodeId: node.id,
      changes: { status: 'vulnerable', vulnCount: 2 },
    });

    expect(useNetMapStore.getState().selectedNode()).toMatchObject({
      id: node.id,
      status: 'vulnerable',
      vulnCount: 2,
    });

    useNetMapStore.getState().applyUpdate({ action: 'remove_node', nodeId: node.id });
    expect(useNetMapStore.getState().nodes).toEqual([secondNode]);
    expect(useNetMapStore.getState().edges).toEqual([]);
  });

  it('keeps the Domain view transform and dragged positions in one layout state', () => {
    const store = useNetMapStore.getState();
    store.setViewTransform({ x: 10, y: 20, scale: 1.2 });
    store.setManualPosition('host-a', { x: 100, y: 80 });

    const state = useNetMapStore.getState();
    expect(state.view).toEqual({ x: 10, y: 20, scale: 1.2 });
    expect(state.positions['host-a']).toEqual({ x: 100, y: 80 });
  });
});
