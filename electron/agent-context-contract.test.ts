import { describe, expect, it } from 'vitest';
import { agentContextRefKey, normalizeAgentContextRefs } from './agent-context-contract';

describe('Shell command Agent context', () => {
  const ref = {
    kind: 'shell-command' as const,
    projectId: 'project-1',
    listenerId: 'listener-1',
    templateId: 'python3',
    templateLabel: 'Python 3 PTY',
    callbackAddress: '127.0.0.1',
    callbackPort: 4444,
    command: 'x'.repeat(10_000),
    localOnly: true as const,
  };

  it('normalizes, bounds, and keys local generated-command context', () => {
    const [normalized] = normalizeAgentContextRefs([ref], 'project-1');
    expect(normalized).toMatchObject({
      kind: 'shell-command', listenerId: 'listener-1', callbackAddress: '127.0.0.1',
      callbackPort: 4444, localOnly: true,
    });
    expect(normalized.kind === 'shell-command' ? normalized.command : '').toHaveLength(8_192);
    expect(agentContextRefKey(normalized)).toBe('shell-command:project-1:listener-1:python3:127.0.0.1:4444');
  });

  it('accepts non-loopback addresses and remote-marked context', () => {
    const remote = { ...ref, callbackAddress: '192.168.1.10', localOnly: false, obfuscation: 'base64' };
    const [normalized] = normalizeAgentContextRefs([remote], 'project-1');
    expect(normalized).toMatchObject({
      kind: 'shell-command', listenerId: 'listener-1', callbackAddress: '192.168.1.10',
      callbackPort: 4444, localOnly: false, obfuscation: 'base64',
    });
    expect(agentContextRefKey(normalized)).toBe('shell-command:project-1:listener-1:python3:192.168.1.10:4444');
  });

  it('rejects cross-project, malformed, and invalid context', () => {
    expect(normalizeAgentContextRefs([ref], 'project-2')).toEqual([]);
    expect(normalizeAgentContextRefs([{ ...ref, localOnly: 'yes' }], 'project-1')).toEqual([]);
    expect(normalizeAgentContextRefs([{ ...ref, callbackPort: 0 }], 'project-1')).toEqual([]);
    expect(normalizeAgentContextRefs([{ ...ref, callbackAddress: 'not-an-ip' }], 'project-1')).toEqual([]);
  });
});
