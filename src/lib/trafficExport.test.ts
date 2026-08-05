import { describe, expect, it } from 'vitest';
import { formatFlowAsCurl, formatRawRequest } from './trafficExport';
import type { TrafficFlow } from '@electron/contracts/traffic';

const flow: TrafficFlow = {
  id: 'flow-1', projectId: 'project-1', revision: 1, state: 'completed', scopeState: 'in_scope', source: 'browser',
  request: { method: 'POST', url: 'https://example.test/api', httpVersion: 'http/1.1', headers: [{ name: 'X-Test', value: "a'b" }, { name: 'X-Test', value: 'second' }], body: { encoding: 'utf8', data: 'hello', byteLength: 5 } },
  timing: { startedAt: '2026-08-03T00:00:00.000Z' }, route: { burpEnabled: false, burpRouted: false },
};

describe('traffic export', () => {
  it('preserves duplicate headers in raw and cURL formats', () => {
    expect(formatRawRequest(flow.request)).toContain('X-Test: a\'b\r\nX-Test: second');
    expect(formatFlowAsCurl(flow).match(/-H /g)).toHaveLength(2);
  });

  it('pipes decoded binary data to cURL without treating base64 as text', () => {
    const binary = { ...flow, request: { ...flow.request, body: { encoding: 'base64' as const, data: 'AAEC', byteLength: 3 } } };
    expect(formatFlowAsCurl(binary)).toContain("base64 --decode | curl");
    expect(formatFlowAsCurl(binary)).toContain('--data-binary @-');
  });
});
