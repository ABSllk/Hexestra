import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type {
  BurpCallRequest,
  BurpConnectionStatus,
  TrafficFlow,
  TrafficHeader,
} from '../contracts/traffic';

const MAX_TOOL_RESULT = 1_000_000;

export class BurpProvider {
  private client: Client | null = null;
  private tools = new Set<string>();
  private productName?: string;
  private version?: string;
  private edition?: BurpConnectionStatus['edition'];
  private interceptEnabled?: boolean;
  private collaboratorClientId?: string;

  async connect(url: string): Promise<BurpConnectionStatus> {
    await this.close();
    const endpoint = await resolveBurpSseEndpoint(url);
    const client = new Client({ name: 'hexestra', version: '0.2.0' });
    const transport = new SSEClientTransport(endpoint);
    try {
      await withTimeout(client.connect(transport), 5_000, 'Timed out while connecting to Burp MCP');
      const result = await client.listTools();
      this.client = client;
      this.tools = new Set(result.tools.map((tool) => tool.name));
      if (this.tools.has('burp_version')) {
        const metadata = parseJsonToolResult(await client.callTool({ name: 'burp_version', arguments: {} }));
        this.productName = stringProperty(metadata, 'product_name');
        this.version = stringProperty(metadata, 'version');
        const edition = stringProperty(metadata, 'edition')?.toLowerCase();
        this.edition = edition?.includes('professional') || edition === 'pro'
          ? 'professional'
          : edition?.includes('community') ? 'community' : undefined;
      }
      if (this.tools.has('proxy_intercept_status')) {
        const intercept = parseJsonToolResult(await client.callTool({ name: 'proxy_intercept_status', arguments: {} }));
        this.interceptEnabled = typeof intercept?.intercept_enabled === 'boolean' ? intercept.intercept_enabled : undefined;
      }
      return this.status(true);
    } catch (error) {
      if (this.client === client) this.client = null;
      this.tools.clear();
      this.productName = undefined;
      this.version = undefined;
      this.edition = undefined;
      this.interceptEnabled = undefined;
      this.collaboratorClientId = undefined;
      await client.close().catch(() => {});
      throw error;
    }
  }

  status(proxyReachable: boolean, error?: string): BurpConnectionStatus {
    const tools = [...this.tools].sort();
    return {
      proxyReachable,
      mcpReachable: this.client !== null,
      edition: this.edition ?? deriveBurpEdition(tools),
      tools,
      ...(this.productName ? { productName: this.productName } : {}),
      ...(this.version ? { version: this.version } : {}),
      ...(this.interceptEnabled === undefined ? {} : { interceptEnabled: this.interceptEnabled }),
      ...(error ? { error } : {}),
    };
  }

  async call(request: BurpCallRequest, flow?: TrafficFlow) {
    const client = this.client;
    if (!client) throw new Error('Burp MCP is not connected');
    if (request.operation === 'generate_collaborator' && this.tools.has('collaborator_generate_payload')) {
      if (!this.collaboratorClientId) {
        const created = parseJsonToolResult(await client.callTool({ name: 'collaborator_create_client', arguments: {} }));
        this.collaboratorClientId = stringProperty(created, 'client_id') ?? stringProperty(created, 'clientId');
        if (!this.collaboratorClientId) throw new Error('Burp Collaborator did not return a client identifier');
      }
      const result = await client.callTool({
        name: 'collaborator_generate_payload',
        arguments: {
          client_id: this.collaboratorClientId,
          ...(normalizeCollaboratorCustomData(request.customData) ? { custom_data: normalizeCollaboratorCustomData(request.customData) } : {}),
        },
      });
      assertSuccessfulToolResult(result);
      return boundedToolContent('content' in result ? result.content : result);
    }
    if (request.operation === 'collaborator_interactions' && this.tools.has('collaborator_poll')) {
      if (!this.collaboratorClientId) throw new Error('Generate a Burp Collaborator payload before polling interactions');
      const result = await client.callTool({
        name: 'collaborator_poll',
        arguments: {
          client_id: this.collaboratorClientId,
          ...(request.payloadId ? { payload_id: request.payloadId.slice(0, 1_000) } : {}),
        },
      });
      assertSuccessfulToolResult(result);
      return boundedToolContent('content' in result ? result.content : result);
    }
    const mapped = mapBurpOperation(request, flow, this.tools);
    const result = await client.callTool({ name: mapped.name, arguments: mapped.arguments });
    assertSuccessfulToolResult(result);
    return boundedToolContent(result.content);
  }

  async close() {
    const client = this.client;
    this.client = null;
    this.tools.clear();
    this.productName = undefined;
    this.version = undefined;
    this.edition = undefined;
    this.interceptEnabled = undefined;
    this.collaboratorClientId = undefined;
    await client?.close().catch(() => {});
  }
}

export function burpMcpEndpointCandidates(value: string) {
  const configured = new URL(value);
  const candidates = [configured];
  const alternate = new URL(configured.toString());
  if (alternate.pathname.replace(/\/+$/, '').endsWith('/sse')) {
    alternate.pathname = alternate.pathname.replace(/\/sse\/*$/, '') || '/';
  } else {
    alternate.pathname = `${alternate.pathname.replace(/\/+$/, '')}/sse`;
  }
  if (alternate.toString() !== configured.toString()) candidates.push(alternate);
  return candidates;
}

async function resolveBurpSseEndpoint(value: string) {
  const failures: string[] = [];
  for (const candidate of burpMcpEndpointCandidates(value)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(candidate, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (response.ok && contentType.toLowerCase().includes('text/event-stream')) return candidate;
      failures.push(`${candidate} returned HTTP ${response.status} (${contentType || 'no content type'})`);
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  throw new Error(`Burp MCP SSE endpoint was not found. ${failures.join('; ')}`);
}

export function deriveBurpEdition(tools: Iterable<string>): BurpConnectionStatus['edition'] {
  const set = new Set(tools);
  if (set.has('get_scanner_issues') || set.has('generate_collaborator_payload')
    || set.has('scanner_get_all_issues') || set.has('collaborator_create_client')) return 'professional';
  if (set.size > 0) return 'community';
  return 'unknown';
}

export function mapBurpOperation(
  request: BurpCallRequest,
  flow: TrafficFlow | undefined,
  availableTools: Iterable<string>,
): { name: string; arguments: Record<string, unknown> } {
  const tools = new Set(availableTools);
  if (request.operation === 'scanner_issues') {
    if (tools.has('scanner_get_all_issues')) {
      return {
        name: 'scanner_get_all_issues',
        arguments: request.query ? { url_prefix: boundedOptionalString(request.query, 2_000) } : {},
      };
    }
    requireTool(tools, 'get_scanner_issues');
    return {
      name: 'get_scanner_issues',
      arguments: { offset: boundedInteger(request.offset, 0, 0, 100_000), count: boundedInteger(request.count, 50, 1, 200) },
    };
  }
  if (request.operation === 'proxy_history') {
    if (tools.has('proxy_history')) {
      return request.query
        ? { name: 'proxy_history_search', arguments: { regex: boundedOptionalString(request.query, 2_000), max_results: boundedInteger(request.count, 50, 1, 200) } }
        : { name: 'proxy_history', arguments: { max_results: boundedInteger(request.count, 50, 1, 200), offset: boundedInteger(request.offset, 0, 0, 100_000) } };
    }
    return mapPaginatedHistory(
      tools,
      request,
      'get_proxy_http_history',
      'get_proxy_http_history_regex',
    );
  }
  if (request.operation === 'organizer_history') {
    if (tools.has('organizer_get_items')) {
      return { name: 'organizer_get_items', arguments: { ...(request.query ? { url_prefix: boundedOptionalString(request.query, 2_000) } : {}), max_results: boundedInteger(request.count, 50, 1, 200) } };
    }
    return mapPaginatedHistory(
      tools,
      request,
      'get_organizer_items',
      'get_organizer_items_regex',
    );
  }
  if (request.operation === 'generate_collaborator') {
    if (tools.has('collaborator_generate_payload')) {
      return { name: 'collaborator_generate_payload', arguments: { custom_data: boundedOptionalString(request.customData, 1_000) } };
    }
    requireTool(tools, 'generate_collaborator_payload');
    return {
      name: 'generate_collaborator_payload',
      arguments: { customData: boundedOptionalString(request.customData, 1_000) ?? null },
    };
  }
  if (request.operation === 'collaborator_interactions') {
    if (tools.has('collaborator_poll')) {
      return { name: 'collaborator_poll', arguments: { payload_id: boundedOptionalString(request.payloadId, 1_000) } };
    }
    requireTool(tools, 'get_collaborator_interactions');
    return {
      name: 'get_collaborator_interactions',
      arguments: { payloadId: boundedOptionalString(request.payloadId, 1_000) ?? null },
    };
  }
  if (!flow) throw new Error('A traffic flow is required for this Burp operation');
  const service = httpService(flow.request.url);
  if (request.operation === 'open_repeater') {
    if (tools.has('repeater_send')) {
      return {
        name: 'repeater_send',
        arguments: {
          request: rawHttp1Request(flow), host: service.targetHostname, port: service.targetPort,
          use_tls: service.usesHttps, tab_name: `Hexestra ${flow.id}`,
        },
      };
    }
    if (flow.request.httpVersion === 'h2' && tools.has('create_repeater_tab_http2')) {
      const { pseudoHeaders, headers } = http2Headers(flow);
      return {
        name: 'create_repeater_tab_http2',
        arguments: {
          tabName: `Hexestra ${flow.id}`,
          pseudoHeaders,
          headers,
          requestBody: flow.request.body.encoding === 'utf8' ? flow.request.body.data : Buffer.from(flow.request.body.data, 'base64').toString('latin1'),
          ...service,
        },
      };
    }
    requireTool(tools, 'create_repeater_tab');
    return {
      name: 'create_repeater_tab',
      arguments: { tabName: `Hexestra ${flow.id}`, content: rawHttp1Request(flow), ...service },
    };
  }
  if (tools.has('intruder_send')) {
    return {
      name: 'intruder_send',
      arguments: {
        request: rawHttp1Request(flow), host: service.targetHostname, port: service.targetPort,
        use_tls: service.usesHttps, tab_name: `Hexestra ${flow.id}`,
      },
    };
  }
  requireTool(tools, 'send_to_intruder');
  return {
    name: 'send_to_intruder',
    arguments: { tabName: `Hexestra ${flow.id}`, content: rawHttp1Request(flow), ...service },
  };
}

export function rawHttp1Request(flow: TrafficFlow) {
  const url = new URL(flow.request.url);
  const target = `${url.pathname || '/'}${url.search}`;
  const headers = ensureHostHeader(flow.request.headers, url.host);
  const body = flow.request.body.encoding === 'utf8'
    ? flow.request.body.data
    : Buffer.from(flow.request.body.data, 'base64').toString('latin1');
  return [`${flow.request.method} ${target} HTTP/1.1`, ...headers.map((header) => `${header.name}: ${header.value}`), '', body].join('\r\n');
}

function http2Headers(flow: TrafficFlow) {
  const url = new URL(flow.request.url);
  const pseudoHeaders: Record<string, string> = {
    method: flow.request.method,
    scheme: url.protocol.slice(0, -1),
    authority: url.host,
    path: `${url.pathname || '/'}${url.search}`,
  };
  const headers: Record<string, string> = {};
  for (const header of flow.request.headers) {
    const name = header.name.toLowerCase();
    if (!name.startsWith(':') && name !== 'host' && name !== 'connection') headers[name] = header.value;
  }
  return { pseudoHeaders, headers };
}

function httpService(value: string) {
  const url = new URL(value);
  const usesHttps = url.protocol === 'https:';
  return {
    targetHostname: url.hostname,
    targetPort: url.port ? Number(url.port) : usesHttps ? 443 : 80,
    usesHttps,
  };
}

function ensureHostHeader(headers: TrafficHeader[], host: string) {
  return headers.some((header) => header.name.toLowerCase() === 'host')
    ? headers
    : [{ name: 'Host', value: host }, ...headers];
}

function requireTool(tools: Set<string>, tool: string) {
  if (!tools.has(tool)) throw new Error(`Burp MCP capability is unavailable: ${tool}`);
}

function mapPaginatedHistory(
  tools: Set<string>,
  request: BurpCallRequest,
  listTool: string,
  regexTool: string,
) {
  const query = boundedOptionalString(request.query, 2_000);
  const pagination = {
    offset: boundedInteger(request.offset, 0, 0, 100_000),
    count: boundedInteger(request.count, 50, 1, 200),
  };
  if (query) {
    requireTool(tools, regexTool);
    return { name: regexTool, arguments: { regex: query, ...pagination } };
  }
  requireTool(tools, listTool);
  return { name: listTool, arguments: pagination };
}

function boundedOptionalString(value: unknown, maxLength: number) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maxLength) : undefined;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function boundedToolContent(content: unknown) {
  const text = Array.isArray(content)
    ? content.map((item) => typeof item === 'object' && item && 'text' in item ? String(item.text) : JSON.stringify(item)).join('\n')
    : JSON.stringify(content);
  return text.length > MAX_TOOL_RESULT ? `${text.slice(0, MAX_TOOL_RESULT)}\n[truncated]` : text;
}

function parseJsonToolResult(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !('content' in result) || !Array.isArray(result.content)) return null;
  const text = result.content.find((item) => item && typeof item === 'object' && 'text' in item)?.text;
  if (typeof text !== 'string') return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringProperty(value: Record<string, unknown> | null, key: string) {
  return typeof value?.[key] === 'string' ? value[key] : undefined;
}

export function normalizeCollaboratorCustomData(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  return normalized || undefined;
}

function assertSuccessfulToolResult(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return;
  if ('isError' in result && result.isError) {
    throw new Error(boundedToolContent('content' in result ? result.content : result));
  }
  const parsed = parseJsonToolResult(result);
  if (typeof parsed?.error === 'string' && parsed.error) throw new Error(parsed.error);
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
