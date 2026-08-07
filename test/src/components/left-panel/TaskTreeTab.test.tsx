import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePentestTreeStore } from '@/stores';
import type { PentestTask } from '@/types';
import { TaskTreeTab } from '@/components/left-panel/TaskTreeTab';

const task: PentestTask = {
  id: 'task-1',
  stage: 'S1',
  title: 'Enumerate services',
  description: 'Identify exposed services',
  status: 'in_progress',
  toolIds: [],
  commands: [],
  findingIds: [],
};

describe('TaskTreeTab', () => {
  beforeEach(() => {
    usePentestTreeStore.setState({
      tasks: [task],
      expandedStages: ['S1'],
      expandedTaskIds: [],
      selectedTaskId: null,
      isLoading: false,
    });
  });

  it('renders stable derived task groups without an external-store render loop', () => {
    render(<TaskTreeTab />);

    expect(screen.getByText('Enumerate services')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('selects tasks and collapses stages', () => {
    render(<TaskTreeTab />);

    fireEvent.click(screen.getByText('Enumerate services'));
    expect(usePentestTreeStore.getState().selectedTaskId).toBe('task-1');

    fireEvent.click(screen.getByText('Passive Reconnaissance'));
    expect(screen.queryByText('Enumerate services')).not.toBeInTheDocument();
  });

  it('renders nested steps as an expandable tree branch', () => {
    usePentestTreeStore.setState({
      tasks: [
        task,
        { ...task, id: 'task-1-1', title: 'Probe HTTPS', parentId: task.id, status: 'pending' },
      ],
    });
    render(<TaskTreeTab />);

    expect(screen.queryByText('Probe HTTPS')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Enumerate services' }));
    expect(screen.getByText('Probe HTTPS')).toBeInTheDocument();
  });
});
