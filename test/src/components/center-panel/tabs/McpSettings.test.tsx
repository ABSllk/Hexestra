import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/stores';
import { McpSettings } from '@/components/center-panel/tabs/McpSettings';

describe('McpSettings', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    useSessionStore.setState({ currentSession: null });
    invoke.mockImplementation((channel: string) => {
      if (channel === 'claude:mcp:list') return Promise.resolve({
        runtimeLabel: 'Native',
        projectAvailable: false,
        errors: [],
        items: [
          { id: 'user:docs', name: 'docs', scope: 'user', definition: { type: 'http', url: 'https://example.com/mcp' }, effective: true, shadowedBy: null, sourcePath: 'C:/Users/test/.claude.json' },
          { id: 'user:broken', name: 'broken', scope: 'user', definition: { type: 'stdio', command: 'missing-mcp' }, effective: true, shadowedBy: null, sourcePath: 'C:/Users/test/.claude.json' },
        ],
      });
      if (channel === 'claude:mcp:status') return Promise.resolve({
        checkedAt: '2026-08-11T00:00:00.000Z',
        items: [
          { name: 'docs', status: 'connected', error: null, scope: 'user', toolCount: 4 },
          { name: 'broken', status: 'failed', error: 'Executable not found in $PATH: "missing-mcp"', scope: 'user', toolCount: 0 },
        ],
      });
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'hexestra', { configurable: true, value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() } });
  });

  it('lists static MCP definitions and validates JSON before IPC', async () => {
    render(<McpSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /docs/i }));
    expect((screen.getByLabelText('MCP JSON definition') as HTMLTextAreaElement).value).toContain('https://example.com/mcp');

    fireEvent.change(screen.getByLabelText('MCP JSON definition'), { target: { value: '{ bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Server' }));
    expect(await screen.findByText(/Invalid JSON/)).toBeInTheDocument();
    await waitFor(() => expect(invoke).not.toHaveBeenCalledWith('claude:mcp:save', expect.anything()));
  });

  it('shows live runtime health, tool counts, errors, and supports retry', async () => {
    render(<McpSettings />);

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('4 tools available')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/Executable not found/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check connections' }));
    await waitFor(() => expect(invoke.mock.calls.filter(([channel]) => channel === 'claude:mcp:status')).toHaveLength(2));
  });
});
