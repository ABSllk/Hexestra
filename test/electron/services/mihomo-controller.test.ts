import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { parseMihomoVersion, requestMihomoController } from '@electron/services/mihomo-controller';

const servers: http.Server[] = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

describe('Mihomo controller boundary', () => {
  it('accepts only the pinned semantic version shape', () => {
    expect(parseMihomoVersion('Mihomo Meta v1.19.29 linux amd64')).toBe('1.19.29');
    expect(parseMihomoVersion('version 1.18.0')).toBe('1.18.0');
    expect(parseMihomoVersion('unknown')).toBeNull();
  });

  it('sends Bearer authentication and preserves controller failures', async () => {
    const seen: Array<{ authorization?: string; body: string }> = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        seen.push({ authorization: request.headers.authorization, body: Buffer.concat(chunks).toString('utf8') });
        if (request.headers.authorization !== 'Bearer correct-secret') {
          response.writeHead(401).end();
          return;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ ok: true }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const controllerPort = typeof address === 'object' && address ? address.port : 0;

    await expect(requestMihomoController({ controllerPort, secret: 'wrong' }, 'GET', '/version')).rejects.toThrow('401');
    await expect(requestMihomoController({ controllerPort, secret: 'correct-secret' }, 'PUT', '/configs', { path: 'candidate.yaml' })).resolves.toEqual({ ok: true });
    expect(seen[1]).toEqual({ authorization: 'Bearer correct-secret', body: JSON.stringify({ path: 'candidate.yaml' }) });
  });
});
