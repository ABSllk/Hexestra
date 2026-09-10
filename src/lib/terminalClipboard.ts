import { eventMatchesShortcut } from '@electron/contracts/shortcuts';

export type TerminalClipboardAction = 'copy' | 'native-paste' | 'paste' | 'suppress-native-paste' | null;

interface TerminalClipboardBindings {
  copy: string | null;
  paste: string | null;
}

export function terminalClipboardAction(
  event: Pick<KeyboardEvent, 'type' | 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat'>,
  bindings: TerminalClipboardBindings,
  platform: NodeJS.Platform,
): TerminalClipboardAction {
  if (event.type !== 'keydown') return null;
  if (eventMatchesShortcut(event, bindings.copy, platform)) return 'copy';
  if (eventMatchesShortcut(event, bindings.paste, platform)) {
    return eventMatchesShortcut(event, 'Mod+Shift+V', platform) ? 'native-paste' : 'paste';
  }
  if (eventMatchesShortcut(event, 'Mod+Shift+V', platform)) return 'suppress-native-paste';
  return null;
}
