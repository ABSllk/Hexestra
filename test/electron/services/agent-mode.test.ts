import { describe, expect, it } from 'vitest';
import {
  normalizeAgentMode,
  resolvePermissionDisposition,
  SUPPORTED_AGENT_MODES,
} from '@electron/services/agent-mode';

describe('agent mode policy', () => {
  it('exposes the three Hexestra modes', () => {
    expect(SUPPORTED_AGENT_MODES).toEqual(['default', 'auto', 'bypassPermissions']);
  });

  it('accepts only current SDK modes and defaults invalid values', () => {
    expect(normalizeAgentMode('bypassPermissions')).toBe('bypassPermissions');
    expect(normalizeAgentMode('plan')).toBe('default');
    expect(normalizeAgentMode('dontAsk')).toBe('default');
    expect(normalizeAgentMode('delegate')).toBe('default');
    expect(normalizeAgentMode('unknown')).toBe('default');
  });

  it('keeps tool approval independent of autonomy while the SDK classifier owns AUTO', () => {
    expect(resolvePermissionDisposition('default', true)).toBe('allow');
    expect(resolvePermissionDisposition('default', false)).toBe('ask');
    expect(resolvePermissionDisposition('auto', true)).toBe('allow');
    expect(resolvePermissionDisposition('auto', false)).toBe('ask');
    expect(resolvePermissionDisposition('bypassPermissions', false)).toBe('allow');
  });
});
