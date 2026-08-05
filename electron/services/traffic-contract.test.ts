import { describe, expect, it } from 'vitest';
import type { TrafficFlow } from '../contracts/traffic';
import {
  applyInterceptDecision,
  assertTrafficFlowDeletable,
  decodeTrafficBody,
  encodeTrafficBody,
  interruptTrafficFlow,
  normalizeLoopbackMcpUrl,
  normalizeProxyProfile,
  normalizeReplayDraft,
  patchRequest,
  partitionTrafficHistoryForClear,
  sameProxyRuntimeConfiguration,
} from './traffic-contract';

function pausedFlow(): TrafficFlow {
  return {
    id: 'flow-1',
    projectId: 'project-1',
    revision: 2,
    state: 'request_paused',
    scopeState: 'in_scope',
    source: 'browser',
    request: {
      method: 'POST',
      url: 'https://example.test/api',
      httpVersion: 'http/1.1',
      headers: [{ name: 'Content-Length', value: '3' }],
      body: { encoding: 'utf8', data: 'old', byteLength: 3 },
    },
    timing: { startedAt: new Date(0).toISOString() },
    route: { burpEnabled: false, burpRouted: false },
  };
}

describe('traffic contract', () => {
  it('applies one revisioned edit and recalculates content length', () => {
    const updated = applyInterceptDecision(pausedFlow(), {
      flowId: 'flow-1', expectedRevision: 2, action: 'forward',
      message: { body: { encoding: 'utf8', data: 'longer' } },
    });
    expect(updated.state).toBe('forwarding');
    expect(updated.revision).toBe(3);
    expect(updated.request.headers).toContainEqual({ name: 'Content-Length', value: '6' });
    expect(updated.request.headers).toContainEqual({ name: 'Host', value: 'example.test' });
  });

  it('rejects stale decisions and non-http request edits', () => {
    expect(() => applyInterceptDecision(pausedFlow(), {
      flowId: 'flow-1', expectedRevision: 1, action: 'drop',
    })).toThrow(/changed/);
    expect(() => patchRequest(pausedFlow().request, { url: 'file:///secret' })).toThrow(/HTTP/);
  });

  it('allows terminal deletion and Drop-and-delete for intercepted Flows', () => {
    expect(() => assertTrafficFlowDeletable(pausedFlow())).not.toThrow();
    expect(() => assertTrafficFlowDeletable({ state: 'response_paused' })).not.toThrow();
    expect(() => assertTrafficFlowDeletable({ state: 'captured' })).toThrow(/pause or complete/);
    expect(() => assertTrafficFlowDeletable({ state: 'forwarding' })).toThrow(/pause or complete/);
    expect(() => assertTrafficFlowDeletable({ state: 'completed' })).not.toThrow();
    expect(() => assertTrafficFlowDeletable({ state: 'failed' })).not.toThrow();
    expect(() => assertTrafficFlowDeletable({ state: 'dropped' })).not.toThrow();
  });

  it('partitions removable history without rejecting ordinary active capture', () => {
    const result = partitionTrafficHistoryForClear([
      { id: 'completed', state: 'completed' as const },
      ...Array.from({ length: 90 }, (_, index) => ({ id: `active-${index}`, state: 'forwarding' as const })),
      { id: 'protected', state: 'failed' as const },
    ], new Set(['protected']));
    expect(result.removable).toEqual([{ id: 'completed', state: 'completed' }]);
    expect(result.active).toHaveLength(90);
    expect(result.protectedSources).toEqual([{ id: 'protected', state: 'failed' }]);
  });

  it('turns an ownerless persisted pause into an interrupted terminal Flow', () => {
    const flow = pausedFlow();
    const interrupted = interruptTrafficFlow(flow, 'Traffic proxy is not running', '1970-01-01T00:00:01.000Z');
    expect(interrupted).toMatchObject({ state: 'failed', revision: flow.revision + 1, error: 'Traffic proxy is not running' });
    expect(interrupted.timing).toMatchObject({ completedAt: '1970-01-01T00:00:01.000Z', durationMs: 1_000 });
    expect(flow.state).toBe('request_paused');
  });

  it('round-trips utf8 and binary bodies', () => {
    const text = encodeTrafficBody(Buffer.from('hello'));
    const binary = encodeTrafficBody(Buffer.from([0, 255, 7]));
    expect(text.encoding).toBe('utf8');
    expect(binary.encoding).toBe('base64');
    expect(decodeTrafficBody(text)).toEqual(Buffer.from('hello'));
    expect(decodeTrafficBody(binary)).toEqual(Buffer.from([0, 255, 7]));
  });

  it('normalizes replay drafts and preserves duplicate headers', () => {
    const draft = normalizeReplayDraft(pausedFlow().request, {
      method: 'PUT', url: 'https://example.test/next',
      headers: [{ name: 'X-Test', value: 'one' }, { name: 'X-Test', value: 'two' }],
      body: { encoding: 'base64', data: 'AAE=', byteLength: 999 },
    });
    expect(draft.method).toBe('PUT');
    expect(draft.headers.filter((header) => header.name === 'X-Test')).toHaveLength(2);
    expect(draft.headers).toContainEqual({ name: 'Host', value: 'example.test' });
    expect(draft.headers).toContainEqual({ name: 'Content-Length', value: '2' });
    expect(draft.body.byteLength).toBe(2);
  });

  it('accepts only loopback Burp endpoints', () => {
    expect(normalizeLoopbackMcpUrl('http://localhost:9876/sse')).toContain('localhost:9876');
    expect(() => normalizeLoopbackMcpUrl('http://192.0.2.1:9876/sse')).toThrow(/loopback/);
    expect(normalizeProxyProfile({ burp: { bridgeHost: 'remote', bridgePort: 70000 } }).burp)
      .toMatchObject({ bridgeHost: '127.0.0.1', bridgePort: 9877 });
  });

  it('keeps mirror configuration and disables removed legacy upstream profiles', () => {
    expect(normalizeProxyProfile({ burp: { enabled: true } }).burp)
      .toMatchObject({ enabled: true, bridgeHost: '127.0.0.1', bridgePort: 9877 });
    expect(normalizeProxyProfile({ burp: { enabled: true, mode: 'upstream', proxyPort: 8080 } }).burp)
      .toMatchObject({ enabled: false, bridgeHost: '127.0.0.1', bridgePort: 9877 });
    expect(normalizeProxyProfile({ burp: { enabled: true, mode: 'upstream' } }).burp).not.toHaveProperty('mode');
  });

  it('treats Break switches as live settings without hiding route changes', () => {
    const current = normalizeProxyProfile({
      enabled: true,
      interceptRequests: true,
      interceptResponses: true,
    });
    const breaksDisabled = normalizeProxyProfile({
      enabled: true,
      interceptRequests: false,
      interceptResponses: false,
    });
    expect(sameProxyRuntimeConfiguration(current, breaksDisabled)).toBe(true);
    expect(sameProxyRuntimeConfiguration(current, {
      ...breaksDisabled,
      burp: { ...breaksDisabled.burp, bridgePort: 9001, bridgeToken: 'x'.repeat(32) },
    })).toBe(true);
    expect(sameProxyRuntimeConfiguration(current, { ...breaksDisabled, listenPort: 61000 })).toBe(false);
  });
});
