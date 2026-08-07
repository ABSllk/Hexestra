import { describe, expect, it } from 'vitest';
import { AgentAdapterRegistry } from './registry';
import type { AgentAdapter } from '../../contracts/agent-runtime';

function adapter(id: string): AgentAdapter {
  return {
    id,
    capabilities: {
      branching: 'none',
      subagents: false,
      attachments: [],
      tools: false,
      interactiveQuestions: false,
    },
    initialize: async () => true,
    fingerprint: () => `${id}:test`,
    status: () => ({
      available: true,
      authenticated: true,
      model: null,
      lastError: null,
      runtimeMode: 'test',
      runtimeLabel: 'Test',
    }),
    runTurn: async function* () {},
  };
}

describe('AgentAdapterRegistry', () => {
  it('routes registered backends and reports unknown backends explicitly', () => {
    const registry = new AgentAdapterRegistry();
    const claude = adapter('claude');
    registry.register(claude);

    expect(registry.has('claude')).toBe(true);
    expect(registry.get('claude')).toBe(claude);
    expect(registry.list()).toEqual([claude]);
    expect(() => registry.require('codex')).toThrow('Agent backend is unavailable: codex');
  });

  it('rejects duplicate registrations', () => {
    const registry = new AgentAdapterRegistry();
    registry.register(adapter('claude'));
    expect(() => registry.register(adapter('claude'))).toThrow('already registered');
  });
});
