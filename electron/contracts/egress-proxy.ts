export const EGRESS_PROXY_IPC = {
  RUNTIME_DIAGNOSE: 'egress-proxy:runtime:diagnose',
  RUNTIME_CHOOSE: 'egress-proxy:runtime:choose',
  RUNTIME_START: 'egress-proxy:runtime:start',
  RUNTIME_STOP: 'egress-proxy:runtime:stop',
  STATUS: 'egress-proxy:status',
  REFRESH_EXIT: 'egress-proxy:exit:refresh',
  NODES_LIST: 'egress-proxy:nodes:list',
  NODES_IMPORT: 'egress-proxy:nodes:import',
  NODES_IMPORT_BATCH: 'egress-proxy:nodes:import-batch',
  NODES_UPDATE: 'egress-proxy:nodes:update',
  NODES_DELETE: 'egress-proxy:nodes:delete',
  NODES_TEST: 'egress-proxy:nodes:test',
  CHAINS_LIST: 'egress-proxy:chains:list',
  CHAINS_SAVE: 'egress-proxy:chains:save',
  CHAINS_DELETE: 'egress-proxy:chains:delete',
  CHAINS_ACTIVATE: 'egress-proxy:chains:activate',
  CHAINS_TEST: 'egress-proxy:chains:test',
  ENFORCEMENT_SET: 'egress-proxy:enforcement:set',
  CHANGED: 'egress-proxy:changed',
} as const;

export type EgressProxyProtocol =
  | 'http'
  | 'https'
  | 'socks5'
  | 'ss'
  | 'vmess'
  | 'vless'
  | 'trojan'
  | 'hysteria2'
  | 'tuic';

export type EgressProxyRuntimeState =
  | 'off'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'blocked'
  | 'error';

export interface EgressProxyNodeSummary {
  id: string;
  name: string;
  protocol: EgressProxyProtocol;
  tcp: boolean;
  udp: boolean;
  updatedAt: string;
}

export interface EgressProxyNodeInput {
  name?: string;
  source: 'uri' | 'form' | 'yaml';
  value: string | Record<string, unknown>;
}

export interface EgressProxyChain {
  id: string;
  name: string;
  nodeIds: string[];
}

export interface EgressProjectProxyState {
  enabled: boolean;
  activeChainId: string | null;
  chains: EgressProxyChain[];
}

export interface EgressProxyRuntimeDiagnostic {
  configuredPath: string | null;
  exists: boolean;
  executable: boolean;
  version: string | null;
  supported: boolean;
  error: string | null;
  warning: string | null;
}

export interface EgressProxyStatusSnapshot {
  projectId: string;
  revision: number;
  state: EgressProxyRuntimeState;
  enabled: boolean;
  activeChainId: string | null;
  activeChainName: string | null;
  mixedPort: number | null;
  tcpReady: boolean;
  udpReady: boolean;
  exitIp: string | null;
  lastCheckedAt: string | null;
  error: string | null;
  chainLatencyMs: number | null;
  latencyCheckedAt: string | null;
  nodeLatencyMs: Record<string, number | null>;
}

export interface EgressProxyChainTestResult {
  chainId: string;
  tcpReady: boolean;
  udpReady: boolean;
  latencyMs: number | null;
  nodeLatencyMs: Record<string, number | null>;
  error: string | null;
}

export interface EgressProxyNodeTestResult {
  checkedAt: string;
  nodeLatencyMs: Record<string, number | null>;
}
