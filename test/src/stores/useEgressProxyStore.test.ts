import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EGRESS_PROXY_IPC, type EgressProxyStatusSnapshot } from '@electron/contracts/egress-proxy';
import { useEgressProxyStore } from '@/stores/useEgressProxyStore';

describe('useEgressProxyStore', () => {
  beforeEach(() => {
    useEgressProxyStore.setState({
      projectId: null,
      status: null,
      diagnostic: null,
      nodes: [],
      nodeTestResult: null,
      chains: [],
      busy: null,
      error: null,
    });
  });

  it('keeps a newer event when an older load response finishes later', async () => {
    let resolveStatus!: (value: EgressProxyStatusSnapshot) => void;
    const statusPromise = new Promise<EgressProxyStatusSnapshot>((resolve) => { resolveStatus = resolve; });
    const invoke = vi.fn((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.STATUS) return statusPromise;
      if (channel === EGRESS_PROXY_IPC.RUNTIME_DIAGNOSE) return Promise.resolve({
        configuredPath: null, exists: false, executable: false, version: null,
        supported: false, error: 'Select runtime', warning: null,
      });
      return Promise.resolve([]);
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() },
    });

    const loading = useEgressProxyStore.getState().load('project-race');
    useEgressProxyStore.getState().applyEvent(snapshot(4, 'ready'));
    resolveStatus(snapshot(3, 'starting'));
    await loading;

    expect(useEgressProxyStore.getState().status).toMatchObject({ revision: 4, state: 'ready' });
  });

  it('refreshes authoritative node latencies after testing a chain without relying on an event', async () => {
    const testedStatus = {
      ...snapshot(6, 'ready'),
      chainLatencyMs: 10614,
      latencyCheckedAt: '2026-08-10T02:30:00.000Z',
      nodeLatencyMs: { 'node-1': 82, 'node-2': 147 },
    };
    const invoke = vi.fn((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.CHAINS_TEST) {
        return Promise.resolve({ ok: true, latencyMs: 10614, error: null });
      }
      if (channel === EGRESS_PROXY_IPC.STATUS) return Promise.resolve(testedStatus);
      throw new Error(`Unexpected IPC channel: ${channel}`);
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() },
    });
    useEgressProxyStore.setState({ projectId: 'project-race', status: snapshot(5, 'ready') });

    const result = await useEgressProxyStore.getState().testChain('chain-1');

    expect(result).toEqual({ ok: true, latencyMs: 10614, error: null });
    expect(invoke).toHaveBeenNthCalledWith(1, EGRESS_PROXY_IPC.CHAINS_TEST, 'project-race', 'chain-1');
    expect(invoke).toHaveBeenNthCalledWith(2, EGRESS_PROXY_IPC.STATUS, 'project-race');
    expect(useEgressProxyStore.getState().status).toMatchObject({
      revision: 6,
      chainLatencyMs: 10614,
      nodeLatencyMs: { 'node-1': 82, 'node-2': 147 },
    });
  });

  it('keeps a newer event while the post-test status refresh is in flight', async () => {
    let resolveStatus!: (value: EgressProxyStatusSnapshot) => void;
    const statusPromise = new Promise<EgressProxyStatusSnapshot>((resolve) => { resolveStatus = resolve; });
    const invoke = vi.fn((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.CHAINS_TEST) {
        return Promise.resolve({ ok: true, latencyMs: 80, error: null });
      }
      if (channel === EGRESS_PROXY_IPC.STATUS) return statusPromise;
      throw new Error(`Unexpected IPC channel: ${channel}`);
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() },
    });
    useEgressProxyStore.setState({ projectId: 'project-race', status: snapshot(5, 'ready') });

    const testing = useEgressProxyStore.getState().testChain('chain-1');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    useEgressProxyStore.getState().applyEvent({
      ...snapshot(8, 'ready'),
      chainLatencyMs: 75,
      nodeLatencyMs: { 'node-1': 32, 'node-2': 43 },
    });
    resolveStatus({
      ...snapshot(7, 'ready'),
      chainLatencyMs: 80,
      nodeLatencyMs: { 'node-1': 35, 'node-2': 45 },
    });
    await testing;

    expect(useEgressProxyStore.getState().status).toMatchObject({
      revision: 8,
      chainLatencyMs: 75,
      nodeLatencyMs: { 'node-1': 32, 'node-2': 43 },
    });
  });

  it('stores standalone node probe results separately from active-chain latency', async () => {
    const nodeTestResult = {
      checkedAt: '2026-08-10T03:00:00.000Z',
      nodeLatencyMs: { 'node-1': 24, 'node-2': null },
    };
    const invoke = vi.fn((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.NODES_TEST) return Promise.resolve(nodeTestResult);
      throw new Error(`Unexpected IPC channel: ${channel}`);
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() },
    });
    const chainStatus = {
      ...snapshot(5, 'ready'),
      chainLatencyMs: 81,
      nodeLatencyMs: { 'node-1': 31, 'node-2': 81 },
    };
    useEgressProxyStore.setState({ projectId: 'project-race', status: chainStatus });

    await expect(useEgressProxyStore.getState().testNodes()).resolves.toEqual(nodeTestResult);

    expect(useEgressProxyStore.getState().nodeTestResult).toEqual(nodeTestResult);
    expect(useEgressProxyStore.getState().status).toEqual(chainStatus);
  });

  it('imports a URI batch then refreshes the sanitized node projection once', async () => {
    const imported = [
      { id: 'node-1', name: 'One', protocol: 'trojan', tcp: true, udp: false, updatedAt: '2026-08-11T00:00:00.000Z' },
      { id: 'node-2', name: 'Two', protocol: 'socks5', tcp: true, udp: true, updatedAt: '2026-08-11T00:00:00.000Z' },
    ];
    const invoke = vi.fn((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.NODES_IMPORT_BATCH) return Promise.resolve(imported);
      if (channel === EGRESS_PROXY_IPC.NODES_LIST) return Promise.resolve(imported);
      throw new Error(`Unexpected IPC channel: ${channel}`);
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(), once: vi.fn(), send: vi.fn() },
    });

    await expect(useEgressProxyStore.getState().importNodes('trojan://one\n\nsocks5://two')).resolves.toEqual(imported);

    expect(invoke).toHaveBeenNthCalledWith(1, EGRESS_PROXY_IPC.NODES_IMPORT_BATCH, 'trojan://one\n\nsocks5://two');
    expect(invoke).toHaveBeenNthCalledWith(2, EGRESS_PROXY_IPC.NODES_LIST);
    expect(useEgressProxyStore.getState()).toMatchObject({ nodes: imported, nodeTestResult: null, busy: null });
  });
});

function snapshot(revision: number, state: EgressProxyStatusSnapshot['state']): EgressProxyStatusSnapshot {
  return {
    projectId: 'project-race', revision, state, enabled: true,
    activeChainId: 'chain-1', activeChainName: 'Chain', mixedPort: state === 'ready' ? 41000 : null,
    tcpReady: state === 'ready', udpReady: false, exitIp: null, lastCheckedAt: null,
    error: null, chainLatencyMs: null, latencyCheckedAt: null, nodeLatencyMs: {},
  };
}
