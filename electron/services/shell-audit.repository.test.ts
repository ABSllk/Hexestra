// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ShellCommandAudit } from '../contracts/shell';
import { ShellAuditRepository } from './shell-audit.repository';

describe('ShellAuditRepository', () => {
  let directory: string;
  let repository: ShellAuditRepository;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-shell-audit-'));
    repository = new ShellAuditRepository(directory);
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('round-trips complete plaintext command output and supports search/delete', () => {
    const audit: ShellCommandAudit = {
      id: 'audit-123', projectId: 'project-1', sessionId: 'shell-1', actor: 'agent',
      approvalMode: 'default', assetId: 'asset-1', command: 'whoami',
      output: 'operator\\administrator\nTOKEN=visible-by-user-choice', truncated: false,
      outcome: 'completed', exitCode: 0,
      startedAt: '2026-08-03T00:00:00.000Z', completedAt: '2026-08-03T00:00:01.000Z',
    };
    repository.save(audit);

    const file = path.join(directory, '.hexestra', 'shell', 'audit', 'audit-123.json');
    expect(fs.readFileSync(file, 'utf8')).toContain('TOKEN=visible-by-user-choice');
    expect(repository.read('audit-123')).toEqual(audit);
    expect(repository.list('administrator')).toMatchObject([{ id: 'audit-123', outputBytes: audit.output.length }]);
    expect(repository.delete('audit-123')).toBe(true);
    expect(repository.list()).toEqual([]);
  });
});
