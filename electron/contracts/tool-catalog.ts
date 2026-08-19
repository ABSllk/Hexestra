export const TOOL_CATALOG_VERSION = 1 as const;

export const TOOL_RISKS = ['passive', 'active', 'destructive'] as const;
export const TOOL_CHANNELS = ['agent-runtime', 'electron', 'mcp', 'docker'] as const;

export type ToolRisk = typeof TOOL_RISKS[number];
export type ToolChannel = typeof TOOL_CHANNELS[number];

export interface ToolCatalogRecord {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  capabilities: string[];
  tacticIds: string[];
  techniqueIds: string[];
  risk: ToolRisk;
  channel: ToolChannel;
  command?: string;
  usage?: string;
}

export type ToolCatalogMutableFields = Omit<ToolCatalogRecord, 'id'>;

export interface ToolCatalogDocument {
  version: typeof TOOL_CATALOG_VERSION;
  tools: ToolCatalogRecord[];
}

export interface ToolCatalogDocumentResult {
  path: string;
  exists: boolean;
  document: ToolCatalogDocument;
  diagnostics: string[];
}

export interface ToolCatalogIndexEntry {
  id: string;
  name: string;
  description: string;
  channel: ToolChannel;
}

export interface ToolCatalogCandidate extends ToolCatalogRecord {
  preferred: boolean;
  matchedBy: string[];
}

export const TOOL_CATALOG_IPC = {
  LIST: 'tools:catalog:list',
  CREATE: 'tools:catalog:create',
  UPDATE: 'tools:catalog:update',
  DELETE: 'tools:catalog:delete',
} as const;
