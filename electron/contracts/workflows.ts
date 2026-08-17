export const WORKFLOW_IPC = {
  LIST: 'workflows:list',
  READ: 'workflows:read',
  SAVE: 'workflows:save',
  DELETE: 'workflows:delete',
  IMPORT: 'workflows:import',
  EXPORT: 'workflows:export',
  PREPARE_RUN: 'workflows:prepare-run',
} as const;

export interface WorkflowFrontmatter {
  schema: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
}

export interface WorkflowDocument extends WorkflowFrontmatter {
  body: string;
  fingerprint: string;
  path: string;
  updatedAt: string;
}

export interface WorkflowSummary extends WorkflowFrontmatter {
  fingerprint: string;
  path: string;
  updatedAt: string;
  valid: boolean;
  diagnostics: string[];
}

export interface WorkflowSaveInput {
  id?: string;
  name: string;
  description?: string;
  version?: string;
  tags?: string[];
  body: string;
  expectedFingerprint?: string;
}

export interface WorkflowInvocation {
  workflowId: string;
  name: string;
  version: string;
  fingerprint: string;
  note?: string;
}

export interface WorkflowRunPreparation {
  content: string;
  invocation: WorkflowInvocation;
}

export interface WorkflowExportResult {
  canceled: boolean;
  filePath?: string;
}
