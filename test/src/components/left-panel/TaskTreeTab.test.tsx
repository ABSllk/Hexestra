import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePentestTreeStore, useSessionStore } from '@/stores';
import type { PentestTask } from '@/types';
import { TaskTreeTab } from '@/components/left-panel/TaskTreeTab';

const task: PentestTask = {
  id: 'task-1',
  kind: 'objective',
  title: 'Enumerate services',
  description: 'Identify exposed services',
  status: 'in_progress',
  primaryTacticId: 'TA0043',
  tacticIds: ['TA0043'],
  techniqueIds: ['T1595.001'],
  targetAssetIds: ['host-1'],
  requiredCapabilities: [],
  preferredToolIds: [],
  preferredSkillIds: [],
  dependsOnTaskIds: [],
  successCriteria: [{ id: 'criteria-1', text: 'Record services', completed: false }],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

describe('TaskTreeTab', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(null);
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() },
    });
    useSessionStore.setState({
      currentSession: { id: 'project-1', name: 'Project' } as never,
    });
    usePentestTreeStore.setState({
      tasks: [task],
      expandedTactics: ['TA0043'],
      expandedTaskIds: [],
      selectedTaskId: null,
      isLoading: false,
    });
  });

  it('renders stable derived task groups without an external-store render loop', () => {
    render(<TaskTreeTab />);

    expect(screen.getByRole('tree', { name: 'ATT&CK task tree' })).toBeInTheDocument();
    expect(screen.getByText('Enumerate services')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('selects tasks and collapses tactic groups', () => {
    render(<TaskTreeTab />);

    fireEvent.click(screen.getByText('Enumerate services'));
    expect(usePentestTreeStore.getState().selectedTaskId).toBe('task-1');

    fireEvent.click(screen.getByText('Reconnaissance'));
    expect(screen.queryByText('Enumerate services')).not.toBeInTheDocument();
  });

  it('renders nested steps as an expandable tree branch', () => {
    usePentestTreeStore.setState({
      tasks: [
        task,
        {
          ...task,
          id: 'task-1-1',
          kind: 'step',
          title: 'Probe HTTPS',
          parentId: task.id,
          order: 0,
          status: 'pending',
        },
      ],
      expandedTaskIds: ['task-1'],
    });
    render(<TaskTreeTab />);

    expect(screen.getByText('Probe HTTPS')).toBeInTheDocument();
  });

  it('expands an Agent Task trace across the task content column', async () => {
    invoke.mockResolvedValue({
      taskId: task.id,
      generatedAt: '2026-08-18T02:18:16.000Z',
      entries: [{
        id: 'event-1',
        source: 'agent',
        timestamp: '2026-08-18T02:18:16.000Z',
        status: 'complete',
        label: 'Agent activity',
        detail: 'Collected target context',
      }],
      criteria: [],
      stats: { agentActions: 1, subagentRuns: 0, branches: 0 },
    });
    render(<TaskTreeTab />);

    const trigger = screen.getByRole('button', {
      name: 'Show Agent Task run trace',
    });
    fireEvent.click(trigger);

    const panel = await screen.findByRole('region', { name: 'Run trace' });
    expect(panel.parentElement).toHaveClass('grid');
    expect(panel).toHaveClass('col-span-2', 'col-start-2', 'ml-0');
    expect(within(panel).getByText('Agent activity')).toBeInTheDocument();
    expect(within(panel).getByText('Collected target context')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('tasks:trace', 'project-1', task.id);
  });
});
