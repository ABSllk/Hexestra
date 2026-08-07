import { describe, expect, it } from 'vitest';
import { terminalClipboardAction } from '@/lib/terminalClipboard';

describe('terminalClipboardAction', () => {
  const event = (overrides: Partial<KeyboardEvent> = {}) => ({
    type: 'keydown',
    key: '',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    ...overrides,
  });

  it('recognizes terminal-safe copy and paste shortcuts', () => {
    expect(terminalClipboardAction(event({ key: 'C' }))).toBe('copy');
    expect(terminalClipboardAction(event({ key: 'v' }))).toBe('native-paste');
  });

  it('leaves Ctrl+C and unrelated keys with the PTY', () => {
    expect(terminalClipboardAction(event({ key: 'c', shiftKey: false }))).toBeNull();
    expect(terminalClipboardAction(event({ key: 'a' }))).toBeNull();
    expect(terminalClipboardAction(event({ type: 'keyup', key: 'c' }))).toBeNull();
  });
});
