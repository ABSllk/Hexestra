export type ClaudeSkillScope = 'personal' | 'project';
export type ClaudeMcpScope = 'user' | 'project' | 'local';

export interface ClaudeSkillDescriptor {
  id: string;
  name: string;
  description: string;
  scope: ClaudeSkillScope;
  enabled: boolean;
  sourcePath: string;
}

export interface ClaudeSkillListResult {
  runtimeLabel: string;
  projectAvailable: boolean;
  items: ClaudeSkillDescriptor[];
  errors: ClaudeCapabilitySourceError[];
}

export interface ClaudeSkillDocument extends ClaudeSkillDescriptor {
  content: string;
}

export interface ClaudeSkillSaveInput {
  sessionId?: string | null;
  scope: ClaudeSkillScope;
  name: string;
  content: string;
  enabled?: boolean;
  originalName?: string | null;
}

export interface ClaudeSkillReference {
  sessionId?: string | null;
  scope: ClaudeSkillScope;
  name: string;
  enabled: boolean;
}

export interface ClaudeMcpDescriptor {
  id: string;
  name: string;
  scope: ClaudeMcpScope;
  definition: Record<string, unknown>;
  effective: boolean;
  shadowedBy: ClaudeMcpScope | null;
  sourcePath: string;
}

export interface ClaudeMcpListResult {
  runtimeLabel: string;
  projectAvailable: boolean;
  items: ClaudeMcpDescriptor[];
  errors: ClaudeCapabilitySourceError[];
}

export interface ClaudeMcpSaveInput {
  sessionId?: string | null;
  scope: ClaudeMcpScope;
  name: string;
  definition: Record<string, unknown>;
  originalName?: string | null;
}

export interface ClaudeMcpReference {
  sessionId?: string | null;
  scope: ClaudeMcpScope;
  name: string;
}

export interface ClaudeCapabilitySourceError {
  source: string;
  detail: string;
}
