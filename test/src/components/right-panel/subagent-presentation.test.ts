import { describe, expect, it } from 'vitest';
import { formatSubagentDuration, subagentStatusText, subagentTitle } from '@/components/right-panel/subagent-presentation';
import type { SubagentRun } from '@/types';

function run(overrides: Partial<SubagentRun> = {}): SubagentRun {
  return {
    id: 'run-1',
    taskId: 'task-1',
    description: 'Inspect response headers',
    agentType: 'Explore',
    status: 'running',
    startedAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:01.000Z',
    activities: [],
    ...overrides,
  };
}

describe('subagent presentation', () => {
  it('uses description as title and latest progress as status context', () => {
    expect(subagentTitle(run())).toBe('Inspect response headers');
    expect(subagentStatusText(run({ summary: 'Found a redirect' }))).toBe('Found a redirect');
    expect(subagentStatusText(run({ summary: undefined, lastToolName: 'Read' }))).toBe('Read');
  });

  it('updates live duration from the supplied clock and fixes terminal duration', () => {
    expect(formatSubagentDuration(run(), Date.parse('2026-08-17T00:00:04.000Z'))).toBe('4s');
    expect(formatSubagentDuration(run({ status: 'completed', endedAt: '2026-08-17T00:00:09.000Z' }), Date.parse('2026-08-17T00:10:00.000Z'))).toBe('9s');
    expect(formatSubagentDuration(run({ status: 'completed', endedAt: '2026-08-17T00:00:09.000Z', usage: { durationMs: 12_000 } }), Date.parse('2026-08-17T00:10:00.000Z'))).toBe('12s');
  });
});
