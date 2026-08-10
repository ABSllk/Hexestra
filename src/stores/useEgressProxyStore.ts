import { create } from 'zustand';
import {
  EGRESS_PROXY_IPC,
  type EgressProxyChain,
  type EgressProxyChainTestResult,
  type EgressProxyNodeInput,
  type EgressProxyNodeSummary,
  type EgressProxyNodeTestResult,
  type EgressProxyRuntimeDiagnostic,
  type EgressProxyStatusSnapshot,
} from '@electron/contracts/egress-proxy';

interface EgressProxyStore {
  projectId: string | null;
  status: EgressProxyStatusSnapshot | null;
  diagnostic: EgressProxyRuntimeDiagnostic | null;
  nodes: EgressProxyNodeSummary[];
  nodeTestResult: EgressProxyNodeTestResult | null;
  chains: EgressProxyChain[];
  busy: string | null;
  error: string | null;
  load: (projectId: string) => Promise<void>;
  diagnose: () => Promise<void>;
  chooseRuntime: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  refreshExit: () => Promise<void>;
  saveNode: (input: EgressProxyNodeInput, nodeId?: string) => Promise<void>;
  importNodes: (value: string) => Promise<EgressProxyNodeSummary[]>;
  deleteNode: (nodeId: string) => Promise<void>;
  testNodes: () => Promise<EgressProxyNodeTestResult>;
  saveChain: (chain: Partial<EgressProxyChain>) => Promise<EgressProxyChain>;
  deleteChain: (chainId: string) => Promise<void>;
  activateChain: (chainId: string) => Promise<void>;
  testChain: (chainId: string) => Promise<EgressProxyChainTestResult>;
  applyEvent: (value: unknown) => void;
  clearError: () => void;
}

export const useEgressProxyStore = create<EgressProxyStore>((set, get) => ({
  projectId: null, status: null, diagnostic: null, nodes: [], nodeTestResult: null, chains: [], busy: null, error: null,
  load: async (projectId) => {
    set({ projectId, status: null, chains: [], error: null });
    return run(set, 'load', async () => {
      const [status, diagnostic, nodes, chains] = await Promise.all([
        window.hexestra.invoke<EgressProxyStatusSnapshot>(EGRESS_PROXY_IPC.STATUS, projectId),
        window.hexestra.invoke<EgressProxyRuntimeDiagnostic>(EGRESS_PROXY_IPC.RUNTIME_DIAGNOSE),
        window.hexestra.invoke<EgressProxyNodeSummary[]>(EGRESS_PROXY_IPC.NODES_LIST),
        window.hexestra.invoke<EgressProxyChain[]>(EGRESS_PROXY_IPC.CHAINS_LIST, projectId),
      ]);
      const newestStatus = selectNewestStatus(get(), projectId, status);
      set({ projectId, status: newestStatus, diagnostic, nodes, chains });
    });
  },
  diagnose: async () => run(set, 'diagnose', async () => set({ diagnostic: await window.hexestra.invoke(EGRESS_PROXY_IPC.RUNTIME_DIAGNOSE) })),
  chooseRuntime: async () => run(set, 'choose', async () => {
    const diagnostic = await window.hexestra.invoke<EgressProxyRuntimeDiagnostic | null>(EGRESS_PROXY_IPC.RUNTIME_CHOOSE);
    if (diagnostic) set({ diagnostic });
  }),
  setEnabled: async (enabled) => withProject(get, set, 'enforcement', async (projectId) => set({ status: await window.hexestra.invoke(EGRESS_PROXY_IPC.ENFORCEMENT_SET, projectId, enabled) })),
  start: async () => withProject(get, set, 'start', async (projectId) => set({ status: await window.hexestra.invoke(EGRESS_PROXY_IPC.RUNTIME_START, projectId) })),
  stop: async () => withProject(get, set, 'stop', async (projectId) => set({ status: await window.hexestra.invoke(EGRESS_PROXY_IPC.RUNTIME_STOP, projectId) })),
  refreshExit: async () => withProject(get, set, 'refresh', async (projectId) => set({ status: await window.hexestra.invoke(EGRESS_PROXY_IPC.REFRESH_EXIT, projectId) })),
  saveNode: async (input, nodeId) => run(set, 'node-save', async () => {
    if (nodeId) await window.hexestra.invoke(EGRESS_PROXY_IPC.NODES_UPDATE, nodeId, input);
    else await window.hexestra.invoke(EGRESS_PROXY_IPC.NODES_IMPORT, input);
    set({ nodes: await window.hexestra.invoke(EGRESS_PROXY_IPC.NODES_LIST), nodeTestResult: null });
  }),
  importNodes: async (value) => {
    let imported: EgressProxyNodeSummary[] = [];
    await run(set, 'node-import-batch', async () => {
      imported = await window.hexestra.invoke<EgressProxyNodeSummary[]>(EGRESS_PROXY_IPC.NODES_IMPORT_BATCH, value);
      set({ nodes: await window.hexestra.invoke(EGRESS_PROXY_IPC.NODES_LIST), nodeTestResult: null });
    });
    return imported;
  },
  deleteNode: async (nodeId) => run(set, 'node-delete', async () => {
    await window.hexestra.invoke(EGRESS_PROXY_IPC.NODES_DELETE, nodeId);
    set({ nodes: await window.hexestra.invoke(EGRESS_PROXY_IPC.NODES_LIST), nodeTestResult: null });
  }),
  testNodes: async () => {
    let result!: EgressProxyNodeTestResult;
    await run(set, 'node-test', async () => {
      result = await window.hexestra.invoke<EgressProxyNodeTestResult>(EGRESS_PROXY_IPC.NODES_TEST);
      set({ nodeTestResult: result });
    });
    return result;
  },
  saveChain: async (chain) => {
    let saved!: EgressProxyChain;
    await withProject(get, set, 'chain-save', async (projectId) => {
      saved = await window.hexestra.invoke(EGRESS_PROXY_IPC.CHAINS_SAVE, projectId, chain);
      set({ chains: await window.hexestra.invoke(EGRESS_PROXY_IPC.CHAINS_LIST, projectId) });
    });
    return saved;
  },
  deleteChain: async (chainId) => withProject(get, set, 'chain-delete', async (projectId) => {
    await window.hexestra.invoke(EGRESS_PROXY_IPC.CHAINS_DELETE, projectId, chainId);
    const [chains, status] = await Promise.all([
      window.hexestra.invoke<EgressProxyChain[]>(EGRESS_PROXY_IPC.CHAINS_LIST, projectId),
      window.hexestra.invoke<EgressProxyStatusSnapshot>(EGRESS_PROXY_IPC.STATUS, projectId),
    ]);
    set({ chains, status });
  }),
  activateChain: async (chainId) => withProject(get, set, 'chain-activate', async (projectId) => set({ status: await window.hexestra.invoke(EGRESS_PROXY_IPC.CHAINS_ACTIVATE, projectId, chainId) })),
  testChain: async (chainId) => {
    let result!: EgressProxyChainTestResult;
    await withProject(get, set, 'chain-test', async (projectId) => {
      result = await window.hexestra.invoke(EGRESS_PROXY_IPC.CHAINS_TEST, projectId, chainId);
      const status = await window.hexestra.invoke<EgressProxyStatusSnapshot>(EGRESS_PROXY_IPC.STATUS, projectId);
      const current = get();
      if (current.projectId !== projectId) return;
      set({ status: selectNewestStatus(current, projectId, status) });
    });
    return result;
  },
  applyEvent: (value) => {
    if (!isStatus(value)) return;
    const current = get();
    if (current.projectId !== value.projectId || (current.status && current.status.revision > value.revision)) return;
    set({ status: value });
  },
  clearError: () => set({ error: null }),
}));

export function installEgressProxyEvents() {
  if (!window.hexestra) return () => undefined;
  return window.hexestra.on(EGRESS_PROXY_IPC.CHANGED, (value) => useEgressProxyStore.getState().applyEvent(value));
}

async function run(set: (value: Partial<EgressProxyStore>) => void, busy: string, operation: () => Promise<void>) {
  set({ busy, error: null });
  try { await operation(); }
  catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); throw error; }
  finally { set({ busy: null }); }
}

async function withProject(get: () => EgressProxyStore, set: (value: Partial<EgressProxyStore>) => void, busy: string, operation: (projectId: string) => Promise<void>) {
  const projectId = get().projectId;
  if (!projectId) throw new Error('Open a project first');
  return run(set, busy, () => operation(projectId));
}

function isStatus(value: unknown): value is EgressProxyStatusSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.projectId === 'string' && typeof record.revision === 'number'
    && (record.state === 'off' || record.state === 'starting' || record.state === 'ready'
      || record.state === 'degraded' || record.state === 'blocked' || record.state === 'error');
}

function selectNewestStatus(current: EgressProxyStore, projectId: string, incoming: EgressProxyStatusSnapshot) {
  return current.projectId === projectId && current.status && current.status.revision > incoming.revision
    ? current.status
    : incoming;
}
