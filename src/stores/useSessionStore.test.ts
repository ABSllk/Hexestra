import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from './useSessionStore';

describe('useSessionStore Finding projection', () => {
  const invoke = vi.fn(async (channel: string): Promise<unknown> => {
    if (channel === 'asm:scan-runs' || channel === 'asm:changes' || channel === 'vulnerabilities:list' || channel === 'evidence:list' || channel === 'reports:list') return [];
    if (channel === 'findings:list') {
      return [{
        id: 'finding-1',
        assetId: 'host-1',
        title: 'Open redirect',
        kind: 'lead',
        confidence: 'medium',
        status: 'active',
        description: '',
        evidenceIds: [],
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
      }];
    }
    return undefined;
  });

  beforeEach(() => {
    invoke.mockClear();
    window.localStorage.clear();
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() },
    });
    useSessionStore.setState({
      sessions: [{
        id: 'project-a',
        name: 'Project A',
        basePath: 'D:\\project-a',
        status: 'active',
        updatedAt: '2026-07-31T00:00:00.000Z',
        targetCount: 1,
        findingCount: 0,
        vulnerabilityCount: 0,
      }],
      currentSession: {
        id: 'project-a',
        name: 'Project A',
        status: 'active',
        opsecLevel: 'balanced',
        autonomyLevel: 'medium',
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
        basePath: 'D:\\project-a',
        targetCount: 1,
        findingCount: 0,
        vulnerabilityCount: 0,
      },
      findings: [],
    });
  });

  it('derives active Finding counts from the refreshed SQLite projection', async () => {
    await useSessionStore.getState().loadAsm('project-a');
    expect(useSessionStore.getState().findings).toHaveLength(1);
    expect(useSessionStore.getState().currentSession?.findingCount).toBe(1);
    expect(useSessionStore.getState().sessions[0].findingCount).toBe(1);
  });

  it('refreshes target and NetMap scope projections immediately after a scope update', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'scope:update') {
        return {
          ...useSessionStore.getState().currentSession,
          scope: { inScope: ['example.net'], outOfScope: [], targets: [] },
        };
      }
      if (channel === 'targets:list') return [{ id: 'host-1', status: 'out_of_scope' }];
      if (channel === 'netmap:get') {
        return { version: 3, assets: [{ id: 'asset-1', status: 'scanned' }], edges: [] };
      }
      return [];
    });

    await useSessionStore.getState().updateScope({
      inScope: ['example.net'], outOfScope: [], targets: [],
    });

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(expect.arrayContaining([
      'scope:update', 'targets:list', 'netmap:get',
    ]));
    expect(useSessionStore.getState().targets[0]).toMatchObject({ status: 'out_of_scope' });
    expect(useSessionStore.getState().assets[0]).toMatchObject({ status: 'scanned' });
  });

  it('migrates the legacy last-project key while restoring the active project', async () => {
    const session = useSessionStore.getState().currentSession!;
    useSessionStore.setState({ currentSession: null, sessions: [] });
    window.localStorage.setItem('pengent:last-project', session.id);
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-recent') return [session];
      if (channel === 'project:open-recent') return session;
      return [];
    });

    await useSessionStore.getState().loadSessionList();

    expect(useSessionStore.getState().currentSession?.id).toBe(session.id);
    expect(window.localStorage.getItem('hexestra:last-project')).toBe(session.id);
    expect(window.localStorage.getItem('pengent:last-project')).toBeNull();
  });
});
