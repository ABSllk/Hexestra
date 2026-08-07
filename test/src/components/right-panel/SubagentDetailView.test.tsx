import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SubagentRun } from '@/types';
import { SubagentDetailView } from '@/components/right-panel/SubagentDetailView';

const run: SubagentRun = {
  id: 'run-detail',
  taskId: 'task-detail',
  agentType: 'Explore',
  description: 'Review the response headers',
  status: 'completed',
  startedAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:04.000Z',
  endedAt: '2026-08-06T00:00:04.000Z',
  usage: { totalTokens: 64, toolUses: 1, durationMs: 4_000 },
  activities: [
    { id: 'thinking', kind: 'thinking', status: 'complete', content: 'Check the cache headers.' },
    { id: 'tool', kind: 'tool', status: 'complete', toolName: 'Read', label: 'Read', output: 'cache-control: no-store' },
    { id: 'text', kind: 'text', status: 'complete', content: 'Headers reviewed.' },
  ],
  output: 'No issue found.',
};

describe('SubagentDetailView', () => {
  it('shows the complete child transcript and returns with Back or Escape', () => {
    const onBack = vi.fn();
    render(<SubagentDetailView run={run} onBack={onBack} />);

    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Headers reviewed.')).toBeInTheDocument();
    expect(screen.getByText('No issue found.')).toBeInTheDocument();
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Thinking').closest('details')).not.toHaveAttribute('open');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: /back to conversation/i }).click();
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});
