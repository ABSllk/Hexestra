import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  copySelection: vi.fn(async () => true),
  pasteFromClipboard: vi.fn(async () => true),
  selectAll: vi.fn(() => true),
  selectionHandler: null as ((selected: boolean) => void) | null,
  updateTabData: vi.fn(),
  tabs: [] as Array<{ id: string; data?: Record<string, unknown> }>,
  invoke: vi.fn(),
  on: vi.fn(() => vi.fn()),
}));

vi.mock('@/hooks/useTerminal', () => ({
  useTerminal: (_ref: unknown, options: { onSelectionChange?: (selected: boolean) => void }) => {
    mocks.selectionHandler = options.onSelectionChange ?? null;
    return {
      scrollPages: vi.fn(),
      scrollToTop: vi.fn(),
      scrollToBottom: vi.fn(),
      clear: vi.fn(),
      hasSelection: vi.fn(() => false),
      copySelection: mocks.copySelection,
      pasteFromClipboard: mocks.pasteFromClipboard,
      selectAll: mocks.selectAll,
      takeover: vi.fn(async () => true),
      disconnect: vi.fn(async () => true),
    };
  },
}));

vi.mock('@/stores', () => ({
  useTabStore: (selector: (state: unknown) => unknown) => selector({
    updateTabData: mocks.updateTabData,
    tabs: mocks.tabs,
  }),
  useSessionStore: (selector: (state: unknown) => unknown) => selector({ currentSession: { id: 'session-1' } }),
  useNetMapStore: (selector: (state: unknown) => unknown) => selector({ selectedNodeId: null }),
}));

import { TerminalTab } from '@/components/center-panel/tabs/TerminalTab';

describe('TerminalTab clipboard controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectionHandler = null;
    mocks.tabs = [];
    mocks.invoke.mockResolvedValue([]);
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke: mocks.invoke, on: mocks.on, once: vi.fn(), send: vi.fn() },
    });
  });

  it('offers copy, paste, and select-all through the terminal context menu', async () => {
    const { container } = render(<TerminalTab tabId="terminal-1" />);
    act(() => mocks.selectionHandler?.(true));

    fireEvent.contextMenu(container.querySelector('.terminal-shell')!, { clientX: 80, clientY: 80 });
    const menu = screen.getByRole('menu', { name: 'Terminal context menu' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Copy/ }));
    await waitFor(() => expect(mocks.copySelection).toHaveBeenCalled());

    fireEvent.contextMenu(container.querySelector('.terminal-shell')!, { clientX: 80, clientY: 80 });
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Select all' }));
    expect(mocks.selectAll).toHaveBeenCalled();

    fireEvent.contextMenu(container.querySelector('.terminal-shell')!, { clientX: 80, clientY: 80 });
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Paste/ }));
    await waitFor(() => expect(mocks.pasteFromClipboard).toHaveBeenCalled());
  });

  it('keeps terminal actions out of a permanent toolbar', () => {
    render(<TerminalTab tabId="terminal-1" />);
    expect(screen.queryByRole('button', { name: 'Copy selection (Ctrl+Shift+C)' })).not.toBeInTheDocument();
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });

  it('offers reconnect when a persisted managed session is no longer live', async () => {
    mocks.tabs = [{
      id: 'terminal-1',
      data: { managedShell: true, shellProfileId: 'profile-1', shellSessionId: 'missing-session' },
    }];
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'shell:session:list') return [];
      if (channel === 'shell:session:connect') {
        return { id: 'session-new', profileId: 'profile-1', state: 'ready' };
      }
      return undefined;
    });

    render(<TerminalTab tabId="terminal-1" />);
    expect(await screen.findByText('This Shell is disconnected.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(mocks.updateTabData).toHaveBeenCalledWith(
      'terminal-1',
      { shellSessionId: 'session-new' },
    ));
  });

  it('distinguishes a disconnected live reverse session from an expired restored tab', async () => {
    mocks.tabs = [{
      id: 'terminal-1',
      data: { managedShell: true, shellSessionId: 'reverse-session' },
    }];
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'shell:session:list') {
        return [{ id: 'reverse-session', title: 'Reverse loopback', kind: 'reverse', state: 'failed' }];
      }
      return undefined;
    });

    const { unmount } = render(<TerminalTab tabId="terminal-1" />);
    expect(await screen.findByText('This reverse Shell is disconnected.')).toBeInTheDocument();
    expect(screen.queryByText(/expired when Hexestra closed/)).not.toBeInTheDocument();

    unmount();
    mocks.invoke.mockImplementation(async (channel: string) => channel === 'shell:session:list' ? [] : undefined);
    render(<TerminalTab tabId="terminal-1" />);
    expect(await screen.findByText('This reverse Shell session expired when Hexestra closed.')).toBeInTheDocument();
  });
});
