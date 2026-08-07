import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrafficFlow } from '@electron/contracts/traffic';
import { ReplaySessionRepository, replaySessionId } from '@electron/services/replay-session.repository';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function sourceFlow(): TrafficFlow {
  return {
    id: 'source-flow', projectId: 'project-1', revision: 1, state: 'completed',
    scopeState: 'out_of_scope', source: 'browser',
    request: {
      method: 'POST', url: 'https://example.test/api', httpVersion: 'h2',
      headers: [{ name: 'Content-Length', value: '3' }],
      body: { encoding: 'utf8', data: 'old', byteLength: 3 },
    },
    response: { statusCode: 200, httpVersion: 'h2', headers: [], body: { encoding: 'utf8', data: 'ok', byteLength: 2 } },
    timing: { startedAt: new Date(0).toISOString() }, route: { burpEnabled: false, burpRouted: false },
  };
}

describe('ReplaySessionRepository', () => {
  it('reuses one durable session per source and atomically restores edits', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-replay-'));
    roots.push(root);
    let repository = new ReplaySessionRepository(root, 'project-1');
    const opened = repository.open(sourceFlow());
    const updated = repository.update(opened, sourceFlow().request, {
      draft: { ...opened.draft, body: { encoding: 'utf8', data: 'changed', byteLength: 7 } },
      draftText: 'temporarily invalid raw draft',
      attemptFlowIds: ['attempt-1'], selectedAttemptFlowId: 'attempt-1',
    });
    repository = new ReplaySessionRepository(root, 'project-1');
    expect(repository.open(sourceFlow())).toEqual(updated);
    expect(repository.read(opened.id)?.draft.body.data).toBe('changed');
    expect(repository.read(opened.id)?.draftText).toBe('temporarily invalid raw draft');
    expect(fs.existsSync(path.join(root, '.hexestra', 'replay', 'sessions', `${opened.id}.json.tmp`))).toBe(false);
  });

  it('rejects websocket sessions and invalid identifiers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-replay-'));
    roots.push(root);
    const repository = new ReplaySessionRepository(root, 'project-1');
    expect(() => repository.open({ ...sourceFlow(), request: { ...sourceFlow().request, httpVersion: 'websocket' } })).toThrow(/WebSocket/);
    expect(() => repository.read('../escape')).toThrow(/identifier/);
    expect(replaySessionId('source-flow')).toMatch(/^replay-[a-f0-9]{32}$/);
  });

  it('protects source Flows and removes deleted attempt references', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-replay-'));
    roots.push(root);
    const repository = new ReplaySessionRepository(root, 'project-1');
    const opened = repository.open(sourceFlow());
    repository.update(opened, sourceFlow().request, {
      attemptFlowIds: ['attempt-1', 'attempt-2'],
      selectedAttemptFlowId: 'attempt-1',
    });
    expect(() => repository.removeFlowReference('source-flow')).toThrow(/Clear retained Hexestra Repeater sessions/);
    expect(() => repository.removeFlowReferences(['attempt-1', 'source-flow'])).toThrow(/Clear retained Hexestra Repeater sessions/);
    expect(repository.read(opened.id)?.attemptFlowIds).toEqual(['attempt-1', 'attempt-2']);
    expect(repository.removeFlowReference('attempt-1')).toBe(1);
    expect(repository.read(opened.id)).toMatchObject({
      attemptFlowIds: ['attempt-2'],
      selectedAttemptFlowId: undefined,
    });
  });
});
