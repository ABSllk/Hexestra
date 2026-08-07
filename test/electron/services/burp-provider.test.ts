import { describe, expect, it } from 'vitest';
import type { TrafficFlow } from '@electron/contracts/traffic';
import { burpMcpEndpointCandidates, deriveBurpEdition, mapBurpOperation, normalizeCollaboratorCustomData, rawHttp1Request } from '@electron/services/burp-provider';

const flow: TrafficFlow = {
  id: 'flow-1', projectId: 'project-1', revision: 0, state: 'completed', scopeState: 'in_scope', source: 'browser',
  request: {
    method: 'POST', url: 'https://example.test:8443/api?q=1', httpVersion: 'h2',
    headers: [{ name: 'Content-Type', value: 'application/json' }],
    body: { encoding: 'utf8', data: '{}', byteLength: 2 },
  },
  timing: { startedAt: '2026-08-01T00:00:00.000Z' }, route: { burpEnabled: true, burpRouted: true },
};

describe('BurpProvider mapping', () => {
  it('negotiates Community and Professional by discovered tools', () => {
    expect(deriveBurpEdition(['create_repeater_tab'])).toBe('community');
    expect(deriveBurpEdition(['get_scanner_issues'])).toBe('professional');
    expect(deriveBurpEdition([])).toBe('unknown');
  });

  it('supports official Burp SSE endpoints with or without the /sse suffix', () => {
    expect(burpMcpEndpointCandidates('http://127.0.0.1:9876/sse').map(String)).toEqual([
      'http://127.0.0.1:9876/sse', 'http://127.0.0.1:9876/',
    ]);
    expect(burpMcpEndpointCandidates('http://127.0.0.1:9876').map(String)).toEqual([
      'http://127.0.0.1:9876/', 'http://127.0.0.1:9876/sse',
    ]);
  });

  it('maps HTTP/2 flows to the official Repeater tool', () => {
    expect(mapBurpOperation({ operation: 'open_repeater' }, flow, ['create_repeater_tab_http2']))
      .toMatchObject({
        name: 'create_repeater_tab_http2',
        arguments: { targetHostname: 'example.test', targetPort: 8443, usesHttps: true },
      });
  });

  it('maps the current official Burp tool names through the same capability adapter', () => {
    expect(mapBurpOperation({ operation: 'open_repeater' }, flow, ['repeater_send'])).toMatchObject({
      name: 'repeater_send', arguments: { host: 'example.test', port: 8443, use_tls: true },
    });
    expect(mapBurpOperation({ operation: 'send_intruder' }, flow, ['intruder_send'])).toMatchObject({
      name: 'intruder_send', arguments: { host: 'example.test', port: 8443, use_tls: true },
    });
    expect(mapBurpOperation({ operation: 'scanner_issues' }, undefined, ['scanner_get_all_issues']).name)
      .toBe('scanner_get_all_issues');
    expect(mapBurpOperation({ operation: 'proxy_history' }, undefined, ['proxy_history']).name)
      .toBe('proxy_history');
  });

  it('renders a valid origin-form HTTP/1 request for Intruder', () => {
    const raw = rawHttp1Request(flow);
    expect(raw).toContain('POST /api?q=1 HTTP/1.1\r\n');
    expect(raw).toContain('Host: example.test:8443');
    expect(mapBurpOperation({ operation: 'send_intruder' }, flow, ['send_to_intruder']).name).toBe('send_to_intruder');
  });

  it('fails early when an edition lacks the requested capability', () => {
    expect(() => mapBurpOperation({ operation: 'scanner_issues' }, undefined, ['create_repeater_tab']))
      .toThrow(/unavailable/);
  });

  it('maps common history tools and their regex variants', () => {
    expect(mapBurpOperation(
      { operation: 'proxy_history', offset: 5, count: 25 },
      undefined,
      ['get_proxy_http_history'],
    )).toEqual({ name: 'get_proxy_http_history', arguments: { offset: 5, count: 25 } });
    expect(mapBurpOperation(
      { operation: 'organizer_history', query: 'example\\.test' },
      undefined,
      ['get_organizer_items_regex'],
    )).toMatchObject({
      name: 'get_organizer_items_regex',
      arguments: { regex: 'example\\.test', offset: 0, count: 50 },
    });
  });

  it('maps Professional Collaborator tools without exposing them as Agent tools', () => {
    expect(normalizeCollaboratorCustomData('hexestra-local-validation')).toBe('hexestralocalval');
    expect(mapBurpOperation(
      { operation: 'generate_collaborator', customData: 'hexestra-flow-1' },
      undefined,
      ['generate_collaborator_payload'],
    )).toEqual({
      name: 'generate_collaborator_payload',
      arguments: { customData: 'hexestra-flow-1' },
    });
    expect(mapBurpOperation(
      { operation: 'collaborator_interactions', payloadId: 'payload-1' },
      undefined,
      ['get_collaborator_interactions'],
    )).toEqual({
      name: 'get_collaborator_interactions',
      arguments: { payloadId: 'payload-1' },
    });
  });
});
