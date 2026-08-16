// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShellFileAuditRepository } from '@electron/services/shell-file-audit.repository';

describe('ShellFileAuditRepository', () => {
  let projectPath: string;

  beforeEach(() => { projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-file-audit-')); });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  it('persists metadata and never stores a content field', () => {
    const repository = new ShellFileAuditRepository(projectPath);
    const saved = repository.save({
      projectId: 'project-1', sessionId: 'ssh-1', assetId: 'asset-1', operation: 'write',
      remotePath: '/tmp/secret.txt', bytes: 12, sha256: 'a'.repeat(64), outcome: 'completed',
      startedAt: '2026-08-16T00:00:00.000Z', completedAt: '2026-08-16T00:00:01.000Z',
    });
    expect(saved).toMatchObject({ actor: 'agent', remotePath: '/tmp/secret.txt', bytes: 12, sha256: 'a'.repeat(64) });
    expect(saved).not.toHaveProperty('content');
    const files = repository.list();
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual(saved);
    expect(fs.readFileSync(path.join(projectPath, '.hexestra', 'shell', 'file-audit', `${saved.id}.json`), 'utf8')).not.toContain('secret body');
  });
});
