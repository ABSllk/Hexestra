import { describe, expect, it } from 'vitest';
import type { TrafficFlow } from '@electron/contracts/traffic';
import { formatTrafficMessage, parseTrafficMessage } from './trafficEditor';

const flow: TrafficFlow = {
  id: 'flow-1', projectId: 'p1', revision: 1, state: 'request_paused', scopeState: 'in_scope', source: 'browser',
  request: {
    method: 'POST', url: 'https://example.test/a', httpVersion: 'h2', headers: [{ name: 'X-Test', value: '1' }],
    body: { encoding: 'utf8', data: 'hello', byteLength: 5 },
  },
  response: {
    statusCode: 200, reason: 'OK', httpVersion: 'h2', headers: [], body: { encoding: 'utf8', data: 'ok', byteLength: 2 },
  },
  timing: { startedAt: '2026-08-01T00:00:00.000Z' }, route: { burpEnabled: false, burpRouted: false },
};

describe('traffic editor', () => {
  it('round-trips request and response editor text', () => {
    expect(parseTrafficMessage(formatTrafficMessage(flow, 'request'), 'request', 'utf8')).toMatchObject({
      method: 'POST', url: 'https://example.test/a', body: { data: 'hello' },
    });
    expect(parseTrafficMessage(formatTrafficMessage(flow, 'response'), 'response', 'utf8')).toMatchObject({
      statusCode: 200, reason: 'OK', body: { data: 'ok' },
    });
  });

  it('rejects malformed start lines and headers', () => {
    expect(() => parseTrafficMessage('GET /missing-version', 'request', 'utf8')).toThrow(/Request line/);
    expect(() => parseTrafficMessage('HTTP/1.1 200 OK\nBad', 'response', 'utf8')).toThrow(/header/);
  });
});

