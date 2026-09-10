import { describe, expect, it } from 'vitest';
import { terminalClipboardAction } from '@/lib/terminalClipboard';

describe('terminalClipboardAction', () => {
  const event = (overrides: Partial<KeyboardEvent> = {}) => ({
    type: 'keydown',
    key: '',
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    repeat: false,
    ...overrides,
  });
  const bindings = { copy: 'Mod+Shift+C', paste: 'Mod+Shift+V' };

  it('recognizes terminal-safe copy and paste shortcuts', () => {
    expect(terminalClipboardAction(event({ key: 'C' }), bindings, 'win32')).toBe('copy');
    expect(terminalClipboardAction(event({ key: 'v' }), bindings, 'win32')).toBe('native-paste');
  });

  it('leaves Ctrl+C and unrelated keys with the PTY', () => {
    expect(terminalClipboardAction(event({ key: 'c', shiftKey: false }), bindings, 'win32')).toBeNull();
    expect(terminalClipboardAction(event({ key: 'a' }), bindings, 'win32')).toBeNull();
    expect(terminalClipboardAction(event({ type: 'keyup', key: 'c' }), bindings, 'win32')).toBeNull();
  });

  it('routes a custom paste chord through the bounded clipboard path', () => {
    expect(terminalClipboardAction(event({ key: 'p', shiftKey: false, altKey: true }), {
      copy: 'Mod+Shift+C',
      paste: 'Mod+Alt+P',
    }, 'win32')).toBe('paste');
    expect(terminalClipboardAction(event({ key: 'v' }), {
      copy: 'Mod+Shift+C',
      paste: null,
    }, 'win32')).toBe('suppress-native-paste');
  });
});
