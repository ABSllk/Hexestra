import { create } from 'zustand';
import type {
  GraphNode,
  GraphEdge,
  GraphLayoutState,
  GraphUpdate,
  GraphViewTransform,
} from '@/types';

type LayoutAlgorithm = 'force' | 'hierarchical' | 'grid' | 'circle';

interface NetMapStore {
  // State
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  highlightedNodeIds: string[];
  layout: LayoutAlgorithm;
  isLoading: boolean;
  error: string | null;
  view: GraphViewTransform;
  positions: Record<string, { x: number; y: number }>;

  // Actions
  setGraphData: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  applyUpdate: (update: GraphUpdate) => void;
  selectNode: (nodeId: string | null) => void;
  highlightPath: (nodeIds: string[]) => void;
  clearHighlights: () => void;
  setLayout: (layout: LayoutAlgorithm) => void;
  hydrateLayout: (state: GraphLayoutState) => void;
  setViewTransform: (view: GraphViewTransform) => void;
  setManualPosition: (nodeId: string, point: { x: number; y: number }) => void;
  resetLayout: () => void;

  // Derived
  selectedNode: () => GraphNode | null;
}

export const useNetMapStore = create<NetMapStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  highlightedNodeIds: [],
  layout: 'force',
  isLoading: false,
  error: null,
  view: { x: 0, y: 0, scale: 1 },
  positions: {},

  setGraphData: (nodes, edges) => set({ nodes, edges }),

  applyUpdate: (update) => {
    const state = get();
    switch (update.action) {
      case 'add_node':
        if (!state.nodes.find((n) => n.id === update.node.id)) {
          set({ nodes: [...state.nodes, update.node] });
        }
        break;
      case 'update_node':
        set({
          nodes: state.nodes.map((n) =>
            n.id === update.nodeId ? { ...n, ...update.changes } : n
          ),
        });
        break;
      case 'remove_node':
        set({
          nodes: state.nodes.filter((n) => n.id !== update.nodeId),
          edges: state.edges.filter(
            (e) => e.source !== update.nodeId && e.target !== update.nodeId
          ),
        });
        break;
      case 'add_edge':
        if (!state.edges.find((e) => e.id === update.edge.id)) {
          set({ edges: [...state.edges, update.edge] });
        }
        break;
      case 'remove_edge':
        set({ edges: state.edges.filter((e) => e.id !== update.edgeId) });
        break;
      case 'replace_all':
        set({ nodes: update.data.nodes, edges: update.data.edges });
        break;
      case 'highlight_path':
        set({ highlightedNodeIds: update.nodeIds });
        break;
      case 'clear_highlights':
        set({ highlightedNodeIds: [] });
        break;
    }
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  highlightPath: (nodeIds) => set({ highlightedNodeIds: nodeIds }),
  clearHighlights: () => set({ highlightedNodeIds: [] }),

  setLayout: (layout) => set({ layout }),

  hydrateLayout: (state) => set({ view: state.view, positions: state.positions }),

  setViewTransform: (view) => set({ view }),

  setManualPosition: (nodeId, point) => set((current) => ({
    positions: {
      ...current.positions,
      [nodeId]: point,
    },
  })),

  resetLayout: () => set({
    view: { x: 0, y: 0, scale: 1 },
    positions: {},
  }),

  selectedNode: () => {
    const { nodes, selectedNodeId } = get();
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  },
}));
