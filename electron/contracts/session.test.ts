import { describe, expect, it } from 'vitest';
import { isSessionDataChangedEvent } from './session';

describe('session data change contract', () => {
  it('accepts typed projection invalidations and rejects malformed payloads', () => {
    expect(isSessionDataChangedEvent({ sessionId: 'project-1', files: true })).toBe(true);
    expect(isSessionDataChangedEvent({ sessionId: 42, files: true })).toBe(false);
    expect(isSessionDataChangedEvent(null)).toBe(false);
  });
});
