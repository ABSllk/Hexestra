import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore, useTabStore } from '@/stores';
import type { Session } from '@/types';
import { WelcomeTab } from './WelcomeTab';

const project: Session = {
  id: 'project-alpha',
  name: 'Alpha',
  basePath: 'D:\\projects\\alpha',
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  status: 'active',
  opsecLevel: 'balanced',
  autonomyLevel: 'medium',
  targetCount: 2,
  findingCount: 1,
  vulnerabilityCount: 0,
};

describe('WelcomeTab folder projects', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    window.localStorage.clear();
    useSessionStore.setState({
      sessions: [],
      currentSession: null,
      targets: [],
      assets: [],
      netmapEdges: [],
      files: [],
      scanRuns: [],
      assetChanges: [],
      findings: [],
      error: null,
      isLoading: false,
    });
    useTabStore.getState().resetProject();
    invoke.mockImplementation((channel: string) => {
      if (channel === 'project:list-recent') return Promise.resolve([project]);
      if (channel === 'project:open-folder') return Promise.resolve(project);
      if (channel === 'project:remove-recent') return Promise.resolve();
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() },
    });
  });

  it('opens a selected folder and makes it the active project', async () => {
    render(<WelcomeTab />);
    expect(await screen.findByText('Recent projects')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open Folder/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('project:open-folder'));
    expect(useSessionStore.getState().currentSession).toEqual(project);
    expect(window.localStorage.getItem('hexestra:last-project')).toBe(project.id);
  });

  it('removes only the recent reference through the project channel', async () => {
    render(<WelcomeTab />);
    const remove = await screen.findByRole('button', {
      name: 'Remove Alpha from recent projects',
    });

    fireEvent.click(remove);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project:remove-recent', project.id);
    });
    expect(useSessionStore.getState().sessions).toEqual([]);
  });
});
