import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore, useTabStore } from '@/stores';
import { SHELL_IPC } from '@electron/contracts/shell';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('monaco-editor', () => ({}));
vi.mock('@monaco-editor/react', () => ({
  loader: { config: vi.fn() },
  default: ({ language, value, onChange }: {
    language: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Source editor"
      data-language={language}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { EditorTab } from '@/components/center-panel/tabs/EditorTab';

describe('EditorTab', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke: mocks.invoke, on: vi.fn(() => () => {}) },
    });
    useSessionStore.setState({ currentSession: {
      id: 'project-1', name: 'Project', basePath: 'D:/project', status: 'active',
      createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
      opsecLevel: 'balanced', autonomyLevel: 'medium', targetCount: 0,
      findingCount: 0, vulnerabilityCount: 0,
    } });
    mocks.invoke.mockReset();
  });

  it('renders Markdown safely by default and preserves edits across view changes', async () => {
    mocks.invoke.mockResolvedValue({
      path: 'notes.md',
      content: '# Original\n\n- [x] Verified\n\n<script>window.bad = true</script>',
      modifiedAt: '2026-08-04T00:00:00.000Z',
    });
    useTabStore.setState({
      tabs: [{ id: 'editor-1', type: 'editor', title: 'notes.md', closable: true, data: { filePath: 'notes.md', sessionId: 'project-1' } }],
      activeTabId: 'editor-1', nextTabNumber: 2,
    });

    render(<EditorTab tabId="editor-1" />);

    expect(await screen.findByRole('heading', { name: 'Original' })).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByRole('button', { name: 'preview' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'source' }));
    const source = await screen.findByLabelText('Source editor');
    fireEvent.change(source, { target: { value: '# Changed\n\n`code`' } });
    expect(screen.getByText('Modified')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'preview' }));
    expect(screen.getByRole('heading', { name: 'Changed' })).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
  });

  it('passes the detected source language to Monaco', async () => {
    mocks.invoke.mockResolvedValue({ path: 'scripts/discovery.nse', content: 'return {}', modifiedAt: 'now' });
    useTabStore.setState({
      tabs: [{ id: 'editor-2', type: 'editor', title: 'discovery.nse', closable: true, data: { filePath: 'scripts/discovery.nse', sessionId: 'project-1' } }],
      activeTabId: 'editor-2', nextTabNumber: 3,
    });

    render(<EditorTab tabId="editor-2" />);
    await waitFor(() => expect(screen.getByLabelText('Source editor')).toHaveAttribute('data-language', 'lua'));
  });

  it('shows a remote revision conflict with reload and force-overwrite choices', async () => {
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === SHELL_IPC.SESSION_LIST) return Promise.resolve([{
        id: 'ssh-1', projectId: 'project-1', kind: 'ssh', title: 'SSH', state: 'ready', revision: 1,
        shellFlavor: 'posix', capabilities: { resize: true, interrupt: true, exitCode: true, agentExecute: true, fileAccess: 'sftp' },
        createdAt: 'now', lastActivityAt: 'now',
      }]);
      if (channel === SHELL_IPC.FILE_READ) return Promise.resolve({ path: '/tmp/notes.md', content: '# Remote', binary: false, size: 9, modifiedAt: 'now', revision: '1:1:old' });
      if (channel === SHELL_IPC.FILE_WRITE) return Promise.resolve({ status: 'conflict', currentRevision: '1:2:new', currentModifiedAt: 'later' });
      return Promise.resolve(undefined);
    });
    useTabStore.setState({
      tabs: [{ id: 'remote-editor', type: 'editor', title: 'notes.md', closable: true, transient: true, data: { fileSource: 'remote', projectId: 'project-1', shellSessionId: 'ssh-1', filePath: '/tmp/notes.md', contentPreview: '# Remote', remoteRevision: '1:1:old' } }],
      activeTabId: 'remote-editor', nextTabNumber: 2,
    });

    render(<EditorTab tabId="remote-editor" />);
    fireEvent.click(await screen.findByRole('button', { name: 'source' }));
    const source = await screen.findByLabelText('Source editor');
    fireEvent.change(source, { target: { value: '# Local edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }));

    expect(await screen.findByText(/remote file changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Force overwrite' })).toBeInTheDocument();
  });

  it('preserves a remote buffer and disables save when the SSH session is disconnected', async () => {
    mocks.invoke.mockImplementation((channel: string) => channel === SHELL_IPC.SESSION_LIST
      ? Promise.resolve([{
        id: 'ssh-1', projectId: 'project-1', kind: 'ssh', title: 'SSH', state: 'disconnected', revision: 2,
        shellFlavor: 'posix', capabilities: { resize: true, interrupt: true, exitCode: true, agentExecute: true, fileAccess: 'sftp' },
        createdAt: 'now', lastActivityAt: 'now',
      }])
      : Promise.resolve(undefined));
    useTabStore.setState({
      tabs: [{ id: 'remote-disconnected', type: 'editor', title: 'notes.txt', closable: true, transient: true, data: { fileSource: 'remote', projectId: 'project-1', shellSessionId: 'ssh-1', filePath: '/tmp/notes.txt', contentPreview: 'unsaved buffer', remoteRevision: '1:1:old' } }],
      activeTabId: 'remote-disconnected', nextTabNumber: 2,
    });

    render(<EditorTab tabId="remote-disconnected" />);
    expect(await screen.findByDisplayValue('unsaved buffer')).toBeInTheDocument();
    expect(await screen.findByText(/ssh session disconnected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save file' })).toBeDisabled();
  });
});
