import type { TargetStatus } from './target';

export type NodeType = 'local' | 'host' | 'domain' | 'webapp' | 'api' | 'service' | 'identity' | 'subnet';
export type EdgeType = 'belongs_to' | 'resolves_to' | 'connected_to' | 'attack_path';

export interface GraphViewTransform {
  x: number;
  y: number;
  scale: number;
}

export interface GraphLayoutState {
  view: GraphViewTransform;
  positions: Record<string, { x: number; y: number }>;
}

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  status: TargetStatus;
  ip?: string;
  hostname?: string;
  key?: string;
  properties?: Record<string, string | number | boolean | string[]>;
  aiSummary?: string;
  portCount: number;
  vulnCount: number;
  virtual?: boolean;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  metadata?: Record<string, string>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type GraphUpdate =
  | { action: 'add_node'; node: GraphNode }
  | { action: 'update_node'; nodeId: string; changes: Partial<GraphNode> }
  | { action: 'remove_node'; nodeId: string }
  | { action: 'add_edge'; edge: GraphEdge }
  | { action: 'remove_edge'; edgeId: string }
  | { action: 'replace_all'; data: GraphData }
  | { action: 'highlight_path'; nodeIds: string[] }
  | { action: 'clear_highlights' };
