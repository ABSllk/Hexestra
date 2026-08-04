import { Buffer } from 'buffer';
import type { BurpProfile, TrafficFlow } from '../contracts/traffic';
import { assertTrafficId, decodeTrafficBody } from './traffic-contract';

const MAX_MIRROR_BYTES = 64 * 1024 * 1024;
const BRIDGE_HEALTH_TIMEOUT_MS = 3_000;
const BRIDGE_IMPORT_TIMEOUT_MS = 15_000;

export interface BurpBridgeHealth {
  product: string;
  version: string;
  capabilities: string[];
}

export interface BurpMirrorReceipt {
  accepted: boolean;
  duplicate: boolean;
  siteMap: boolean;
  organizer: boolean;
}

export class BurpMirrorClient {
  async health(profile: BurpProfile): Promise<BurpBridgeHealth> {
    assertMirrorProfile(profile);
    const response = await bridgeFetch(profile, '/v1/health', { method: 'GET' }, BRIDGE_HEALTH_TIMEOUT_MS);
    const payload = await parseJson(response);
    if (!isRecord(payload) || payload.product !== 'Hexestra Bridge' || typeof payload.version !== 'string') {
      throw new Error('Burp Bridge returned an invalid health response');
    }
    return {
      product: payload.product,
      version: payload.version,
      capabilities: Array.isArray(payload.capabilities)
        ? payload.capabilities.filter((value): value is string => typeof value === 'string').slice(0, 32)
        : [],
    };
  }

  async mirror(projectId: string, flow: TrafficFlow, profile: BurpProfile): Promise<BurpMirrorReceipt> {
    assertMirrorProfile(profile);
    assertTrafficId(projectId, 'project');
    assertTrafficId(flow.id);
    if (flow.state !== 'completed' || !flow.response) {
      throw new Error('Only completed HTTP exchanges can be mirrored to Burp');
    }
    if (flow.request.httpVersion === 'websocket') throw new Error('WebSocket flows cannot be mirrored');

    const url = new URL(flow.request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only HTTP(S) flows can be mirrored');
    }
    const request = rawRequest(flow);
    const response = rawResponse(flow);
    if (request.length + response.length > MAX_MIRROR_BYTES) {
      throw new Error('Traffic exchange exceeds the 64 MiB Burp mirror limit');
    }
    const body = Buffer.concat([request, response]);
    const bridgeResponse = await bridgeFetch(profile, '/v1/flows', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        'X-Hexestra-Flow-Id': flow.id,
        'X-Hexestra-Project-Id': projectId,
        'X-Hexestra-Scheme': url.protocol.slice(0, -1),
        'X-Hexestra-Host': Buffer.from(url.hostname, 'utf8').toString('base64url'),
        'X-Hexestra-Port': String(Number(url.port) || (url.protocol === 'https:' ? 443 : 80)),
        'X-Hexestra-Request-Length': String(request.length),
        'X-Hexestra-Response-Length': String(response.length),
      },
      body,
    }, BRIDGE_IMPORT_TIMEOUT_MS);
    const payload = await parseJson(bridgeResponse);
    if (!isRecord(payload) || payload.accepted !== true) {
      throw new Error('Burp Bridge rejected the mirrored exchange');
    }
    return {
      accepted: true,
      duplicate: payload.duplicate === true,
      siteMap: payload.siteMap === true,
      organizer: payload.organizer === true,
    };
  }
}

export function rawRequest(flow: Pick<TrafficFlow, 'request'>) {
  const url = new URL(flow.request.url);
  const target = `${url.pathname || '/'}${url.search}`;
  return rawMessage(`${flow.request.method} ${target} HTTP/1.1`, flow.request.headers, decodeTrafficBody(flow.request.body));
}

export function rawResponse(flow: Pick<TrafficFlow, 'response'>) {
  if (!flow.response) throw new Error('Traffic response is missing');
  const reason = flow.response.reason?.trim() || defaultReason(flow.response.statusCode);
  return rawMessage(`HTTP/1.1 ${flow.response.statusCode}${reason ? ` ${reason}` : ''}`, flow.response.headers, decodeTrafficBody(flow.response.body));
}

function rawMessage(startLine: string, headers: Array<{ name: string; value: string }>, body: Buffer) {
  if (/\r|\n/.test(startLine)) throw new Error('Invalid HTTP start line');
  const lines = [startLine];
  for (const header of headers) {
    if (/\r|\n/.test(header.name) || /\r|\n/.test(header.value)) throw new Error('Invalid HTTP header');
    lines.push(`${header.name}: ${header.value}`);
  }
  return Buffer.concat([Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1'), body]);
}

async function bridgeFetch(profile: BurpProfile, pathname: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${profile.bridgeToken}`);
    const response = await fetch(`http://${profile.bridgeHost}:${profile.bridgePort}${pathname}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 300);
      if (response.status === 401) throw new Error('Burp Bridge pairing token was rejected');
      throw new Error(`Burp Bridge returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Burp Bridge connection timed out');
    if (error instanceof Error && error.message.startsWith('Burp Bridge')) throw error;
    throw new Error(`Burp Bridge is unavailable at 127.0.0.1:${profile.bridgePort}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function assertMirrorProfile(profile: BurpProfile) {
  if (profile.bridgeHost !== '127.0.0.1') throw new Error('Burp Bridge must bind to loopback');
  if (!Number.isInteger(profile.bridgePort) || profile.bridgePort < 1 || profile.bridgePort > 65_535) {
    throw new Error('Burp Bridge port is invalid');
  }
  if (profile.bridgeToken.length < 32 || profile.bridgeToken.length > 256 || !/^[\x21-\x7E]+$/.test(profile.bridgeToken)) {
    throw new Error('Enter the 32-character or longer pairing token shown by Hexestra Bridge in Burp');
  }
}

async function parseJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error('Burp Bridge returned invalid JSON');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultReason(statusCode: number) {
  const reasons: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found',
    304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
  };
  return reasons[statusCode] ?? '';
}
