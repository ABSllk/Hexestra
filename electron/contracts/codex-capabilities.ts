export type CodexSkillScope = 'user' | 'repo' | 'system' | 'admin';

export interface CodexSkillItem {
  name: string;
  description: string;
  path: string;
  scope: CodexSkillScope;
  enabled: boolean;
  editable: boolean;
}

export interface CodexSkillListResult {
  runtimeLabel: string;
  projectAvailable: boolean;
  items: CodexSkillItem[];
  errors: Array<{ source: string; detail: string }>;
}

export interface CodexSkillSaveInput {
  sessionId?: string | null;
  scope: 'user' | 'repo';
  name: string;
  content: string;
  originalPath?: string | null;
}

export interface CodexSkillCopyInput {
  sessionId?: string | null;
  sourcePath: string;
  scope: 'user' | 'repo';
  name: string;
}

export interface CodexMcpItem {
  name: string;
  definition: Record<string, unknown>;
  scope: 'user' | 'project' | 'managed' | 'plugin';
  configFile?: string | null;
  pluginId?: string | null;
  enabled: boolean;
  status: 'connected' | 'failed' | 'pending' | 'needs-auth' | 'disabled' | 'unknown';
  toolCount: number;
  error: string | null;
}

export interface CodexMcpListResult {
  runtimeLabel: string;
  items: CodexMcpItem[];
}

export interface CodexMcpSaveInput {
  sessionId?: string | null;
  scope?: 'user' | 'project';
  name: string;
  definition: Record<string, unknown>;
  originalName?: string | null;
}
