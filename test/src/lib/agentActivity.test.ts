import { describe, expect, it } from 'vitest';
import type { AgentActivity } from '@/types';
import { reconcileAgentActivities } from '@/lib/agentActivity';

describe('reconcileAgentActivities', () => {
  it('reuses unchanged completed activities while replacing the growing tail', () => {
    const previous: AgentActivity[] = [
      {
        id: 'tool-1',
        kind: 'tool',
        status: 'complete',
        input: { command: 'pwd', options: { timeout: 300_000 } },
        output: '/workspace',
      },
      { id: 'text-1', kind: 'text', status: 'streaming', content: 'Working' },
    ];
    const incoming: AgentActivity[] = [
      {
        id: 'tool-1',
        kind: 'tool',
        status: 'complete',
        input: { command: 'pwd', options: { timeout: 300_000 } },
        output: '/workspace',
      },
      { id: 'text-1', kind: 'text', status: 'streaming', content: 'Working now' },
    ];

    const result = reconcileAgentActivities(previous, incoming)!;
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(incoming[1]);
  });

  it('reuses the complete array when an IPC snapshot is semantically identical', () => {
    const previous: AgentActivity[] = [{
      id: 'tool-1', kind: 'tool', status: 'complete', input: { paths: ['a', 'b'] },
    }];
    expect(reconcileAgentActivities(previous, [{
      id: 'tool-1', kind: 'tool', status: 'complete', input: { paths: ['a', 'b'] },
    }])).toBe(previous);
  });
});
