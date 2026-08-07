import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrafficFlow } from '@electron/contracts/traffic';
import { TrafficRepository, summarizeTrafficFlow } from '@electron/services/traffic.repository';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function flow(id: string, overrides: Partial<TrafficFlow> = {}): TrafficFlow {
  return {
    id,
    projectId: 'project-1',
    revision: 0,
    state: 'completed',
    scopeState: 'in_scope',
    source: 'browser',
    request: {
      method: 'GET', url: `https://example.test/${id}`, httpVersion: 'h2',
      headers: [], body: { encoding: 'utf8', data: '', byteLength: 0 },
    },
    response: {
      statusCode: 200, httpVersion: 'h2', headers: [{ name: 'Content-Type', value: 'text/plain' }],
      body: { encoding: 'utf8', data: 'ok', byteLength: 2 },
    },
    timing: { startedAt: '2026-08-01T00:00:00.000Z', durationMs: 10 },
    route: { burpEnabled: false, burpRouted: false },
    ...overrides,
  };
}

describe('TrafficRepository', () => {
  it('persists readable flow JSON and returns bounded summaries', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-traffic-'));
    roots.push(root);
    const repository = new TrafficRepository(root);
    repository.upsert(flow('flow-a'));
    repository.upsert(flow('flow-b', { scopeState: 'out_of_scope' }));
    expect(repository.read('flow-a')?.response?.body.data).toBe('ok');
    expect(repository.list({ query: 'flow-a', limit: 999 }).items).toHaveLength(1);
    expect(repository.list({ scopeState: 'out_of_scope' }).items[0].id).toBe('flow-b');
    expect(repository.list({ states: ['completed'], source: 'browser', host: 'example.test', method: 'GET' }).total).toBe(2);
    const persisted = fs.readFileSync(path.join(root, '.hexestra', 'traffic', 'flows', '2026-08-01', 'flow-a.json'), 'utf8');
    expect(persisted).toContain('"data": "ok"');
    repository.close();
  });

  it('filters replay children without loading bodies', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-traffic-'));
    roots.push(root);
    const repository = new TrafficRepository(root);
    repository.upsert(flow('parent'));
    repository.upsert(flow('child', { source: 'replay', parentFlowId: 'parent' }));
    expect(repository.list({ parentFlowId: 'parent', source: 'replay' }).items.map((item) => item.id)).toEqual(['child']);
    repository.close();
  });

  it('rebuilds a deleted index from authoritative files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-traffic-'));
    roots.push(root);
    let repository = new TrafficRepository(root);
    repository.upsert(flow('flow-rebuild'));
    repository.close();
    fs.rmSync(path.join(root, '.hexestra', 'traffic', 'index.db'));
    repository = new TrafficRepository(root);
    expect(repository.list().items.map((item) => item.id)).toContain('flow-rebuild');
    repository.close();
  });

  it('deletes both the readable Flow file and its summary index', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-traffic-'));
    roots.push(root);
    const repository = new TrafficRepository(root);
    repository.upsert(flow('flow-delete'));
    const filePath = path.join(root, '.hexestra', 'traffic', 'flows', '2026-08-01', 'flow-delete.json');
    expect(repository.delete('flow-delete')).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(repository.read('flow-delete')).toBeNull();
    expect(repository.list().total).toBe(0);
    expect(repository.delete('flow-delete')).toBe(false);
    repository.close();
  });

  it('keeps bodies out of summaries', () => {
    const summary = summarizeTrafficFlow(flow('flow-large', {
      response: {
        statusCode: 200, httpVersion: 'http/1.1', headers: [],
        body: { encoding: 'utf8', data: 'secret'.repeat(10_000), byteLength: 60_000 },
      },
    }));
    expect(JSON.stringify(summary)).not.toContain('secret');
    expect(summary.responseBytes).toBe(60_000);
  });

  it('round-trips durable Burp mirror state through JSON and the query index', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-traffic-'));
    roots.push(root);
    const repository = new TrafficRepository(root);
    repository.upsert(flow('flow-mirror', {
      route: {
        burpEnabled: true,
        burpRouted: false,
        burpMode: 'mirror',
        burpMirrorState: 'failed',
        burpMirrorError: 'Bridge offline',
      },
    }));
    expect(repository.list().items[0]).toMatchObject({
      burpMode: 'mirror', burpMirrorState: 'failed', burpMirrorError: 'Bridge offline',
    });
    expect(repository.read('flow-mirror')?.route).toMatchObject({
      burpMode: 'mirror', burpMirrorState: 'failed', burpMirrorError: 'Bridge offline',
    });
    repository.close();
  });
});
