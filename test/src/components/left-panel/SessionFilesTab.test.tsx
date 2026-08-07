import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionFileEntry } from '@/types';

const mocks = vi.hoisted(() => ({
  session: { id: 'project-1', name: 'Project One' },
  rootFiles: [{ name: 'docs', path: 'docs', type: 'directory', size: 0, modifiedAt: 'now' }] as SessionFileEntry[],
  loadFiles: vi.fn(),
  openTab: vi.fn(),
  changeListener: undefined as ((payload: unknown) => void) | undefined,
}));

vi.mock('@/stores', () => ({
  useSessionStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({
      currentSession: mocks.session,
      files: mocks.rootFiles,
      loadFiles: mocks.loadFiles,
    }),
    { getState: () => ({ currentSession: mocks.session }) },
  ),
  useTabStore: (selector: (state: unknown) => unknown) => selector({ openTab: mocks.openTab }),
}));

import { SessionFilesTab } from '@/components/left-panel/SessionFilesTab';

describe('SessionFilesTab', () => {
  beforeEach(() => {
    mocks.changeListener = undefined;
    mocks.loadFiles.mockReset();
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: {
        invoke: vi.fn(),
        on: vi.fn((channel: string, listener: (payload: unknown) => void) => {
          if (channel === 'session:data-changed') mocks.changeListener = listener;
          return () => {};
        }),
      },
    });
  });

  it('refreshes the active nested directory without resetting its breadcrumb', async () => {
    mocks.loadFiles
      .mockResolvedValueOnce([{ name: 'old.md', path: 'docs/old.md', type: 'file', size: 10, modifiedAt: 'old' }])
      .mockResolvedValueOnce([{ name: 'new.md', path: 'docs/new.md', type: 'file', size: 20, modifiedAt: 'new' }]);

    render(<SessionFilesTab />);
    fireEvent.click(screen.getByRole('button', { name: 'docs' }));
    expect(await screen.findByText('old.md')).toBeInTheDocument();
    expect(screen.getByText('/docs')).toBeInTheDocument();

    mocks.changeListener?.({ sessionId: 'project-1', files: true });

    expect(await screen.findByText('new.md')).toBeInTheDocument();
    expect(screen.getByText('/docs')).toBeInTheDocument();
    expect(mocks.loadFiles).toHaveBeenLastCalledWith('docs');
    await waitFor(() => expect(screen.queryByText('old.md')).not.toBeInTheDocument());
  });

  it('resets the breadcrumb and root entries when the project changes', async () => {
    mocks.loadFiles.mockResolvedValue([
      { name: 'nested.md', path: 'docs/nested.md', type: 'file', size: 10, modifiedAt: 'now' },
    ]);
    const view = render(<SessionFilesTab />);
    fireEvent.click(screen.getByRole('button', { name: 'docs' }));
    expect(await screen.findByText('/docs')).toBeInTheDocument();

    mocks.session = { id: 'project-2', name: 'Project Two' };
    mocks.rootFiles = [
      { name: 'fresh.py', path: 'fresh.py', type: 'file', size: 30, modifiedAt: 'new' },
    ];
    view.rerender(<SessionFilesTab />);

    expect(screen.queryByText('/docs')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project Two' })).toBeInTheDocument();
    expect(screen.getByText('fresh.py')).toBeInTheDocument();
  });
});
