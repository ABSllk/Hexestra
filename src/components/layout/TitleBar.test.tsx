import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore, useTabStore } from '@/stores';
import { TitleBar } from './TitleBar';

describe('TitleBar', () => {
  const invoke = vi.fn(async (channel: string) => channel === 'app:window:is-maximized' ? false : undefined);

  beforeEach(() => {
    invoke.mockClear();
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(() => vi.fn()), once: vi.fn(), send: vi.fn() },
    });
    useSessionStore.setState({
      currentSession: { id: 'project-1', name: 'Example Project', createdAt: '', updatedAt: '', status: 'active', opsecLevel: 'balanced', autonomyLevel: 'medium', basePath: '', targetCount: 0, findingCount: 0, vulnerabilityCount: 0 },
      openProjectFolder: vi.fn(async () => null),
      createProjectFolder: vi.fn(async () => null),
    });
    useTabStore.setState({ tabs: [], activeTabId: null, nextTabNumber: 1 });
  });

  it('shows the project identity, compact File menu, and native window actions', () => {
    render(<TitleBar />);
    expect(screen.getByText('HEXESTRA')).toBeInTheDocument();
    expect(screen.getByText('Example Project')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(useTabStore.getState().activeTab()).toMatchObject({ type: 'settings' });
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('menuitem', { name: /Open Folder/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(invoke).toHaveBeenCalledWith('app:window:minimize');
  });
});
