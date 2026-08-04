import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore, useTabStore } from '@/stores';

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

import { EditorTab } from './EditorTab';

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
});
