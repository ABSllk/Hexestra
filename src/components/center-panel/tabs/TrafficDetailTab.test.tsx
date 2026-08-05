import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROXY_PROFILE,
  TRAFFIC_IPC,
  type TrafficFlow,
  type TrafficProfileState,
} from '@electron/contracts/traffic';

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
import { TrafficDetailTab } from './TrafficDetailTab';

const profile: TrafficProfileState = {
  profile: DEFAULT_PROXY_PROFILE,
  runtime: 'ready',
  burpStatus: { proxyReachable: false, mcpReachable: false, edition: 'unknown', tools: [] },
  mirrorStatus: { state: 'disabled', pending: 0, synced: 0, failed: 0, capabilities: [] },
};

const flow: TrafficFlow = {
  id: 'flow-1', projectId: 'project-1', revision: 1, state: 'completed', scopeState: 'in_scope', source: 'browser',
  request: {
    method: 'GET', url: 'https://example.test/api', httpVersion: 'http/1.1', headers: [],
    body: { encoding: 'utf8', data: 'request-secret', byteLength: 14 },
  },
  response: {
    statusCode: 200, reason: 'OK', httpVersion: 'http/1.1', headers: [],
    body: { encoding: 'utf8', data: 'response-secret', byteLength: 15 },
  },
  timing: { startedAt: '2026-08-01T00:00:00.000Z' }, route: { burpEnabled: false, burpRouted: false },
};

describe('TrafficDetailTab', () => {
  beforeEach(() => {
    useTabStore.setState({
      projectId: 'project-1',
      tabs: [{ id: 'traffic-1', type: 'traffic', title: 'GET example.test/api', closable: true, data: { flowId: 'flow-1' } }],
      activeTabId: 'traffic-1',
      nextTabNumber: 2,
    });
    mocks.invoke.mockReset();
    mocks.listeners.clear();
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === TRAFFIC_IPC.GET_PROFILE) return profile;
      if (channel === TRAFFIC_IPC.READ) return flow;
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

  it('loads the selected flow body only inside its detail tab', async () => {
    render(<TrafficDetailTab tabId="traffic-1" />);

    expect(await screen.findByDisplayValue(/request-secret/)).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.READ, 'project-1', 'flow-1');
    expect(screen.queryByRole('button', { name: 'FORWARD' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'DROP' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'RESPONSE' }));
    expect(await screen.findByDisplayValue(/response-secret/)).toBeInTheDocument();
  });

  it('drops a paused flow without parsing an edited message', async () => {
    const pausedFlow = { ...flow, state: 'request_paused' as const };
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === TRAFFIC_IPC.GET_PROFILE) return profile;
      if (channel === TRAFFIC_IPC.READ) return pausedFlow;
      return undefined;
    });
    render(<TrafficDetailTab tabId="traffic-1" />);
    const editor = await screen.findByLabelText('Traffic message editor');
    expect(screen.getByRole('button', { name: 'FORWARD' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DROP' })).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: 'not a valid HTTP message' } });
    fireEvent.click(screen.getByRole('button', { name: 'DROP' }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      TRAFFIC_IPC.DECIDE,
      'project-1',
      { flowId: 'flow-1', expectedRevision: 1, action: 'drop' },
    ));
  });

  it('keeps human actions available for out-of-scope traffic', async () => {
    const outOfScopeFlow = { ...flow, scopeState: 'out_of_scope' as const };
    const capableProfile = {
      ...profile,
      burpStatus: {
        ...profile.burpStatus,
        tools: ['create_repeater_tab', 'send_to_intruder'],
      },
    };
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === TRAFFIC_IPC.GET_PROFILE) return capableProfile;
      if (channel === TRAFFIC_IPC.READ) return outOfScopeFlow;
      return undefined;
    });

    render(<TrafficDetailTab tabId="traffic-1" />);

    expect(await screen.findByText('OUT OF SCOPE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HEXESTRA REPEATER' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'SAVE EVIDENCE' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'BURP REPEATER' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'BURP INTRUDER' })).toBeEnabled();
  });
});
