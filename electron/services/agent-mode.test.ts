import { describe, expect, it } from 'vitest';
import {
  normalizeAgentMode,
  resolvePermissionDisposition,
  SUPPORTED_AGENT_MODES,
} from './agent-mode';

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

  it('lets the SDK classifier own AUTO while bypass allows all tools', () => {
    expect(resolvePermissionDisposition('default', true, 'medium')).toBe('allow');
    expect(resolvePermissionDisposition('default', false, 'medium')).toBe('ask');
    expect(resolvePermissionDisposition('auto', false, 'medium')).toBe('ask');
    expect(resolvePermissionDisposition('bypassPermissions', false, 'low')).toBe('allow');
  });
});
