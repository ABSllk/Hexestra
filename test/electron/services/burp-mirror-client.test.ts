import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROXY_PROFILE, type BurpProfile, type TrafficFlow } from '@electron/contracts/traffic';
import { BurpMirrorClient, rawRequest, rawResponse } from '@electron/services/burp-mirror-client';

const token = 't'.repeat(48);
const profile: BurpProfile = {
  ...DEFAULT_PROXY_PROFILE.burp,
  enabled: true,
  bridgePort: 9877,
  bridgeToken: token,
};
const flow: TrafficFlow = {
  id: 'mirror-flow-1', projectId: 'project-1', revision: 2, state: 'completed',
  scopeState: 'in_scope', source: 'browser',
  request: {
    method: 'POST', url: 'https://example.test:8443/path?q=1', httpVersion: 'h2',
    headers: [
      { name: 'Host', value: 'example.test:8443' },
      { name: 'X-Repeat', value: 'one' },
      { name: 'X-Repeat', value: 'two' },
      { name: 'Content-Length', value: '3' },
    ],
    body: { encoding: 'base64', data: 'AP8H', byteLength: 3 },
  },
  response: {
    statusCode: 201, reason: 'Created', httpVersion: 'h2',
    headers: [{ name: 'Content-Type', value: 'application/octet-stream' }],
    body: { encoding: 'base64', data: '/gAB', byteLength: 3 },
  },
  timing: { startedAt: '2026-08-03T00:00:00.000Z', completedAt: '2026-08-03T00:00:00.100Z', durationMs: 100 },
  route: { burpEnabled: true, burpRouted: false, burpMode: 'mirror', burpMirrorState: 'pending' },
};

let server: http.Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('BurpMirrorClient', () => {
  it('preserves duplicate headers and binary bodies in raw HTTP messages', () => {
    const request = rawRequest(flow);
    const response = rawResponse(flow);
    expect(request.subarray(0, -3).toString('latin1')).toContain('POST /path?q=1 HTTP/1.1\r\n');
    expect(request.toString('latin1').match(/X-Repeat:/g)).toHaveLength(2);
    expect(request.subarray(-3)).toEqual(Buffer.from([0, 255, 7]));
    expect(response.subarray(-3)).toEqual(Buffer.from([254, 0, 1]));
  });

  it('submits one authenticated binary exchange without contacting the target', async () => {
    let received: { headers: http.IncomingHttpHeaders; body: Buffer } | undefined;
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        if (request.url === '/v1/health') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ product: 'Hexestra Bridge', version: '1', capabilities: ['site_map'] }));
          return;
        }
        received = { headers: request.headers, body: Buffer.concat(chunks) };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ accepted: true, duplicate: false, siteMap: true, organizer: false }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const bridgeProfile = { ...profile, bridgePort: typeof address === 'object' && address ? address.port : 0 };
    const client = new BurpMirrorClient();

    await expect(client.health(bridgeProfile)).resolves.toMatchObject({ capabilities: ['site_map'] });
    await expect(client.mirror('project-1', flow, bridgeProfile)).resolves.toMatchObject({ accepted: true, siteMap: true });
    expect(received?.headers.authorization).toBe(`Bearer ${token}`);
    expect(received?.headers['x-hexestra-request-length']).toBe(String(rawRequest(flow).length));
    expect(received?.headers['x-hexestra-response-length']).toBe(String(rawResponse(flow).length));
    expect(received?.body).toEqual(Buffer.concat([rawRequest(flow), rawResponse(flow)]));
  });

  it('rejects missing pairing tokens before opening a socket', async () => {
    await expect(new BurpMirrorClient().health({ ...profile, bridgeToken: '' })).rejects.toThrow(/pairing token/);
  });
});
