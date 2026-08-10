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

export type ClaudeMcpConnectionState =
  | 'connected'
  | 'failed'
  | 'needs-auth'
  | 'pending'
  | 'disabled';

export interface ClaudeMcpRuntimeStatus {
  name: string;
  status: ClaudeMcpConnectionState;
  error: string | null;
  scope: string | null;
  toolCount: number;
}

export interface ClaudeMcpRuntimeStatusResult {
  checkedAt: string;
  items: ClaudeMcpRuntimeStatus[];
}

export function normalizeClaudeMcpRuntimeStatusResult(
  value: unknown,
): ClaudeMcpRuntimeStatusResult | null {
  if (!isRecord(value) || typeof value.checkedAt !== 'string' || !Array.isArray(value.items)) return null;
  const items = value.items.flatMap((candidate): ClaudeMcpRuntimeStatus[] => {
    if (!isRecord(candidate) || typeof candidate.name !== 'string' || !isMcpConnectionState(candidate.status)) return [];
    const name = candidate.name.trim();
    if (!name) return [];
    return [{
      name,
      status: candidate.status,
      error: sanitizeClaudeMcpRuntimeError(candidate.error),
      scope: typeof candidate.scope === 'string' && candidate.scope.trim()
        ? candidate.scope.trim().slice(0, 100)
        : null,
      toolCount: typeof candidate.toolCount === 'number' && Number.isFinite(candidate.toolCount)
        ? Math.max(0, Math.floor(candidate.toolCount))
        : 0,
    }];
  });
  return { checkedAt: value.checkedAt, items };
}

export function sanitizeClaudeMcpRuntimeError(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value
    .trim()
    .slice(0, 2_000)
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (rawUrl) => sanitizeStatusUrl(rawUrl))
    .replace(/(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;]+/gi, '$1<redacted>')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1<redacted>');
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

function isMcpConnectionState(value: unknown): value is ClaudeMcpConnectionState {
  return value === 'connected'
    || value === 'failed'
    || value === 'needs-auth'
    || value === 'pending'
    || value === 'disabled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStatusUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    if (url.search) url.search = '?redacted';
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}
