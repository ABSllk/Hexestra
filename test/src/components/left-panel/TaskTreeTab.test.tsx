import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePentestTreeStore } from '@/stores';
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
  beforeEach(() => {
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
});
