import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROXY_PROFILE, TRAFFIC_IPC, type ReplaySession, type TrafficFlow } from '@electron/contracts/traffic';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (value: unknown) => void>() }));
vi.mock('@/stores', async () => {
  const actual = await vi.importActual<typeof import('@/stores')>('@/stores');
  return { ...actual, useSessionStore: (selector: (state: unknown) => unknown) => selector({ currentSession: { id: 'project-1' } }) };
});

import { useTabStore } from '@/stores';
import { TrafficReplayTab } from './TrafficReplayTab';

const source: TrafficFlow = {
  id: 'flow-source', projectId: 'project-1', revision: 1, state: 'completed', scopeState: 'out_of_scope', source: 'browser',
  request: { method: 'POST', url: 'https://example.test/api', httpVersion: 'http/1.1', headers: [{ name: 'Host', value: 'example.test' }], body: { encoding: 'utf8', data: 'one', byteLength: 3 } },
  response: { statusCode: 200, httpVersion: 'http/1.1', headers: [], body: { encoding: 'utf8', data: 'source', byteLength: 6 } },
  timing: { startedAt: '2026-08-03T00:00:00.000Z', durationMs: 10 }, route: { burpEnabled: false, burpRouted: false },
};
const attempt: TrafficFlow = {
  ...source, id: 'flow-attempt', source: 'replay', parentFlowId: source.id,
  response: { ...source.response!, statusCode: 201, body: { encoding: 'utf8', data: 'created', byteLength: 7 } },
};

describe('TrafficReplayTab', () => {
  let replaySession: ReplaySession;
  beforeEach(() => {
    replaySession = {
      id: `replay-${'a'.repeat(32)}`, projectId: 'project-1', sourceFlowId: source.id,
      draft: structuredClone(source.request), draftText: 'POST https://example.test/api HTTP/1.1\r\nHost: example.test\r\n\r\none', attemptFlowIds: [], createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z',
    };
    useTabStore.setState({
      projectId: 'project-1', tabs: [{ id: 'replay-1', type: 'replay', title: 'Repeater', closable: true, data: { replaySessionId: replaySession.id } }],
      activeTabId: 'replay-1', nextTabNumber: 2,
    });
    mocks.invoke.mockReset();
    mocks.listeners.clear();
    mocks.invoke.mockImplementation(async (channel: string, _projectId: string, value?: unknown, patch?: { draft?: ReplaySession['draft']; draftText?: string; selectedAttemptFlowId?: string }) => {
      if (channel === TRAFFIC_IPC.REPLAY_SESSION_READ) return replaySession;
      if (channel === TRAFFIC_IPC.READ) return value === attempt.id ? attempt : source;
      if (channel === TRAFFIC_IPC.GET_PROFILE) return { profile: DEFAULT_PROXY_PROFILE, runtime: 'ready', burpStatus: { proxyReachable: false, mcpReachable: false, edition: 'unknown', tools: [] } };
      if (channel === TRAFFIC_IPC.REPLAY_SESSION_UPDATE) {
        replaySession = { ...replaySession, ...(patch?.draft ? { draft: patch.draft } : {}), ...(patch?.draftText === undefined ? {} : { draftText: patch.draftText }), ...(patch?.selectedAttemptFlowId ? { selectedAttemptFlowId: patch.selectedAttemptFlowId } : {}) };
        return replaySession;
      }
      if (channel === TRAFFIC_IPC.REPLAY) {
        replaySession = { ...replaySession, attemptFlowIds: [attempt.id], selectedAttemptFlowId: attempt.id };
        return { accepted: true, flowId: attempt.id, parentFlowId: source.id };
      }
      return undefined;
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke: mocks.invoke, on: vi.fn((channel: string, callback: (value: unknown) => void) => { mocks.listeners.set(channel, callback); return () => mocks.listeners.delete(channel); }), once: vi.fn(), send: vi.fn() },
    });
  });

  it('restores a persisted draft, sends an edited request and shows the captured attempt', async () => {
    render(<TrafficReplayTab tabId="replay-1" />);
    const editor = await screen.findByLabelText('Repeater request editor');
    expect((editor as HTMLTextAreaElement).value).toContain('one');
    fireEvent.change(editor, { target: { value: 'POST https://example.test/api HTTP/1.1\nHost: example.test\n\ntwo' } });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(TRAFFIC_IPC.REPLAY, 'project-1', expect.objectContaining({
      parentFlowId: source.id,
      replaySessionId: replaySession.id,
      message: expect.objectContaining({ body: { encoding: 'utf8', data: 'two' } }),
    })));
    expect(await screen.findByText(/#1/)).toBeInTheDocument();
    expect(screen.getByText(/created/)).toBeInTheDocument();
  });
});
