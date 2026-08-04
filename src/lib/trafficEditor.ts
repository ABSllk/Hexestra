import type { HttpMessagePatch, TrafficFlow, TrafficHeader } from '@electron/contracts/traffic';

export type TrafficEditorSide = 'request' | 'response';

export function formatTrafficMessage(flow: TrafficFlow, side: TrafficEditorSide) {
  if (side === 'request') {
    return [
      `${flow.request.method} ${flow.request.url} ${displayVersion(flow.request.httpVersion)}`,
      ...flow.request.headers.map((header) => `${header.name}: ${header.value}`),
      '',
      flow.request.body.data,
    ].join('\n');
  }
  if (!flow.response) return '';
  return [
    `${displayVersion(flow.response.httpVersion)} ${flow.response.statusCode} ${flow.response.reason ?? ''}`.trim(),
    ...flow.response.headers.map((header) => `${header.name}: ${header.value}`),
    '',
    flow.response.body.data,
  ].join('\n');
}

export function parseTrafficMessage(source: string, side: TrafficEditorSide, encoding: 'utf8' | 'base64'): HttpMessagePatch {
  const normalized = source.replace(/\r\n/g, '\n');
  const boundary = normalized.indexOf('\n\n');
  const head = boundary >= 0 ? normalized.slice(0, boundary) : normalized;
  const body = boundary >= 0 ? normalized.slice(boundary + 2) : '';
  const lines = head.split('\n');
  const startLine = lines.shift()?.trim() ?? '';
  const headers = parseHeaders(lines);
  if (side === 'request') {
    const match = /^(\S+)\s+(\S+)\s+HTTP\/(?:1\.[01]|2(?:\.0)?)$/i.exec(startLine);
    if (!match) throw new Error('Request line must be METHOD URL HTTP/VERSION');
    return { method: match[1], url: match[2], headers, body: { encoding, data: body } };
  }
  const match = /^HTTP\/(?:1\.[01]|2(?:\.0)?)\s+(\d{3})(?:\s+(.*))?$/i.exec(startLine);
  if (!match) throw new Error('Response line must be HTTP/VERSION STATUS REASON');
  return {
    statusCode: Number(match[1]),
    reason: match[2] ?? '',
    headers,
    body: { encoding, data: body },
  };
}

function parseHeaders(lines: string[]): TrafficHeader[] {
  return lines.filter(Boolean).map((line) => {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error(`Invalid header line: ${line}`);
    return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
  });
}

function displayVersion(version: TrafficFlow['request']['httpVersion']) {
  return version === 'h2' ? 'HTTP/2' : 'HTTP/1.1';
}

