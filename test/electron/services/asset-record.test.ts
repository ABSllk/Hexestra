import { describe, expect, it } from 'vitest';
import {
  createAssetRecord,
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
});
