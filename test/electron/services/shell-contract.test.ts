import { describe, expect, it } from 'vitest';
import {
  assertSessionTransition,
  isWildcardAddress,
  normalizeCommandTimeout,
  normalizeListener,
  normalizeReadLimits,
  normalizeShellProjectState,
} from '@electron/services/shell-contract';
import { isLoopbackShellPeer } from '@electron/contracts/shell';

describe('shell contract', () => {
  it('normalizes profiles and rejects invalid SSH or wildcard listeners', () => {
    const state = normalizeShellProjectState({
      profiles: [
        {
          id: 'profile-local', name: 'Local', kind: 'local', assetRole: 'target',
          shellFlavor: 'powershell', createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z',
        },
        { id: 'bad-ssh', name: 'Bad', kind: 'ssh', host: '', username: '', port: 22 },
      ],
      listeners: [
        { id: 'listener-good', name: 'Loopback', bindAddress: '127.0.0.1', port: 4444, shellFlavor: 'raw' },
        { id: 'listener-bad', name: 'Wildcard', bindAddress: '0.0.0.0', port: 4444, shellFlavor: 'raw' },
      ],
    });

    expect(state.profiles.map((item) => item.id)).toEqual(['profile-local']);
    expect(state.listeners.map((item) => item.id)).toEqual(['listener-good']);
    expect(normalizeListener({ id: 'wild', bindAddress: '::', port: 1 })).toEqual([]);
    expect(isWildcardAddress('[::]')).toBe(true);
  });

  it('owns the session transition table and revision-related bounds', () => {
    expect(() => assertSessionTransition('ready', 'agent_locked')).not.toThrow();
    expect(() => assertSessionTransition('quarantined', 'agent_locked')).toThrow(/Invalid shell session transition/);
    expect(() => assertSessionTransition('closed', 'ready')).toThrow(/Invalid shell session transition/);
    expect(normalizeCommandTimeout(undefined)).toBe(300_000);
    expect(normalizeCommandTimeout(999)).toBe(1_000);
    expect(normalizeCommandTimeout(9_999_999)).toBe(1_800_000);
    expect(normalizeReadLimits(9_000, 9_000_000)).toEqual({ lines: 2_000, bytes: 262_144 });
  });

  it('recognizes only IPv4 and IPv6 loopback reverse peers', () => {
    expect(isLoopbackShellPeer('127.0.0.1')).toBe(true);
    expect(isLoopbackShellPeer('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackShellPeer('::1')).toBe(true);
    expect(isLoopbackShellPeer('192.168.1.104')).toBe(false);
    expect(isLoopbackShellPeer('172.16.3.101')).toBe(false);
  });
});
