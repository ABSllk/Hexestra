import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { createShellId } from './shell-contract';
import type { ShellCredentialInput, ShellCredentialStatus } from '../contracts/shell';

interface StoredCredential {
  id: string;
  projectId: string;
  kind: ShellCredentialInput['kind'];
  label: string;
  encrypted: string;
  createdAt: string;
  updatedAt: string;
}

interface VaultFile {
  version: 1;
  credentials: StoredCredential[];
}

export interface ShellSecret {
  secret: string;
  passphrase?: string;
}

export class ShellVault {
  private readonly queues = new Map<string, Promise<unknown>>();

  async save(projectId: string, input: ShellCredentialInput, credentialId?: string) {
    assertProjectId(projectId);
    const normalized = normalizeCredentialInput(input);
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('OS credential encryption is unavailable');
    return this.enqueue(projectId, async () => {
      const vault = this.read(projectId);
      const now = new Date().toISOString();
      const id = credentialId ?? createShellId('credential');
      const existing = vault.credentials.find((item) => item.id === id);
      const encrypted = (await safeStorage.encryptStringAsync(JSON.stringify({
        secret: normalized.secret,
        passphrase: normalized.passphrase,
      }))).toString('base64');
      const record: StoredCredential = {
        id,
        projectId,
        kind: normalized.kind,
        label: normalized.label,
        encrypted,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      vault.credentials = [...vault.credentials.filter((item) => item.id !== id), record];
      this.write(projectId, vault);
      return statusOf(record);
    });
  }

  list(projectId: string): ShellCredentialStatus[] {
    assertProjectId(projectId);
    return this.read(projectId).credentials.map(statusOf);
  }

  async readSecret(projectId: string, credentialId: string): Promise<ShellSecret> {
    assertProjectId(projectId);
    const record = this.read(projectId).credentials.find((item) => item.id === credentialId);
    if (!record) throw new Error('Shell credential is missing');
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('OS credential encryption is unavailable');
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(record.encrypted, 'base64'));
    if (decrypted.shouldReEncrypt) {
      const parsed = parseSecret(decrypted.result);
      await this.save(projectId, { kind: record.kind, label: record.label, ...parsed }, record.id);
      return parsed;
    }
    return parseSecret(decrypted.result);
  }

  async delete(projectId: string, credentialId: string) {
    assertProjectId(projectId);
    return this.enqueue(projectId, async () => {
      const vault = this.read(projectId);
      const next = vault.credentials.filter((item) => item.id !== credentialId);
      if (next.length === vault.credentials.length) return false;
      vault.credentials = next;
      this.write(projectId, vault);
      return true;
    });
  }

  private pathFor(projectId: string) {
    return path.join(app.getPath('userData'), 'shell-vault', `${projectId}.json`);
  }

  private read(projectId: string): VaultFile {
    const filePath = this.pathFor(projectId);
    if (!fs.existsSync(filePath)) return { version: 1, credentials: [] };
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.credentials)) {
        throw new Error('Invalid shell vault format');
      }
      return {
        version: 1,
        credentials: parsed.credentials.flatMap((value) => normalizeStored(value, projectId)),
      };
    } catch (error) {
      throw new Error(`Unable to read shell credential vault: ${errorMessage(error)}`);
    }
  }

  private write(projectId: string, vault: VaultFile) {
    const filePath = this.pathFor(projectId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(vault, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  }

  private enqueue<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(projectId, next);
    void next.then(
      () => { if (this.queues.get(projectId) === next) this.queues.delete(projectId); },
      () => { if (this.queues.get(projectId) === next) this.queues.delete(projectId); },
    );
    return next;
  }
}

function normalizeCredentialInput(input: ShellCredentialInput): ShellCredentialInput {
  if (!input || !isCredentialKind(input.kind)) throw new Error('Invalid shell credential kind');
  if (typeof input.label !== 'string' || !input.label.trim()) throw new Error('Credential label is required');
  if (typeof input.secret !== 'string' || !input.secret) throw new Error('Credential secret is required');
  if (Buffer.byteLength(input.secret, 'utf8') > 2 * 1024 * 1024) throw new Error('Credential secret exceeds 2 MiB');
  if (input.passphrase && Buffer.byteLength(input.passphrase, 'utf8') > 16 * 1024) throw new Error('Credential passphrase is too large');
  return {
    kind: input.kind,
    label: input.label.trim().slice(0, 100),
    secret: input.secret,
    passphrase: input.passphrase || undefined,
  };
}

function normalizeStored(value: unknown, projectId: string): StoredCredential[] {
  if (!isRecord(value) || value.projectId !== projectId || !isCredentialKind(value.kind)) return [];
  if (typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.encrypted !== 'string') return [];
  return [{
    id: value.id,
    projectId,
    kind: value.kind,
    label: value.label.slice(0, 100),
    encrypted: value.encrypted,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
  }];
}

function parseSecret(value: string): ShellSecret {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || typeof parsed.secret !== 'string') throw new Error('Invalid encrypted shell credential');
  return { secret: parsed.secret, passphrase: typeof parsed.passphrase === 'string' ? parsed.passphrase : undefined };
}

function statusOf(record: StoredCredential): ShellCredentialStatus {
  return { id: record.id, kind: record.kind, label: record.label, available: true };
}

function isCredentialKind(value: unknown): value is ShellCredentialInput['kind'] {
  return value === 'password' || value === 'private_key' || value === 'keyboard_interactive';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertProjectId(value: string) {
  if (!/^[a-zA-Z0-9-]{1,200}$/.test(value)) throw new Error('Invalid project identifier');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const shellVault = new ShellVault();
