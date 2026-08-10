import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ root: '', available: true, encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock('electron', () => ({
  app: { getPath: () => mocks.root },
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => mocks.available),
    encryptStringAsync: mocks.encrypt,
    decryptStringAsync: mocks.decrypt,
  },
}));

import { EgressProxyVault } from '@electron/services/egress-proxy-vault';

describe('EgressProxyVault', () => {
  beforeEach(() => {
    mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-proxy-vault-'));
    mocks.available = true;
    mocks.encrypt.mockImplementation(async (value: string) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`));
    mocks.decrypt.mockImplementation(async (value: Buffer) => ({
      result: Buffer.from(value.toString().slice('encrypted:'.length), 'base64').toString('utf8'),
      shouldReEncrypt: false,
    }));
  });
  afterEach(() => { fs.rmSync(mocks.root, { recursive: true, force: true }); vi.clearAllMocks(); });

  it('persists only encrypted payload plus public metadata', async () => {
    const vault = new EgressProxyVault();
    const saved = await vault.save({ source: 'form', name: 'Exit', value: { type: 'trojan', server: 'proxy.test', port: 443, password: 'never-render-this' } });
    expect(saved).not.toHaveProperty('proxy');
    expect(saved).not.toHaveProperty('encrypted');
    const disk = fs.readFileSync(path.join(mocks.root, 'egress-proxy-vault.json'), 'utf8');
    expect(disk).not.toContain('never-render-this');
    expect(vault.list()).toEqual([saved]);
    expect((await vault.readNodes([saved.id]))[0].proxy.password).toBe('never-render-this');
  });

  it('updates and deletes by stable ID without exposing the payload', async () => {
    const vault = new EgressProxyVault();
    const saved = await vault.save({ source: 'form', name: 'First', value: { type: 'http', server: 'one.test', port: 8080, username: 'u', password: 'p' } });
    const updated = await vault.save({ source: 'form', name: 'Second', value: { type: 'http', server: 'two.test', port: 8081 } }, saved.id);
    expect(updated).toMatchObject({ id: saved.id, name: 'Second' });
    expect(await vault.delete(saved.id)).toBe(true);
    expect(vault.list()).toEqual([]);
  });

  it('atomically imports one URI per line and returns sanitized summaries', async () => {
    const vault = new EgressProxyVault();
    const imported = await vault.importUriBatch([
      'trojan://first-secret@192.0.2.1:443#First',
      '',
      'socks5://user:second-secret@192.0.2.2:1080#Second',
    ].join('\n'));

    expect(imported).toHaveLength(2);
    expect(imported.map(({ name, protocol }) => ({ name, protocol }))).toEqual([
      { name: 'First', protocol: 'trojan' },
      { name: 'Second', protocol: 'socks5' },
    ]);
    expect(imported.every((node) => !('encrypted' in node) && !('proxy' in node))).toBe(true);
    const disk = fs.readFileSync(path.join(mocks.root, 'egress-proxy-vault.json'), 'utf8');
    expect(disk).not.toContain('first-secret');
    expect(disk).not.toContain('second-secret');
  });

  it('does not persist a partial URI batch when a later source line is invalid', async () => {
    const vault = new EgressProxyVault();
    const existing = await vault.save({ source: 'uri', value: 'trojan://saved@192.0.2.3:443#Existing' });

    await expect(vault.importUriBatch([
      'trojan://valid@192.0.2.1:443#First',
      '',
      'socks4://invalid.test:1080',
    ].join('\n'))).rejects.toThrow('Proxy URI line 3');

    expect(vault.list()).toEqual([existing]);
  });

  it('keeps the previous vault intact when encrypting a URI batch fails midway', async () => {
    const vault = new EgressProxyVault();
    const existing = await vault.save({ source: 'uri', value: 'trojan://saved@192.0.2.3:443#Existing' });
    const vaultPath = path.join(mocks.root, 'egress-proxy-vault.json');
    const before = fs.readFileSync(vaultPath, 'utf8');
    mocks.encrypt.mockReset();
    mocks.encrypt
      .mockResolvedValueOnce(Buffer.from('encrypted:first'))
      .mockRejectedValueOnce(new Error('credential encryption failed'));

    await expect(vault.importUriBatch([
      'trojan://first@192.0.2.1:443#First',
      'trojan://second@192.0.2.2:443#Second',
    ].join('\n'))).rejects.toThrow('credential encryption failed');

    expect(vault.list()).toEqual([existing]);
    expect(fs.readFileSync(vaultPath, 'utf8')).toBe(before);
  });

  it('canonicalizes a legacy encrypted VMess node that has no cipher', async () => {
    const legacyNode = {
      id: 'node-vmess', name: 'Legacy VMess', protocol: 'vmess', tcp: true, udp: true,
      updatedAt: '2026-08-10T00:00:00.000Z',
      proxy: {
        type: 'vmess', server: 'vmess.test', port: 10808,
        uuid: '00000000-0000-4000-8000-000000000001', alterId: 0, udp: true,
      },
    };
    const encrypted = Buffer.from(`encrypted:${Buffer.from(JSON.stringify(legacyNode)).toString('base64')}`).toString('base64');
    fs.writeFileSync(path.join(mocks.root, 'egress-proxy-vault.json'), JSON.stringify({
      version: 1,
      nodes: [{
        id: legacyNode.id, name: legacyNode.name, protocol: legacyNode.protocol,
        tcp: true, udp: true, updatedAt: legacyNode.updatedAt, encrypted,
      }],
    }));

    const vault = new EgressProxyVault();
    expect((await vault.readNodes(['node-vmess']))[0].proxy.cipher).toBe('auto');
  });

  it('refuses secret persistence when OS credential encryption is unavailable', async () => {
    mocks.available = false;
    const vault = new EgressProxyVault();
    await expect(vault.save({ source: 'form', value: { type: 'http', server: 'proxy.test', port: 8080 } }))
      .rejects.toThrow('OS credential encryption is unavailable');
    expect(fs.existsSync(path.join(mocks.root, 'egress-proxy-vault.json'))).toBe(false);
  });
});
