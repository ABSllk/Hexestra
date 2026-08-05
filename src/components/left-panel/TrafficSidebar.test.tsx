import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROXY_PROFILE,
  TRAFFIC_IPC,
  type TrafficProfileState,
} from '@electron/contracts/traffic';
import { DIALOG_IPC } from '@electron/contracts/dialog';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (value: unknown) => void>(),
}));

vi.mock('@/stores', async () => {
  const actual = await vi.importActual<typeof import('@/stores')>('@/stores');
  return {
    ...actual,
    useSessionStore: (selector: (state: unknown) => unknown) => selector({ currentSession: { id: 'project-1' } }),
  };
});

import { useTabStore } from '@/stores';
import { ConfirmDialogProvider } from '@/components/shared';
import { TrafficSidebar } from './TrafficSidebar';

const profile: TrafficProfileState = {
  profile: DEFAULT_PROXY_PROFILE,
  runtime: 'stopped',
  burpStatus: { proxyReachable: false, mcpReachable: false, edition: 'unknown', tools: [] },
  mirrorStatus: { state: 'disabled', pending: 0, synced: 0, failed: 0, capabilities: [] },
};

const enabledProfile: TrafficProfileState = {
  ...profile,
  profile: { ...DEFAULT_PROXY_PROFILE, enabled: true },
  runtime: 'ready',
};

const renderSidebar = () => render(<ConfirmDialogProvider><TrafficSidebar /></ConfirmDialogProvider>);

describe('TrafficSidebar', () => {
  beforeEach(() => {
    useTabStore.getState().resetProject();
    mocks.invoke.mockReset();
    mocks.listeners.clear();
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === DIALOG_IPC.CONFIRM) return true;
      if (channel === TRAFFIC_IPC.GET_PROFILE || channel === TRAFFIC_IPC.START) return profile;
      if (channel === TRAFFIC_IPC.LIST) return {
        items: [{
          id: 'flow-1', revision: 1, state: 'completed', scopeState: 'in_scope', source: 'browser',
          method: 'GET', url: 'https://example.test/api', host: 'example.test', statusCode: 200,
          requestBytes: 14, responseBytes: 15, startedAt: '2026-08-01T00:00:00.000Z', burpRouted: false,
        }],
        total: 1, offset: 0, limit: 100,
      };
      if (channel === TRAFFIC_IPC.CLEAR) return {
        deleted: 1, retainedActive: 2, retainedRepeaterSources: 0, droppedIntercepted: 1,
      };
      if (channel === TRAFFIC_IPC.DELETE) return {
        flowId: 'flow-1', deleted: true, droppedIntercepted: false, clearedReplaySessionIds: ['replay-source'],
      };
      return undefined;
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: {
        invoke: mocks.invoke,
        on: vi.fn((channel: string, callback: (value: unknown) => void) => {
          mocks.listeners.set(channel, callback);
          return () => mocks.listeners.delete(channel);
        }),
        once: vi.fn(), send: vi.fn(),
      },
    });
  });

  it('loads summaries in the sidebar and opens a central detail tab on click', async () => {
    renderSidebar();

    const flowButton = await screen.findByRole('button', { name: 'Open GET https://example.test/api' });
    expect(mocks.invoke).not.toHaveBeenCalledWith(TRAFFIC_IPC.READ, expect.anything(), expect.anything());

    fireEvent.click(flowButton);

    expect(useTabStore.getState().activeTab()).toMatchObject({
      type: 'traffic',
      data: { flowId: 'flow-1' },
    });
  });

  it('starts capture from the compact sidebar toggle', async () => {
    renderSidebar();
    fireEvent.click(await screen.findByRole('button', { name: 'CAPTURE OFF' }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.START, 'project-1'));
  });

  it('stops capture when the enabled toggle is clicked', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === TRAFFIC_IPC.GET_PROFILE || channel === TRAFFIC_IPC.STOP) return enabledProfile;
      if (channel === TRAFFIC_IPC.LIST) return { items: [], total: 0, offset: 0, limit: 50 };
      return undefined;
    });
    renderSidebar();

    const toggle = await screen.findByRole('button', { name: 'CAPTURE ON' });
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.STOP, 'project-1'));
  });

  it('keeps interception switches unavailable while capture is off', async () => {
    renderSidebar();

    expect(await screen.findByRole('checkbox', { name: 'Request break' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Response break' })).toBeDisabled();
  });

  it('shows MCP degradation without treating Bridge mirroring as a capture failure', async () => {
    const proxyOnlyProfile: TrafficProfileState = {
      ...enabledProfile,
      profile: {
        ...enabledProfile.profile,
        burp: { ...enabledProfile.profile.burp, enabled: true, bridgeToken: 'x'.repeat(32) },
      },
      burpStatus: {
        proxyReachable: false,
        mcpReachable: false,
        edition: 'unknown',
        tools: [],
        error: 'Burp MCP SSE endpoint was not found',
      },
    };
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === TRAFFIC_IPC.GET_PROFILE) return proxyOnlyProfile;
      if (channel === TRAFFIC_IPC.LIST) return { items: [], total: 0, offset: 0, limit: 50 };
      return undefined;
    });

    renderSidebar();

    expect(await screen.findByText(/Burp MCP tools are unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CAPTURE ON' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByText(/Burp MCP tools are unavailable/)).not.toBeInTheDocument();

    act(() => mocks.listeners.get(TRAFFIC_IPC.CHANGED)?.({ projectId: 'project-1', profile: true }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.GET_PROFILE, 'project-1'));
    expect(screen.queryByText(/Burp MCP tools are unavailable/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CAPTURE ON' })).not.toBeDisabled();
  });

  it('shows non-blocking mirror failure state and opens centralized Burp settings', async () => {
    const mirrorProfile: TrafficProfileState = {
      ...enabledProfile,
      profile: {
        ...enabledProfile.profile,
        burp: { ...enabledProfile.profile.burp, enabled: true, bridgeToken: 'x'.repeat(32) },
      },
      burpStatus: {
        proxyReachable: false, mcpReachable: false, bridgeReachable: false,
        edition: 'unknown', tools: [],
      },
      mirrorStatus: {
        state: 'offline', pending: 0, synced: 3, failed: 1, capabilities: [], error: 'Bridge offline',
      },
    };
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === TRAFFIC_IPC.GET_PROFILE || channel === TRAFFIC_IPC.UPDATE_PROFILE) return mirrorProfile;
      if (channel === TRAFFIC_IPC.LIST) return {
        items: [{
          id: 'flow-mirror', revision: 2, state: 'completed', scopeState: 'in_scope', source: 'browser',
          method: 'GET', url: 'https://example.test/mirror', host: 'example.test', statusCode: 200,
          requestBytes: 12, responseBytes: 24, startedAt: '2026-08-03T00:00:00.000Z',
          burpRouted: false, burpMode: 'mirror', burpMirrorState: 'failed', burpMirrorError: 'Bridge offline',
        }],
        total: 1, offset: 0, limit: 50,
      };
      return undefined;
    });
    renderSidebar();

    expect(await screen.findByText(/Traffic capture is still active, but the Burp Bridge is offline/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CAPTURE ON' })).not.toBeDisabled();
    expect(await screen.findByText('SYNC FAILED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BURP SYNC' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Open Burp settings' }));
    expect(useTabStore.getState().activeTab()).toMatchObject({ type: 'settings', data: { settingsPage: 'burp' } });
    expect(screen.queryByLabelText('Burp Bridge pairing token')).not.toBeInTheDocument();
  });

  it('filters on the service and hides interception decisions for completed flows', async () => {
    renderSidebar();
    const flowButton = await screen.findByRole('button', { name: 'Open GET https://example.test/api' });
    fireEvent.contextMenu(flowButton, { clientX: 20, clientY: 30 });
    expect(screen.getByRole('menuitem', { name: 'Open in Hexestra Repeater' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Forward intercepted message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Drop intercepted message' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete local Flow record' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'paused' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.LIST, 'project-1', expect.objectContaining({
      states: ['request_paused', 'response_paused'],
      limit: 50,
    })));
  });

  it('confirms and deletes a terminal local Flow record', async () => {
    const replayTabId = useTabStore.getState().openTab({
      type: 'replay', title: 'Hexestra Repeater', icon: 'activity', closable: true,
      data: { replaySessionId: 'replay-source', sourceFlowId: 'flow-1' },
    });
    renderSidebar();
    const flowButton = await screen.findByRole('button', { name: 'Open GET https://example.test/api' });
    fireEvent.contextMenu(flowButton, { clientX: 20, clientY: 30 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete local Flow record' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(DIALOG_IPC.CONFIRM, expect.objectContaining({ title: 'Delete Traffic Flow?' })));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.DELETE, 'project-1', 'flow-1'));
    expect(useTabStore.getState().tabs.some((tab) => tab.id === replayTabId)).toBe(false);
  });

  it('allows a paused Flow to be dropped and deleted', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === DIALOG_IPC.CONFIRM) return true;
      if (channel === TRAFFIC_IPC.GET_PROFILE) return profile;
      if (channel === TRAFFIC_IPC.LIST) return {
        items: [{
          id: 'flow-paused', revision: 2, state: 'request_paused', scopeState: 'out_of_scope', source: 'browser',
          method: 'POST', url: 'https://example.test/paused', host: 'example.test',
          requestBytes: 0, startedAt: '2026-08-01T00:00:00.000Z', burpRouted: false,
        }],
        total: 1, offset: 0, limit: 50,
      };
      if (channel === TRAFFIC_IPC.DELETE) return {
        flowId: 'flow-paused', deleted: true, droppedIntercepted: true, clearedReplaySessionIds: [],
      };
      return undefined;
    });
    renderSidebar();
    const flowButton = await screen.findByRole('button', { name: 'Open POST https://example.test/paused' });
    fireEvent.contextMenu(flowButton, { clientX: 20, clientY: 30 });
    const deleteItem = screen.getByRole('menuitem', { name: 'Drop and delete intercepted Flow' });
    expect(deleteItem).not.toBeDisabled();
    fireEvent.click(deleteItem);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(DIALOG_IPC.CONFIRM, expect.objectContaining({ title: 'Drop and delete intercepted Flow?' })));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.DELETE, 'project-1', 'flow-paused'));
  });

  it('confirms and clears all local Traffic history', async () => {
    renderSidebar();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Traffic history' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(DIALOG_IPC.CONFIRM, expect.objectContaining({ title: 'Clear removable Traffic history?' })));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.CLEAR, 'project-1'));
    expect(await screen.findByText(/including 1 intercepted/)).toBeInTheDocument();
  });
});
