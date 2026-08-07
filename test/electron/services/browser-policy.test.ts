import { describe, expect, it } from 'vitest';
import {
  browserProjectPartition,
  browserRuntimeKey,
  normalizeBrowserUrl,
  sanitizeBrowserBounds,
  shouldDestroyBrowserRuntime,
} from '@electron/services/browser-policy';

describe('integrated browser policy helpers', () => {
  it('normalizes only HTTP(S) URLs', () => {
    expect(normalizeBrowserUrl('example.test/path')).toBe('https://example.test/path');
    expect(normalizeBrowserUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/');
    expect(() => normalizeBrowserUrl('file:///etc/passwd')).toThrow('Only HTTP(S) URLs are supported');
  });

  it('creates distinct project partitions and tab runtime keys', () => {
    expect(browserProjectPartition('project-a')).not.toBe(browserProjectPartition('project-b'));
    expect(browserRuntimeKey(1, { projectId: 'project-a', tabId: 'browser-1' }))
      .not.toBe(browserRuntimeKey(1, { projectId: 'project-a', tabId: 'browser-2' }));
  });

  it('rounds and clamps renderer viewport bounds', () => {
    expect(sanitizeBrowserBounds({ x: -10, y: 20.4, width: 900.6, height: 99_999 }))
      .toEqual({ x: 0, y: 20, width: 901, height: 16_384 });
  });

  it('destroys only stale tabs owned by the reconciling window', () => {
    const retained = new Set(['browser-2']);
    expect(shouldDestroyBrowserRuntime(
      { ownerId: 7, projectId: 'project-a', tabId: 'browser-1' },
      7,
      'project-a',
      retained,
    )).toBe(true);
    expect(shouldDestroyBrowserRuntime(
      { ownerId: 7, projectId: 'project-a', tabId: 'browser-2' },
      7,
      'project-a',
      retained,
    )).toBe(false);
    expect(shouldDestroyBrowserRuntime(
      { ownerId: 8, projectId: 'project-a', tabId: 'browser-1' },
      7,
      null,
      new Set(),
    )).toBe(false);
  });
});
