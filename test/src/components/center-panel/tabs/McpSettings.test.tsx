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
});
