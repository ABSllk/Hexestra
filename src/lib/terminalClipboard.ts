export type TerminalClipboardAction = 'copy' | 'native-paste' | null;

export function terminalClipboardAction(
  event: Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): TerminalClipboardAction {
  if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey) || !event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'c') return 'copy';
  // Chromium dispatches a trusted `paste` event to xterm after this keydown.
  // Let xterm consume that event instead of reading the clipboard here too,
  // otherwise a single shortcut inserts the same text twice.
  if (key === 'v') return 'native-paste';
  return null;
}
