import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { projectDataPath } from './project-registry';

export type ShellFileAuditOperation = 'list' | 'read' | 'write' | 'mkdir' | 'rename' | 'delete_preview' | 'delete' | 'upload' | 'download';

export interface ShellFileAuditInput {
  projectId: string;
  sessionId: string;
  assetId?: string;
  operation: ShellFileAuditOperation;
  remotePath?: string;
  secondaryRemotePath?: string;
  localPath?: string;
  bytes?: number;
  sha256?: string;
  outcome: 'completed' | 'failed' | 'canceled';
  error?: string;
  startedAt: string;
  completedAt: string;
}

export interface ShellFileAudit extends ShellFileAuditInput {
  id: string;
  actor: 'agent';
}

export class ShellFileAuditRepository {
  constructor(private readonly projectPath: string) {}

  save(input: ShellFileAuditInput) {
    const audit: ShellFileAudit = {
      ...input,
      id: `file-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`,
      actor: 'agent',
    };
    const directory = this.directory();
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, `${audit.id}.json`);
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, destination);
    return audit;
  }

  list(limit = 200) {
    const bounded = Math.max(1, Math.min(1_000, Math.round(limit)));
    return this.files().map((file) => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')) as ShellFileAudit; } catch { return null; }
    }).filter((item): item is ShellFileAudit => Boolean(item)).sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, bounded);
  }

  private directory() {
    return path.join(projectDataPath(this.projectPath), 'shell', 'file-audit');
  }

  private files() {
    const directory = this.directory();
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((name) => /^file-[a-z0-9-]+\.json$/i.test(name)).map((name) => path.join(directory, name));
  }
}
