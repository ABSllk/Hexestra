import { describe, expect, it } from 'vitest';
import {
  normalizeClaudeMcpRuntimeStatusResult,
  sanitizeClaudeMcpRuntimeError,
} from '@electron/contracts/claude-capabilities';

describe('normalizeClaudeMcpRuntimeStatusResult', () => {
  it('keeps bounded non-secret runtime status fields and drops malformed entries', () => {
    expect(normalizeClaudeMcpRuntimeStatusResult({
      checkedAt: '2026-08-11T00:00:00.000Z',
      items: [
        { name: ' docs ', status: 'connected', error: '', scope: ' user ', toolCount: 3.9, config: { headers: { Authorization: 'secret' } } },
        { name: 'broken', status: 'unknown', error: 'ignored' },
      ],
    })).toEqual({
      checkedAt: '2026-08-11T00:00:00.000Z',
      items: [{ name: 'docs', status: 'connected', error: null, scope: 'user', toolCount: 3 }],
    });
  });

  it('rejects malformed envelopes', () => {
    expect(normalizeClaudeMcpRuntimeStatusResult({ checkedAt: null, items: [] })).toBeNull();
    expect(normalizeClaudeMcpRuntimeStatusResult({ checkedAt: 'now', items: {} })).toBeNull();
  });

  it('redacts credentials and URL queries from runtime errors', () => {
    const credentialedUrl = ['https://alice:hunter2', 'example.com/mcp?api_key=secret'].join('@');
    expect(sanitizeClaudeMcpRuntimeError(
      `Failed ${credentialedUrl} Authorization: Bearer abc token=xyz`,
    )).toBe(
      'Failed https://example.com/mcp?redacted Authorization: Bearer <redacted> token=<redacted>',
    );
  });
});
