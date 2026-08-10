import { describe, expect, it } from 'vitest';
import {
  createAssetRecord,
  normalizeApiBase,
  normalizeStoredAsset,
  parentDomain,
} from '@electron/services/asset-record';

describe('asset records and scan discovery', () => {
  it('creates deterministic normalized domain identities', () => {
    const first = createAssetRecord('domain', '*.API.Example.COM.');
    const second = createAssetRecord('domain', 'api.example.com');

    expect(first.id).toBe(second.id);
    expect(first.key).toBe('domain:api.example.com');
    expect(parentDomain('api.dev.example.com')).toBe('dev.example.com');
  });

  it('normalizes API bases and certificate fingerprints deterministically', () => {
    expect(normalizeApiBase('HTTPS://API.EXAMPLE.COM//v1/?q=ignored#fragment')).toBe('https://api.example.com/v1');
    const credentialedApiUrl = ['https://user:secret', 'api.example.com/v1'].join('@');
    expect(normalizeApiBase(credentialedApiUrl)).toBe('https://api.example.com/v1');
    const first = createAssetRecord('certificate', 'AA:'.repeat(31) + 'AA');
    const second = createAssetRecord('certificate', 'a'.repeat(64));
    expect(first.id).toBe(second.id);
    expect(first.key).toBe(`certificate:${'A'.repeat(64)}`);
    expect(() => createAssetRecord('certificate', 'not-a-fingerprint')).toThrow(/SHA-256/);
  });

  it('normalizes corrupted persisted fields and preserves semantic properties', () => {
    const normalized = normalizeStoredAsset({
      ...createAssetRecord('webapp', 'https://EXAMPLE.com/path?q=1'),
      id: 'untrusted-id',
      status: 'unknown',
      properties: { url: 'https://example.com', nested: { secret: true } },
    });

    expect(normalized).toMatchObject({
      key: 'webapp:https://example.com',
      status: 'untested',
      properties: { url: 'https://example.com' },
    });
    expect(normalized?.properties).not.toHaveProperty('nested');
  });

  it('does not truncate supported plaintext credential properties', () => {
    const privateKey = 'K'.repeat(12_000);
    const normalized = normalizeStoredAsset({
      ...createAssetRecord('identity', 'local:realm:alice'),
      properties: { credential_private_key: privateKey },
    });
    expect(normalized?.properties.credential_private_key).toBe(privateKey);
  });
});
