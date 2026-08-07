// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ directory: '' }));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.directory) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`)),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({
      shouldReEncrypt: false,
      result: Buffer.from(value.toString().slice('encrypted:'.length), 'base64').toString(),
    })),
  },
}));

import { ShellVault } from '@electron/services/shell-vault';

describe('ShellVault', () => {
  let vault: ShellVault;

  beforeEach(() => {
    mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-shell-vault-'));
    vault = new ShellVault();
  });

  afterEach(() => fs.rmSync(mocks.directory, { recursive: true, force: true }));

  it('encrypts secret material, partitions projects, and never returns plaintext in status', async () => {
    const saved = await vault.save('project-1', {
      kind: 'private_key', label: 'Operator key', secret: 'PRIVATE KEY MATERIAL', passphrase: 'key-passphrase',
    });
    expect(vault.list('project-1')).toEqual([{ ...saved, available: true }]);
    expect(vault.list('project-2')).toEqual([]);
    expect(await vault.readSecret('project-1', saved.id)).toEqual({
      secret: 'PRIVATE KEY MATERIAL', passphrase: 'key-passphrase',
    });
    const persisted = fs.readFileSync(path.join(mocks.directory, 'shell-vault', 'project-1.json'), 'utf8');
    expect(persisted).not.toContain('PRIVATE KEY MATERIAL');
    expect(persisted).not.toContain('key-passphrase');
    expect(await vault.delete('project-1', saved.id)).toBe(true);
    expect(vault.list('project-1')).toEqual([]);
  });
});
