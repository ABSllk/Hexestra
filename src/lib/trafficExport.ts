import type { TrafficFlow, TrafficRequest, TrafficResponse } from '@electron/contracts/traffic';

export function formatRawRequest(request: TrafficRequest) {
  return [
    `${request.method} ${request.url} ${displayVersion(request.httpVersion)}`,
    ...request.headers.map((header) => `${header.name}: ${header.value}`),
    '',
    request.body.data,
  ].join('\r\n');
}

export function formatRawResponse(response?: TrafficResponse) {
  if (!response) return '<no response>';
  return [
    `${displayVersion(response.httpVersion)} ${response.statusCode} ${response.reason ?? ''}`.trim(),
    ...response.headers.map((header) => `${header.name}: ${header.value}`),
    '',
    response.body.data,
  ].join('\r\n');
}

export function formatFlowAsCurl(flow: TrafficFlow) {
  const headers = flow.request.headers
    .filter((header) => !['content-length', 'host'].includes(header.name.toLowerCase()))
    .map((header) => `-H ${shellQuote(`${header.name}: ${header.value}`)}`);
  const body = flow.request.body.byteLength === 0
    ? []
    : flow.request.body.encoding === 'utf8'
      ? [`--data-binary ${shellQuote(flow.request.body.data)}`]
      : ['--data-binary @-'];
  const curl = ['curl', '-i', '-X', shellQuote(flow.request.method), ...headers, ...body, shellQuote(flow.request.url)].join(' ');
  return flow.request.body.byteLength > 0 && flow.request.body.encoding === 'base64'
    ? `printf %s ${shellQuote(flow.request.body.data)} | base64 --decode | ${curl}`
    : curl;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function displayVersion(version: TrafficRequest['httpVersion']) {
  return version === 'h2' ? 'HTTP/2' : 'HTTP/1.1';
}
