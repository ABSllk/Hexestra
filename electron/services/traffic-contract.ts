import { Buffer } from 'buffer';
import type {
  HttpMessagePatch,
  InterceptDecision,
  ProxyProfile,
  TrafficBody,
  TrafficFlow,
  TrafficFlowState,
  TrafficHeader,
  TrafficRequest,
  TrafficResponse,
} from '../contracts/traffic';
import { DEFAULT_PROXY_PROFILE } from '../contracts/traffic';

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,200}$/;
const METHOD_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,32}$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,200}$/;
const MAX_HEADER_COUNT = 500;
const MAX_HEADER_VALUE = 64 * 1024;

const NEXT_STATES: Record<TrafficFlowState, readonly TrafficFlowState[]> = {
  captured: ['request_paused', 'forwarding', 'dropped', 'failed'],
  request_paused: ['forwarding', 'dropped', 'failed'],
  forwarding: ['response_paused', 'completed', 'failed'],
  response_paused: ['completed', 'dropped', 'failed'],
  completed: [],
  dropped: [],
  failed: [],
};

export function assertTrafficTransition(from: TrafficFlowState, to: TrafficFlowState) {
  if (!NEXT_STATES[from].includes(to)) {
    throw new Error(`Invalid traffic transition: ${from} -> ${to}`);
  }
}

export function assertTrafficFlowDeletable(flow: Pick<TrafficFlow, 'state'>) {
  if (!['request_paused', 'response_paused', 'completed', 'failed', 'dropped'].includes(flow.state)) {
    throw new Error('Wait for the active Flow to pause or complete before deleting it');
  }
}

export function partitionTrafficHistoryForClear<T extends Pick<TrafficFlow, 'id' | 'state'>>(
  flows: readonly T[],
  protectedSourceIds: ReadonlySet<string> = new Set(),
) {
  const removable: T[] = [];
  const active: T[] = [];
  const protectedSources: T[] = [];
  for (const flow of flows) {
    if (protectedSourceIds.has(flow.id)) protectedSources.push(flow);
    else if (['completed', 'failed', 'dropped'].includes(flow.state)) removable.push(flow);
    else active.push(flow);
  }
  return { removable, active, protectedSources };
}

export function interruptTrafficFlow(flow: TrafficFlow, error: string, completedAt = new Date().toISOString()): TrafficFlow {
  const started = Date.parse(flow.timing.startedAt);
  const ended = Date.parse(completedAt);
  return {
    ...flow,
    state: 'failed',
    revision: flow.revision + 1,
    error,
    timing: {
      ...flow.timing,
      completedAt,
      durationMs: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : flow.timing.durationMs,
    },
  };
}

export function assertTrafficId(value: unknown, label = 'traffic flow') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label} identifier`);
  }
  return value;
}

export function normalizeProxyProfile(value: unknown): ProxyProfile {
  if (!isRecord(value)) return structuredClone(DEFAULT_PROXY_PROFILE);
  const burp = isRecord(value.burp) ? value.burp : {};
  const legacyUpstream = burp.mode === 'upstream';
  return {
    enabled: value.enabled === true,
    interceptRequests: value.interceptRequests === true,
    interceptResponses: value.interceptResponses === true,
    listenHost: '127.0.0.1',
    listenPort: optionalPort(value.listenPort),
    burp: {
      enabled: burp.enabled === true && !legacyUpstream,
      bridgeHost: '127.0.0.1',
      bridgePort: normalizePort(burp.bridgePort, 9877),
      bridgeToken: normalizeBridgeToken(burp.bridgeToken),
      mcpUrl: normalizeLoopbackMcpUrl(burp.mcpUrl),
    },
  };
}

export function sameProxyRuntimeConfiguration(left: ProxyProfile, right: ProxyProfile) {
  return left.enabled === right.enabled
    && left.listenHost === right.listenHost
    && left.listenPort === right.listenPort;
}

function normalizeBridgeToken(value: unknown) {
  if (typeof value !== 'string') return '';
  const token = value.trim();
  return token.length >= 32 && token.length <= 256 && /^[\x21-\x7E]+$/.test(token) ? token : '';
}

export function normalizeLoopbackMcpUrl(value: unknown) {
  const candidate = typeof value === 'string' && value.trim()
    ? value.trim()
    : DEFAULT_PROXY_PROFILE.burp.mcpUrl;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Burp MCP URL must be a valid HTTP(S) URL');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLoopbackHost(url.hostname)) {
    throw new Error('Burp MCP URL must use HTTP(S) on loopback');
  }
  if (url.username || url.password) throw new Error('Burp MCP URL cannot contain credentials');
  return url.toString();
}

export function normalizeHeaders(headers: unknown): TrafficHeader[] {
  if (!Array.isArray(headers) || headers.length > MAX_HEADER_COUNT) {
    throw new Error(`Headers must be an array with at most ${MAX_HEADER_COUNT} entries`);
  }
  return headers.map((header) => {
    if (!isRecord(header) || typeof header.name !== 'string' || !HEADER_NAME_PATTERN.test(header.name)) {
      throw new Error('Invalid HTTP header name');
    }
    if (typeof header.value !== 'string' || header.value.length > MAX_HEADER_VALUE || /[\r\n]/.test(header.value)) {
      throw new Error(`Invalid value for header ${header.name}`);
    }
    return { name: header.name, value: header.value };
  });
}

export function decodeTrafficBody(value: Pick<TrafficBody, 'encoding' | 'data'>) {
  if (value.encoding === 'utf8') return Buffer.from(value.data, 'utf8');
  if (value.encoding !== 'base64' || !isCanonicalBase64(value.data)) {
    throw new Error('Invalid traffic body encoding');
  }
  return Buffer.from(value.data, 'base64');
}

export function encodeTrafficBody(data: Buffer, mimeType?: string): TrafficBody {
  const utf8 = data.toString('utf8');
  const encoding = Buffer.from(utf8, 'utf8').equals(data) && !utf8.includes('\u0000')
    ? 'utf8'
    : 'base64';
  return {
    encoding,
    data: encoding === 'utf8' ? utf8 : data.toString('base64'),
    byteLength: data.byteLength,
    ...(mimeType ? { mimeType } : {}),
  };
}

export function applyInterceptDecision(flow: TrafficFlow, input: InterceptDecision): TrafficFlow {
  assertTrafficId(input.flowId);
  if (input.flowId !== flow.id) throw new Error('Traffic decision does not match the selected flow');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== flow.revision) {
    throw new Error('Traffic flow changed before this decision was applied');
  }
  if (flow.state !== 'request_paused' && flow.state !== 'response_paused') {
    throw new Error(`Traffic flow is not paused (${flow.state})`);
  }
  const next = structuredClone(flow);
  if (input.message) {
    if (flow.state === 'request_paused') next.request = patchRequest(next.request, input.message);
    else if (next.response) next.response = patchResponse(next.response, input.message);
    else throw new Error('Paused response is missing');
  }
  const nextState: TrafficFlowState = input.action === 'drop'
    ? 'dropped'
    : flow.state === 'request_paused' ? 'forwarding' : 'completed';
  assertTrafficTransition(flow.state, nextState);
  next.state = nextState;
  next.revision += 1;
  if (nextState === 'completed') completeTiming(next);
  return next;
}

export function patchRequest(request: TrafficRequest, patch: HttpMessagePatch): TrafficRequest {
  const method = patch.method ?? request.method;
  if (!METHOD_PATTERN.test(method)) throw new Error('Invalid HTTP method');
  const url = patch.url ?? request.url;
  assertHttpUrl(url);
  const body = patch.body ? normalizeBodyPatch(patch.body) : request.body;
  const headers = ensureHostHeader(
    recalculateContentLength(patch.headers ? normalizeHeaders(patch.headers) : request.headers, body),
    new URL(url).host,
  );
  return { ...request, method, url, headers, body };
}

export function normalizeReplayDraft(source: TrafficRequest, value: unknown): TrafficRequest {
  if (!isRecord(value)) throw new Error('Replay draft must be an HTTP request');
  const body = isRecord(value.body) ? value.body : undefined;
  const normalized = patchRequest(source, {
    method: typeof value.method === 'string' ? value.method : undefined,
    url: typeof value.url === 'string' ? value.url : undefined,
    headers: value.headers as TrafficHeader[] | undefined,
    body: body && (body.encoding === 'utf8' || body.encoding === 'base64') && typeof body.data === 'string'
      ? {
          encoding: body.encoding,
          data: body.data,
          mimeType: typeof body.mimeType === 'string' ? body.mimeType : undefined,
        }
      : undefined,
  });
  return { ...normalized, httpVersion: source.httpVersion };
}

export function patchResponse(response: TrafficResponse, patch: HttpMessagePatch): TrafficResponse {
  const statusCode = patch.statusCode ?? response.statusCode;
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new Error('Invalid HTTP status code');
  }
  const reason = patch.reason ?? response.reason;
  if (reason !== undefined && (reason.length > 200 || /[\r\n]/.test(reason))) {
    throw new Error('Invalid HTTP reason phrase');
  }
  const body = patch.body ? normalizeBodyPatch(patch.body) : response.body;
  const headers = recalculateContentLength(patch.headers ? normalizeHeaders(patch.headers) : response.headers, body);
  return { ...response, statusCode, reason, headers, body };
}

export function assertHttpUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid HTTP URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) traffic is supported');
  }
  return url;
}

function normalizeBodyPatch(body: Pick<TrafficBody, 'encoding' | 'data' | 'mimeType'>): TrafficBody {
  const data = decodeTrafficBody(body);
  return {
    encoding: body.encoding,
    data: body.data,
    byteLength: data.byteLength,
    ...(typeof body.mimeType === 'string' && body.mimeType ? { mimeType: body.mimeType.slice(0, 500) } : {}),
  };
}

function recalculateContentLength(headers: TrafficHeader[], body: TrafficBody) {
  const withoutLength = headers.filter((header) => header.name.toLowerCase() !== 'content-length');
  const transferEncoded = withoutLength.some((header) => header.name.toLowerCase() === 'transfer-encoding');
  return transferEncoded ? withoutLength : [...withoutLength, { name: 'Content-Length', value: String(body.byteLength) }];
}

function ensureHostHeader(headers: TrafficHeader[], host: string) {
  return headers.some((header) => header.name.toLowerCase() === 'host')
    ? headers
    : [{ name: 'Host', value: host }, ...headers];
}

function completeTiming(flow: TrafficFlow) {
  const completedAt = new Date().toISOString();
  flow.timing.completedAt = completedAt;
  const start = Date.parse(flow.timing.startedAt);
  const end = Date.parse(completedAt);
  if (Number.isFinite(start) && Number.isFinite(end)) flow.timing.durationMs = Math.max(0, end - start);
}

function isCanonicalBase64(value: string) {
  if (value === '') return true;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function isLoopbackHost(value: string) {
  return value === '127.0.0.1' || value === 'localhost' || value === '::1' || value === '[::1]';
}

function normalizePort(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback;
}

function optionalPort(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
