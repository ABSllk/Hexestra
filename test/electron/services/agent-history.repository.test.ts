import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConversationBranch, createDefaultProjectState } from '@electron/services/project-state';
import {
  AgentHistoryRepository,
  LIVE_RECOVERY_TAIL_BYTES,
} from '@electron/services/agent-history.repository';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createRepository() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-agent-history-'));
  temporaryDirectories.push(directory);
  return { directory, repository: new AgentHistoryRepository(directory) };
}

describe('AgentHistoryRepository', () => {
  it('pages messages and budgets activities from the newest messages first', () => {
    const { directory, repository } = createRepository();
    const branch = createConversationBranch('main', 'Main');
    repository.ensureBranch(branch);
    for (let index = 0; index < 35; index += 1) {
      repository.appendMessage('main', {
        id: `message-${index}`,
        role: 'assistant',
        content: `Message ${index}`,
        timestamp: new Date(index * 1_000).toISOString(),
        status: 'complete',
        activities: Array.from({ length: 20 }, (_, activityIndex) => ({
          id: `activity-${index}-${activityIndex}`,
          kind: 'text' as const,
          status: 'complete' as const,
          content: 'activity',
        })),
      });
    }

    const page = repository.listMessages('main');
    expect(page.items).toHaveLength(30);
    expect(page.total).toBe(35);
    expect(page.totalActivities).toBe(700);
    expect(page.items.reduce((sum, message) => sum + (message.activities?.length ?? 0), 0)).toBeLessThanOrEqual(300);
    expect(page.items.at(-1)?.id).toBe('message-34');
    expect(page.hasEarlier).toBe(true);

    const earlier = repository.listMessages('main', page.beforeCursor);
    expect(earlier.items.map((message) => message.id)).toEqual(['message-0', 'message-1', 'message-2', 'message-3', 'message-4']);
  });

  it('loads activity pages and preserves a parent prefix for child branches', () => {
    const { directory, repository } = createRepository();
    const parent = createConversationBranch('main', 'Main');
    repository.ensureBranch(parent);
    repository.appendMessage('main', {
      id: 'source', role: 'user', content: 'source', timestamp: new Date(0).toISOString(), status: 'complete',
      activities: Array.from({ length: 450 }, (_, index) => ({ id: `a-${index}`, kind: 'text' as const, status: 'complete' as const, content: 'x' })),
    });
    repository.appendMessage('main', { id: 'after', role: 'assistant', content: 'after', timestamp: new Date(1).toISOString(), status: 'complete' });

    const child = createConversationBranch('child', 'Child', { parentBranchId: 'main', forkedFromMessageId: 'source' });
    repository.createBranch(child, 'source');
    expect(repository.getMessages('child').map((message) => message.id)).toEqual(['source']);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.hexestra', 'agent-history', 'manifest.json'), 'utf8')) as { branches: Record<string, { forkBeforeSeq?: number }> };
    expect(manifest.branches.child.forkBeforeSeq).toBe(1);

    const first = repository.listActivities('main', 'source', '450');
    expect(first.items).toHaveLength(200);
    expect(first.beforeCursor).toBe('250');
    expect(first.hasEarlier).toBe(true);
  });

  it('ignores a torn tail line and rebuilds a readable index', () => {
    const { directory, repository } = createRepository();
    repository.ensureBranch(createConversationBranch('main', 'Main'));
    repository.appendMessage('main', { id: 'one', role: 'user', content: 'one', timestamp: new Date().toISOString(), status: 'complete' });
    const file = path.join(directory, '.hexestra', 'agent-history', 'branches', 'main', 'messages.jsonl');
    fs.appendFileSync(file, '{"v":1,"id":"torn"', 'utf8');
    expect(repository.getMessages('main').map((message) => message.id)).toEqual(['one']);
    expect(fs.existsSync(path.join(path.dirname(file), 'index.json'))).toBe(true);
  });

  it('migrates legacy state into JSONL records without retaining the payload in the repository manifest', () => {
    const { directory, repository } = createRepository();
    const state = createDefaultProjectState();
    state.agent.branches[0].messages = [{ id: 'legacy', role: 'user', content: 'legacy', timestamp: new Date().toISOString(), status: 'complete' }];
    repository.migrateLegacyState(state);
    expect(repository.getMessages('main').map((message) => message.id)).toEqual(['legacy']);
    expect(fs.existsSync(path.join(directory, '.hexestra', 'agent-history', 'manifest.json'))).toBe(true);
  });

  it('keeps repeated progressive live snapshots bounded to the latest record', () => {
    const { directory, repository } = createRepository();
    repository.ensureBranch(createConversationBranch('main', 'Main'));
    for (let index = 0; index < 1_000; index += 1) {
      repository.writeLive('main', {
        id: 'live-message',
        role: 'assistant',
        content: 'x'.repeat(index + 1),
        timestamp: new Date(index).toISOString(),
        status: 'streaming',
      });
    }

    const file = liveFile(directory);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(fs.statSync(file).size).toBeLessThan(2_000);
    expect(repository.readLive('main')?.message?.content).toBe('x'.repeat(1_000));
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  }, 15_000);

  it('round-trips complete live message activities and subagent state', () => {
    const { repository } = createRepository();
    repository.ensureBranch(createConversationBranch('main', 'Main'));
    const activities = Array.from({ length: 101 }, (_, index) => ({
      id: `activity-${index}`,
      kind: 'text' as const,
      status: 'complete' as const,
      content: `activity-${index}`,
    }));
    repository.writeLive('main', {
      id: 'complete-live-message',
      role: 'assistant',
      content: 'long'.repeat(30_001),
      timestamp: new Date().toISOString(),
      status: 'streaming',
      activities,
    }, [{
      id: 'subagent-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      agentType: 'worker',
      description: 'inspect project',
      prompt: 'inspect',
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activities,
    }]);

    const recovered = repository.readLive('main');
    expect(recovered?.message?.content).toHaveLength(120_004);
    expect(recovered?.message?.activities).toEqual(activities);
    expect(recovered?.subagentRuns?.[0]).toMatchObject({
      id: 'subagent-1',
      status: 'running',
      activities,
    });
  });

  it('promotes interrupted live state into finalized history before clearing recovery', () => {
    const { directory, repository } = createRepository();
    repository.ensureBranch(createConversationBranch('main', 'Main'));
    const completedRun = {
      id: 'subagent-complete',
      taskId: 'task-complete',
      agentId: 'agent-complete',
      agentType: 'worker',
      description: 'already complete',
      status: 'completed' as const,
      startedAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:02.000Z',
      endedAt: '2026-08-15T00:00:02.000Z',
      activities: [],
    };
    repository.appendSubagent('main', completedRun);
    repository.writeLive('main', {
      id: 'interrupted-message',
      role: 'assistant',
      content: 'complete recovered text',
      timestamp: '2026-08-15T00:00:03.000Z',
      status: 'streaming',
      activities: [{
        id: 'recovered-activity',
        kind: 'text',
        status: 'complete',
        content: 'kept',
      }],
    }, [{ ...completedRun, status: 'running' }, {
      id: 'subagent-running',
      taskId: 'task-running',
      agentId: 'agent-running',
      agentType: 'worker',
      description: 'interrupted work',
      status: 'running',
      startedAt: '2026-08-15T00:00:01.000Z',
      updatedAt: '2026-08-15T00:00:02.000Z',
      activities: [],
    }]);

    const recovered = repository.recoverLive('main');
    expect(recovered?.message).toMatchObject({
      id: 'interrupted-message',
      status: 'interrupted',
      content: 'complete recovered text',
    });
    expect(recovered?.subagentRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'subagent-complete', status: 'completed' }),
      expect.objectContaining({
        id: 'subagent-running',
        status: 'interrupted',
        endedAt: recovered?.timestamp,
        updatedAt: recovered?.timestamp,
      }),
    ]));
    expect(repository.readLive('main')).toBeNull();

    const reopened = new AgentHistoryRepository(directory);
    expect(reopened.getMessages('main')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'interrupted-message',
        status: 'interrupted',
        activities: [expect.objectContaining({ id: 'recovered-activity' })],
      }),
    ]));
    expect(reopened.getSubagentRuns('main')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'subagent-complete', status: 'completed' }),
      expect.objectContaining({ id: 'subagent-running', status: 'interrupted' }),
    ]));
  });

  it('recovers the latest valid legacy record from a torn tail and compacts it', () => {
    const { directory, repository } = createRepository();
    repository.ensureBranch(createConversationBranch('main', 'Main'));
    const file = liveFile(directory);
    const first = liveRecord('first', 'first');
    const latest = liveRecord('latest', 'latest');
    fs.writeFileSync(file, `${JSON.stringify(first)}\n${JSON.stringify(latest)}\n{"v":1,"timestamp":`, 'utf8');

    expect(repository.readLive('main')?.message?.id).toBe('latest');
    const compactedLines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    expect(compactedLines).toHaveLength(1);
    expect((JSON.parse(compactedLines[0]) as { message: { id: string } }).message.id).toBe('latest');
  });

  it('reads only the bounded tail of an oversized legacy journal', () => {
    const { directory, repository } = createRepository();
    repository.ensureBranch(createConversationBranch('main', 'Main'));
    const file = liveFile(directory);
    const descriptor = fs.openSync(file, 'w');
    try {
      fs.writeSync(descriptor, Buffer.from([0]), 0, 1, LIVE_RECOVERY_TAIL_BYTES + 1024);
      const latest = Buffer.from(`\n${JSON.stringify(liveRecord('tail', 'tail'))}\n`);
      fs.writeSync(descriptor, latest, 0, latest.length, LIVE_RECOVERY_TAIL_BYTES + 1025);
    } finally {
      fs.closeSync(descriptor);
    }

    expect(repository.readLive('main')?.message?.id).toBe('tail');
    expect(fs.statSync(file).size).toBeLessThan(2_000);
  });

  it('clears the canonical and temporary live recovery files', () => {
    const { directory, repository } = createRepository();
    repository.ensureBranch(createConversationBranch('main', 'Main'));
    repository.writeLive('main', liveRecord('live', 'live').message);
    const file = liveFile(directory);
    fs.writeFileSync(`${file}.tmp`, 'stale', 'utf8');

    repository.clearLive('main');

    expect(fs.readFileSync(file, 'utf8')).toBe('');
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });
});

function liveFile(directory: string) {
  return path.join(directory, '.hexestra', 'agent-history', 'branches', 'main', 'live.jsonl');
}

function liveRecord(id: string, content: string) {
  return {
    v: 1,
    timestamp: new Date().toISOString(),
    message: {
      id,
      role: 'assistant' as const,
      content,
      timestamp: new Date().toISOString(),
      status: 'streaming' as const,
    },
  };
}
