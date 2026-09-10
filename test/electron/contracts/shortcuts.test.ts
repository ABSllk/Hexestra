import { describe, expect, it } from 'vitest';
import {
  SHORTCUT_COMMANDS,
  assertShortcutOverrides,
  canonicalizeShortcutBinding,
  eventMatchesShortcut,
  normalizeShortcutOverrides,
  resolveShortcutBinding,
  shortcutBindingFromEvent,
  shortcutDisplayTokens,
  toElectronAccelerator,
} from '@electron/contracts/shortcuts';

const keyEvent = (overrides: Partial<KeyboardEvent> = {}) => ({
  key: 'h',
  altKey: false,
  ctrlKey: true,
  metaKey: false,
  shiftKey: true,
  repeat: false,
  ...overrides,
});

describe('shortcut contract', () => {
  it('defines the agreed 14 commands and resolves overrides', () => {
    expect(SHORTCUT_COMMANDS).toHaveLength(14);
    expect(resolveShortcutBinding({}, 'presentation.toggle')).toBe('Mod+Shift+H');
    expect(resolveShortcutBinding({ 'presentation.toggle': 'Mod+Alt+H' }, 'presentation.toggle')).toBe('Mod+Alt+H');
    expect(resolveShortcutBinding({ 'presentation.toggle': null }, 'presentation.toggle')).toBeNull();
  });

  it('normalizes chords and keyboard events without accepting plain typing', () => {
    expect(canonicalizeShortcutBinding('shift + mod + h')).toBe('Mod+Shift+H');
    expect(canonicalizeShortcutBinding('Shift+H')).toBeNull();
    expect(shortcutBindingFromEvent(keyEvent(), 'win32')).toBe('Mod+Shift+H');
    expect(shortcutBindingFromEvent(keyEvent({ ctrlKey: false, metaKey: true }), 'darwin')).toBe('Mod+Shift+H');
    expect(shortcutBindingFromEvent(keyEvent({ ctrlKey: false, shiftKey: false }), 'win32')).toBeNull();
  });

  it('matches each platform and renders real platform key labels', () => {
    expect(eventMatchesShortcut(keyEvent(), 'Mod+Shift+H', 'win32')).toBe(true);
    expect(eventMatchesShortcut(keyEvent({ ctrlKey: false, metaKey: true }), 'Mod+Shift+H', 'darwin')).toBe(true);
    expect(eventMatchesShortcut(keyEvent({ repeat: true }), 'Mod+Shift+H', 'win32')).toBe(false);
    expect(shortcutDisplayTokens('Mod+Shift+H', 'win32')).toEqual(['Ctrl', 'Shift', 'H']);
    expect(shortcutDisplayTokens('Mod+Shift+H', 'darwin')).toEqual(['⌘', '⇧', 'H']);
    expect(toElectronAccelerator('Mod+Comma', 'win32')).toBe('CmdOrCtrl+,');
  });

  it('drops invalid legacy values and rejects conflicts at the persistence boundary', () => {
    expect(normalizeShortcutOverrides({
      'presentation.toggle': 'mod + shift + p',
      unknown: 'Mod+X',
      'tabs.next': 'Tab',
    })).toEqual({ 'presentation.toggle': 'Mod+Shift+P' });
    expect(() => assertShortcutOverrides({ 'workspace.newTerminal': 'Mod+Shift+H' }, 'win32'))
      .toThrow(/conflicts with presentation\.toggle/);
    expect(() => assertShortcutOverrides({ 'workspace.newTerminal': 'Alt+F4' }, 'win32'))
      .toThrow(/reserved/);
    expect(() => assertShortcutOverrides({ 'workspace.newTerminal': 'Mod+C' }, 'win32'))
      .toThrow(/reserved/);
  });
});
