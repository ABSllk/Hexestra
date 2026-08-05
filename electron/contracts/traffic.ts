export const TRAFFIC_IPC = {
  GET_PROFILE: 'traffic:profile:get',
  UPDATE_PROFILE: 'traffic:profile:update',
  LIST: 'traffic:list',
  READ: 'traffic:read',
  DELETE: 'traffic:delete',
  CLEAR: 'traffic:clear',
  DECIDE: 'traffic:decide',
  REPLAY: 'traffic:replay',
  REPLAY_SESSION_OPEN: 'traffic:replay-session:open',
  REPLAY_SESSION_READ: 'traffic:replay-session:read',
  REPLAY_SESSION_UPDATE: 'traffic:replay-session:update',
  REPLAY_SESSION_CLEAR: 'traffic:replay-session:clear',
  SAVE_EVIDENCE: 'traffic:save-evidence',
  START: 'traffic:start',
  STOP: 'traffic:stop',
  BURP_CONNECT: 'traffic:burp:connect',
  BURP_DISCONNECT: 'traffic:burp:disconnect',
  BURP_CALL: 'traffic:burp:call',
  RUNTIME_GET: 'traffic:runtime:get',
  RUNTIME_DETECT: 'traffic:runtime:detect',
  RUNTIME_UPDATE: 'traffic:runtime:update',
  RUNTIME_CHOOSE: 'traffic:runtime:choose',
  CHANGED: 'traffic:changed',
} as const;

export type TrafficFlowState =
  | 'captured'
  | 'request_paused'
  | 'forwarding'
  | 'response_paused'
  | 'completed'
  | 'dropped'
  | 'failed';

export type TrafficProtocol = 'http/1.1' | 'h2' | 'websocket';
export type TrafficScopeState = 'in_scope' | 'out_of_scope';
export type TrafficBodyEncoding = 'utf8' | 'base64';
export type BurpIntegrationMode = 'mirror';
export type BurpMirrorState = 'pending' | 'synced' | 'failed';

export interface TrafficBody {
  encoding: TrafficBodyEncoding;
  data: string;
  byteLength: number;
  mimeType?: string;
}

export interface TrafficHeader {
  name: string;
  value: string;
}

export interface TrafficRequest {
  method: string;
  url: string;
  httpVersion: TrafficProtocol;
  headers: TrafficHeader[];
  body: TrafficBody;
}

export interface TrafficResponse {
  statusCode: number;
  reason?: string;
  httpVersion: TrafficProtocol;
  headers: TrafficHeader[];
  body: TrafficBody;
}

export interface TrafficTiming {
  startedAt: string;
  requestForwardedAt?: string;
  responseReceivedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface TrafficFlow {
  id: string;
  projectId: string;
  revision: number;
  state: TrafficFlowState;
  scopeState: TrafficScopeState;
  source: 'browser' | 'replay';
  parentFlowId?: string;
  request: TrafficRequest;
  response?: TrafficResponse;
  timing: TrafficTiming;
  route: {
    burpEnabled: boolean;
    burpRouted: boolean;
    burpMode?: BurpIntegrationMode;
    burpMirrorState?: BurpMirrorState;
    burpMirrorError?: string;
  };
  error?: string;
}

export interface TrafficSummary {
  id: string;
  revision: number;
  state: TrafficFlowState;
  scopeState: TrafficScopeState;
  source: TrafficFlow['source'];
  parentFlowId?: string;
  method: string;
  url: string;
  host: string;
  statusCode?: number;
  contentType?: string;
  requestBytes: number;
  responseBytes?: number;
  startedAt: string;
  durationMs?: number;
  burpRouted: boolean;
  burpMode?: BurpIntegrationMode;
  burpMirrorState?: BurpMirrorState;
  burpMirrorError?: string;
  error?: string;
}

export interface TrafficListQuery {
  query?: string;
  state?: TrafficFlowState;
  states?: TrafficFlowState[];
  scopeState?: TrafficScopeState;
  source?: TrafficFlow['source'];
  host?: string;
  method?: string;
  parentFlowId?: string;
  offset?: number;
  limit?: number;
}

export interface TrafficListResult {
  items: TrafficSummary[];
  total: number;
  offset: number;
  limit: number;
}

export interface HttpMessagePatch {
  method?: string;
  url?: string;
  statusCode?: number;
  reason?: string;
  headers?: TrafficHeader[];
  body?: Pick<TrafficBody, 'encoding' | 'data' | 'mimeType'>;
}

export interface InterceptDecision {
  flowId: string;
  expectedRevision: number;
  action: 'forward' | 'drop';
  message?: HttpMessagePatch;
}

export interface TrafficReplayRequest {
  parentFlowId: string;
  replaySessionId?: string;
  message?: HttpMessagePatch;
}

export interface TrafficReplayResult {
  accepted: boolean;
  flowId: string;
  parentFlowId: string;
}

export interface ReplaySession {
  id: string;
  projectId: string;
  sourceFlowId: string;
  draft: TrafficRequest;
  draftText?: string;
  attemptFlowIds: string[];
  selectedAttemptFlowId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReplaySessionPatch {
  draft?: TrafficRequest;
  draftText?: string;
  selectedAttemptFlowId?: string | null;
}

export interface BurpProfile {
  enabled: boolean;
  bridgeHost: '127.0.0.1';
  bridgePort: number;
  bridgeToken: string;
  mcpUrl: string;
}

export interface ProxyProfile {
  enabled: boolean;
  interceptRequests: boolean;
  interceptResponses: boolean;
  listenHost: '127.0.0.1';
  listenPort?: number;
  burp: BurpProfile;
}

export type ProxyRuntimeState = 'stopped' | 'starting' | 'ready' | 'blocked' | 'error';

export interface BurpConnectionStatus {
  proxyReachable: boolean;
  mcpReachable: boolean;
  bridgeReachable?: boolean;
  bridgeCapabilities?: string[];
  edition: 'community' | 'professional' | 'unknown';
  productName?: string;
  version?: string;
  interceptEnabled?: boolean;
  tools: string[];
  error?: string;
}

export type BurpOperation =
  | 'open_repeater'
  | 'send_intruder'
  | 'scanner_issues'
  | 'proxy_history'
  | 'organizer_history'
  | 'generate_collaborator'
  | 'collaborator_interactions';

export interface BurpCallRequest {
  operation: BurpOperation;
  flowId?: string;
  offset?: number;
  count?: number;
  query?: string;
  customData?: string;
  payloadId?: string;
}

export interface TrafficProfileState {
  profile: ProxyProfile;
  runtime: ProxyRuntimeState;
  sidecarVersion?: string;
  burpStatus: BurpConnectionStatus;
  mirrorStatus: BurpMirrorRuntimeStatus;
  error?: string;
}

export interface BurpMirrorRuntimeStatus {
  state: 'disabled' | 'ready' | 'offline';
  pending: number;
  synced: number;
  failed: number;
  capabilities: string[];
  error?: string;
}

export interface TrafficChangedEvent {
  projectId: string;
  flowId?: string;
  profile?: boolean;
}

export interface TrafficDeleteResult {
  flowId: string;
  deleted: boolean;
  droppedIntercepted: boolean;
  clearedReplaySessionIds: string[];
}

export interface TrafficClearResult {
  deleted: number;
  retainedActive: number;
  retainedRepeaterSources: number;
  droppedIntercepted: number;
}

export const DEFAULT_PROXY_PROFILE: ProxyProfile = {
  enabled: false,
  interceptRequests: false,
  interceptResponses: false,
  listenHost: '127.0.0.1',
  burp: {
    enabled: false,
    bridgeHost: '127.0.0.1',
    bridgePort: 9877,
    bridgeToken: '',
    mcpUrl: 'http://127.0.0.1:9876/sse',
  },
};
