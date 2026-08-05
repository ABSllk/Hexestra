import fs from 'fs';
import path from 'path';
import type { ShellCommandAudit } from '../contracts/shell';
import { assertShellId } from './shell-contract';
import { projectDataPath } from './project-registry';

export interface ShellAuditSummary {
  id: string;
  sessionId: string;
  assetId?: string;
  command: string;
  startedAt: string;
  completedAt: string;
  outcome: ShellCommandAudit['outcome'];
  exitCode?: number;
  outputBytes: number;
}

export class ShellAuditRepository {
  constructor(private readonly projectPath: string) {}

  save(audit: ShellCommandAudit) {
    assertShellId(audit.id, 'audit identifier');
    const directory = this.directory();
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, `${audit.id}.json`);
    const temp = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, destination);
    return audit;
  }

  list(query = '', limit = 200): ShellAuditSummary[] {
    const lowered = query.trim().toLowerCase();
    return this.files()
      .flatMap((file) => {
        try {
          const audit = this.read(path.basename(file, '.json'));
          if (lowered && !`${audit.command}\n${audit.output}`.toLowerCase().includes(lowered)) return [];
          return [{
            id: audit.id,
            sessionId: audit.sessionId,
            assetId: audit.assetId,
            command: audit.command,
            startedAt: audit.startedAt,
            completedAt: audit.completedAt,
            outcome: audit.outcome,
            exitCode: audit.exitCode,
            outputBytes: Buffer.byteLength(audit.output, 'utf8'),
          }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, Math.max(1, Math.min(1_000, Math.round(limit))));
  }

  read(id: string): ShellCommandAudit {
    assertShellId(id, 'audit identifier');
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(this.directory(), `${id}.json`), 'utf8'));
    if (!isAudit(parsed)) throw new Error('Invalid shell audit record');
    return parsed;
  }

  delete(id: string) {
    assertShellId(id, 'audit identifier');
    const target = path.join(this.directory(), `${id}.json`);
    if (!fs.existsSync(target)) return false;
    fs.unlinkSync(target);
    return true;
  }

  private directory() {
    return path.join(projectDataPath(this.projectPath), 'shell', 'audit');
  }

  private files() {
    const directory = this.directory();
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((name) => /^audit-[a-zA-Z0-9-]+\.json$/.test(name))
      .map((name) => path.join(directory, name));
  }
}

function isAudit(value: unknown): value is ShellCommandAudit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const audit = value as Partial<ShellCommandAudit>;
  return typeof audit.id === 'string'
    && typeof audit.projectId === 'string'
    && typeof audit.sessionId === 'string'
    && typeof audit.command === 'string'
    && typeof audit.output === 'string'
    && audit.actor === 'agent';
}
