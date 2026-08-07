import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROXY_PROFILE, TRAFFIC_IPC, type TrafficProfileState } from '@electron/contracts/traffic';

vi.mock('@/stores', async () => {
  const actual = await vi.importActual<typeof import('@/stores')>('@/stores');
  return {
    ...actual,
    useSessionStore: (selector: (state: unknown) => unknown) => selector({ currentSession: { id: 'project-1' } }),
  };
});

import { BurpSettings } from '@/components/center-panel/tabs/BurpSettings';

const profileState: TrafficProfileState = {
  profile: DEFAULT_PROXY_PROFILE,
  runtime: 'ready',
  burpStatus: { proxyReachable: false, mcpReachable: false, bridgeReachable: false, edition: 'unknown', tools: [] },
  mirrorStatus: { state: 'disabled', pending: 0, synced: 0, failed: 0, capabilities: [] },
};

describe('BurpSettings', () => {
  const invoke = vi.fn();
  const listeners = new Map<string, (value: unknown) => void>();

  beforeEach(() => {
    invoke.mockReset();
    listeners.clear();
    invoke.mockImplementation(async (channel: string) => {
      if (channel === TRAFFIC_IPC.GET_PROFILE || channel === TRAFFIC_IPC.UPDATE_PROFILE) return profileState;
      return undefined;
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((channel: string, callback: (value: unknown) => void) => {
          listeners.set(channel, callback);
          return () => listeners.delete(channel);
        }),
        once: vi.fn(),
        send: vi.fn(),
      },
    });
  });

  it('edits project Bridge settings without exposing a legacy proxy mode', async () => {
    render(<BurpSettings />);
    expect(await screen.findByText('Burp Integration')).toBeInTheDocument();
    expect(screen.getByText(/Target → Site map/)).toBeInTheDocument();
    expect(screen.queryByText(/Proxy chain through Burp/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Burp Bridge port'), { target: { value: '9988' } });
    fireEvent.change(screen.getByLabelText('Burp Bridge pairing token'), { target: { value: 'x'.repeat(32) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      TRAFFIC_IPC.UPDATE_PROFILE,
      'project-1',
      expect.objectContaining({ burp: expect.objectContaining({ bridgePort: 9988, bridgeToken: 'x'.repeat(32) }) }),
    ));
  });
});
