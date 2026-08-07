import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_IPC, type BrowserState, type BrowserStateChangedEvent } from '@electron/contracts/browser';
import { DEFAULT_PROXY_PROFILE, TRAFFIC_IPC } from '@electron/contracts/traffic';

const mocks = vi.hoisted(() => ({
  updateTabData: vi.fn(),
  updateTabTitle: vi.fn(),
  invoke: vi.fn(),
  listeners: new Map<string, (value: unknown) => void>(),
  tabs: [] as Array<{ id: string; type: string; data?: Record<string, unknown> }>,
}));

const initialState: BrowserState = {
  url: 'https://in-scope.test/',
  title: 'In Scope',
  loading: false,
  canGoBack: false,
  canGoForward: true,
  visible: true,
  scopeState: 'in_scope',
  error: null,
};

vi.mock('@/stores', () => ({
  useTabStore: (selector: (state: unknown) => unknown) => selector({
    projectId: 'project-1',
    tabs: mocks.tabs,
    updateTabData: mocks.updateTabData,
    updateTabTitle: mocks.updateTabTitle,
  }),
}));

import { BrowserTab } from '@/components/center-panel/tabs/BrowserTab';

describe('BrowserTab integrated view proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.tabs = [
      { id: 'browser-1', type: 'browser', data: { url: 'https://in-scope.test/' } },
      { id: 'browser-2', type: 'browser', data: { url: 'https://linked-target.test/path' } },
    ];
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === TRAFFIC_IPC.GET_PROFILE) return {
        profile: { ...DEFAULT_PROXY_PROFILE, enabled: true },
        runtime: 'ready',
        burpStatus: { proxyReachable: false, mcpReachable: false, edition: 'unknown', tools: [] },
      };
      if (channel === BROWSER_IPC.ENSURE) return initialState;
      return initialState;
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: {
        invoke: mocks.invoke,
        on: vi.fn((channel: string, callback: (value: unknown) => void) => {
          mocks.listeners.set(channel, callback);
          return () => mocks.listeners.delete(channel);
        }),
        once: vi.fn(),
        send: vi.fn(),
      },
    });
  });

  it('creates a project/tab view and sends measured visibility through IPC', async () => {
    const { unmount } = render(<BrowserTab tabId="browser-1" />);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(BROWSER_IPC.ENSURE, {
      projectId: 'project-1',
      tabId: 'browser-1',
      url: 'https://in-scope.test/',
    }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      BROWSER_IPC.SET_LAYOUT,
      expect.objectContaining({ projectId: 'project-1', tabId: 'browser-1', visible: true }),
    ));

    unmount();
    expect(mocks.invoke).toHaveBeenCalledWith(
      BROWSER_IPC.SET_LAYOUT,
      expect.objectContaining({ projectId: 'project-1', tabId: 'browser-1', visible: false }),
    );
  });

  it('restores enabled capture before creating the integrated browser view', async () => {
    render(<BrowserTab tabId="browser-1" />);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(BROWSER_IPC.ENSURE, expect.anything()));
    expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.START, 'project-1');
    const startCall = mocks.invoke.mock.invocationCallOrder[
      mocks.invoke.mock.calls.findIndex(([channel]) => channel === TRAFFIC_IPC.START)
    ];
    const ensureCall = mocks.invoke.mock.invocationCallOrder[
      mocks.invoke.mock.calls.findIndex(([channel]) => channel === BROWSER_IPC.ENSURE)
    ];
    expect(startCall).toBeLessThan(ensureCall);
  });

  it('respects a persisted capture-off preference when creating the browser view', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === TRAFFIC_IPC.GET_PROFILE) return {
        profile: { ...DEFAULT_PROXY_PROFILE, enabled: false },
        runtime: 'stopped',
        burpStatus: { proxyReachable: false, mcpReachable: false, edition: 'unknown', tools: [] },
      };
      if (channel === BROWSER_IPC.ENSURE) return initialState;
      return initialState;
    });

    render(<BrowserTab tabId="browser-1" />);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.GET_PROFILE, 'project-1'));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(BROWSER_IPC.ENSURE, expect.anything()));
    expect(mocks.invoke).not.toHaveBeenCalledWith(TRAFFIC_IPC.START, 'project-1');
  });

  it('accepts only state events for its project and tab', async () => {
    render(<BrowserTab tabId="browser-1" />);
    await waitFor(() => expect(mocks.listeners.has(BROWSER_IPC.STATE_CHANGED)).toBe(true));

    const callback = mocks.listeners.get(BROWSER_IPC.STATE_CHANGED)!;
    act(() => callback({
      projectId: 'project-other',
      tabId: 'browser-1',
      state: { ...initialState, url: 'https://wrong.test/' },
    } satisfies BrowserStateChangedEvent));
    expect(screen.getByRole('textbox', { name: 'Browser address' })).toHaveValue('https://in-scope.test/');

    act(() => callback({
      projectId: 'project-1',
      tabId: 'browser-1',
      state: { ...initialState, url: 'https://next.in-scope.test/', title: 'Next' },
    } satisfies BrowserStateChangedEvent));
    expect(screen.getByRole('textbox', { name: 'Browser address' })).toHaveValue('https://next.in-scope.test/');
    expect(mocks.updateTabTitle).toHaveBeenCalledWith('browser-1', 'Next');
  });

  it('routes toolbar navigation through the main-process contract', async () => {
    render(<BrowserTab tabId="browser-1" />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(BROWSER_IPC.ENSURE, expect.anything()));

    fireEvent.change(screen.getByRole('textbox', { name: 'Browser address' }), {
      target: { value: 'https://manual-reference.test' },
    });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Browser address' }).closest('form')!);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(BROWSER_IPC.NAVIGATE, {
      projectId: 'project-1',
      tabId: 'browser-1',
      url: 'https://manual-reference.test',
    }));
  });

  it('uses the linked URL when React reuses the view for another browser tab', async () => {
    const { rerender } = render(<BrowserTab tabId="browser-1" />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(BROWSER_IPC.ENSURE, {
      projectId: 'project-1',
      tabId: 'browser-1',
      url: 'https://in-scope.test/',
    }));

    rerender(<BrowserTab tabId="browser-2" />);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(BROWSER_IPC.ENSURE, {
      projectId: 'project-1',
      tabId: 'browser-2',
      url: 'https://linked-target.test/path',
    }));
  });
});
