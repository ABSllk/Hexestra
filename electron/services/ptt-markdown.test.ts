import { describe, expect, it } from 'vitest';
import { normalizePttMarkdown, parsePttMarkdown, updatePttTaskStatus, upsertPttTask } from './ptt-markdown';

const sample = `# PTT

## Scope
- [ ] This is not a task

## [PENDING] 1. Passive Reconnaissance (TA0043)
- [ ] Enumerate assets
  - [x] Resolve domains

## Stage 2: Active Scanning
- [ ] Scan ports

## Disengagement
- [ ] Cleanup
`;

describe('ptt-markdown', () => {
  it('parses stages and nested checkbox tasks while ignoring non-stage lists', () => {
    const tasks = parsePttMarkdown(sample);
    expect(tasks.map((task) => [task.stage, task.title, task.status])).toEqual([
      ['S1', 'Enumerate assets', 'pending'],
      ['S1', 'Resolve domains', 'completed'],
      ['S2', 'Scan ports', 'pending'],
      ['disengage', 'Cleanup', 'pending'],
    ]);
    expect(tasks[1].parentId).toBe(tasks[0].id);
  });

  it('adds stable invisible metadata without changing task text', () => {
    const first = normalizePttMarkdown(sample);
    const second = normalizePttMarkdown(first.markdown);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id));
    expect(first.markdown).toContain('<!-- hexestra:task id="');
  });

  it('updates checkbox and extended status in the canonical Markdown', () => {
    const normalized = normalizePttMarkdown(sample);
    const task = normalized.tasks.find((candidate) => candidate.title === 'Scan ports')!;
    const running = updatePttTaskStatus(normalized.markdown, task.id, 'in_progress');
    expect(running.markdown).toContain(`status="in_progress"`);
    expect(parsePttMarkdown(running.markdown).find((item) => item.id === task.id)?.status).toBe('in_progress');
    const complete = updatePttTaskStatus(running.markdown, task.id, 'completed');
    expect(complete.markdown).toContain('- [x] Scan ports');
  });

  it('upserts a child beneath its parent', () => {
    const normalized = normalizePttMarkdown(sample);
    const parent = normalized.tasks.find((task) => task.title === 'Scan ports')!;
    const result = upsertPttTask(normalized.markdown, {
      stage: 'S2',
      parentId: parent.id,
      title: 'Scan 443/tcp',
      status: 'in_progress',
    });
    expect(result.task.parentId).toBe(parent.id);
    expect(result.markdown).toContain('  - [ ] Scan 443/tcp');
  });

  it('upserts a root task inside the requested stage', () => {
    const result = upsertPttTask(sample, {
      stage: 'S1',
      title: 'Collect certificate names',
      status: 'pending',
    });
    const insertedAt = result.markdown.indexOf('- [ ] Collect certificate names');
    const nextStageAt = result.markdown.indexOf('## Stage 2: Active Scanning');
    expect(insertedAt).toBeGreaterThan(result.markdown.indexOf('## [PENDING] 1. Passive Reconnaissance'));
    expect(insertedAt).toBeLessThan(nextStageAt);
    expect(result.task.stage).toBe('S1');
    expect(result.task.parentId).toBeUndefined();
  });
});
