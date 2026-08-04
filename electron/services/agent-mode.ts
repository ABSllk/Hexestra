import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

export const SUPPORTED_AGENT_MODES = [
  'default',
  'auto',
  'bypassPermissions',
] as const satisfies readonly PermissionMode[];

export type SupportedAgentMode = (typeof SUPPORTED_AGENT_MODES)[number];
export type PermissionDisposition = 'allow' | 'ask' | 'deny';

export function normalizeAgentMode(mode: unknown): SupportedAgentMode {
  return typeof mode === 'string' && (SUPPORTED_AGENT_MODES as readonly string[]).includes(mode)
    ? (mode as SupportedAgentMode)
    : 'default';
}

export function resolvePermissionDisposition(
  mode: SupportedAgentMode,
  readOnly: boolean,
  autonomyLevel: 'low' | 'medium' | 'high',
): PermissionDisposition {
  if (mode === 'bypassPermissions') return 'allow';
  if (readOnly && autonomyLevel !== 'low') return 'allow';
  return 'ask';
}
