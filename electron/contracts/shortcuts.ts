export const SHORTCUT_COMMAND_EVENT = 'shortcut:command';

export type ShortcutScope = 'application' | 'editor' | 'terminal';
export type ShortcutCategory = 'general' | 'workspace' | 'view' | 'editor' | 'terminal';

export const SHORTCUT_COMMANDS = [
  { id: 'presentation.toggle', category: 'general', scope: 'application', defaultBinding: 'Mod+Shift+H' },
  { id: 'project.openFolder', category: 'general', scope: 'application', defaultBinding: 'Mod+O' },
  { id: 'project.createFolder', category: 'general', scope: 'application', defaultBinding: 'Mod+Shift+O' },
  { id: 'workspace.newTerminal', category: 'workspace', scope: 'application', defaultBinding: 'Mod+T' },
  { id: 'workspace.openBrowser', category: 'workspace', scope: 'application', defaultBinding: 'Mod+Shift+B' },
  { id: 'settings.open', category: 'general', scope: 'application', defaultBinding: 'Mod+Comma' },
  { id: 'tabs.closeActive', category: 'workspace', scope: 'application', defaultBinding: 'Mod+W' },
  { id: 'tabs.next', category: 'workspace', scope: 'application', defaultBinding: 'Ctrl+Tab' },
  { id: 'tabs.previous', category: 'workspace', scope: 'application', defaultBinding: 'Ctrl+Shift+Tab' },
  { id: 'view.toggleNetMap', category: 'view', scope: 'application', defaultBinding: 'Mod+Shift+M' },
  { id: 'view.openTraffic', category: 'view', scope: 'application', defaultBinding: 'Mod+Shift+T' },
  { id: 'editor.save', category: 'editor', scope: 'editor', defaultBinding: 'Mod+S' },
  { id: 'terminal.copy', category: 'terminal', scope: 'terminal', defaultBinding: 'Mod+Shift+C' },
  { id: 'terminal.paste', category: 'terminal', scope: 'terminal', defaultBinding: 'Mod+Shift+V' },
] as const satisfies ReadonlyArray<{
  id: string;
  category: ShortcutCategory;
  scope: ShortcutScope;
  defaultBinding: string;
}>;

export type ShortcutCommandId = typeof SHORTCUT_COMMANDS[number]['id'];
export type ShortcutOverrides = Partial<Record<ShortcutCommandId, string | null>>;

export interface ShortcutKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
}

const COMMAND_IDS = new Set<string>(SHORTCUT_COMMANDS.map((command) => command.id));
const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift']);
const NAMED_KEYS = new Map<string, string>([
  [',', 'Comma'], ['.', 'Period'], ['/', 'Slash'], ['\\', 'Backslash'],
  [';', 'Semicolon'], ["'", 'Quote'], ['[', 'BracketLeft'], [']', 'BracketRight'],
  ['-', 'Minus'], ['=', 'Equal'], ['`', 'Backquote'], [' ', 'Space'],
  ['tab', 'Tab'], ['enter', 'Enter'], ['escape', 'Escape'],
  ['arrowup', 'ArrowUp'], ['arrowdown', 'ArrowDown'],
  ['arrowleft', 'ArrowLeft'], ['arrowright', 'ArrowRight'],
]);
const DISPLAY_KEYS: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Space: 'Space',
};

export function isShortcutCommandId(value: unknown): value is ShortcutCommandId {
  return typeof value === 'string' && COMMAND_IDS.has(value);
}

export function shortcutDefinition(id: ShortcutCommandId) {
  return SHORTCUT_COMMANDS.find((command) => command.id === id)!;
}

export function resolveShortcutBinding(overrides: ShortcutOverrides, id: ShortcutCommandId): string | null {
  return Object.prototype.hasOwnProperty.call(overrides, id)
    ? overrides[id] ?? null
    : shortcutDefinition(id).defaultBinding;
}

export function normalizeShortcutOverrides(value: unknown): ShortcutOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: ShortcutOverrides = {};
  for (const [id, binding] of Object.entries(value)) {
    if (!isShortcutCommandId(id)) continue;
    if (binding === null) {
      result[id] = null;
      continue;
    }
    if (typeof binding !== 'string') continue;
    const normalized = canonicalizeShortcutBinding(binding);
    if (normalized) result[id] = normalized;
  }
  return result;
}

export function parseShortcutOverrides(value: unknown): ShortcutOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid shortcut settings');
  const entries = Object.entries(value);
  const normalized = normalizeShortcutOverrides(value);
  if (entries.some(([id, binding]) => (
    !isShortcutCommandId(id)
      || (binding !== null && (typeof binding !== 'string' || !canonicalizeShortcutBinding(binding)))
  ))) {
    throw new Error('Invalid shortcut settings');
  }
  return normalized;
}

export function canonicalizeShortcutBinding(value: string): string | null {
  const rawTokens = value.split('+').map((token) => token.trim()).filter(Boolean);
  if (rawTokens.length < 2) return null;
  const key = normalizeKeyToken(rawTokens[rawTokens.length - 1]);
  if (!key) return null;
  const modifiers = new Set<string>();
  for (const token of rawTokens.slice(0, -1)) {
    const modifier = normalizeModifierToken(token);
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  if (![...modifiers].some((modifier) => modifier !== 'Shift')) return null;
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

export function shortcutBindingFromEvent(event: ShortcutKeyEvent, platform: NodeJS.Platform): string | null {
  if (event.repeat || MODIFIER_KEYS.has(event.key)) return null;
  const key = normalizeKeyToken(event.key);
  if (!key) return null;
  const modifiers: string[] = [];
  if (platform === 'darwin') {
    if (event.metaKey) modifiers.push('Mod');
    if (event.ctrlKey) modifiers.push('Ctrl');
  } else {
    if (event.ctrlKey) modifiers.push('Mod');
    if (event.metaKey) modifiers.push('Meta');
  }
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  return canonicalizeShortcutBinding([...modifiers, key].join('+'));
}

export function eventMatchesShortcut(
  event: ShortcutKeyEvent,
  binding: string | null,
  platform: NodeJS.Platform,
): boolean {
  if (!binding || event.repeat) return false;
  const normalized = canonicalizeShortcutBinding(binding);
  if (!normalized) return false;
  const tokens = normalized.split('+');
  const key = tokens[tokens.length - 1];
  const modifiers = new Set(tokens.slice(0, -1));
  const expectsCtrl = modifiers.has('Ctrl') || (platform !== 'darwin' && modifiers.has('Mod'));
  const expectsMeta = modifiers.has('Meta') || (platform === 'darwin' && modifiers.has('Mod'));
  return event.ctrlKey === expectsCtrl
    && event.metaKey === expectsMeta
    && event.altKey === modifiers.has('Alt')
    && event.shiftKey === modifiers.has('Shift')
    && normalizeKeyToken(event.key) === key;
}

export function shortcutDisplayTokens(binding: string | null, platform: NodeJS.Platform): string[] {
  if (!binding) return [];
  const normalized = canonicalizeShortcutBinding(binding);
  if (!normalized) return [];
  return normalized.split('+').map((token) => {
    if (token === 'Mod') return platform === 'darwin' ? '⌘' : 'Ctrl';
    if (token === 'Ctrl') return platform === 'darwin' ? '⌃' : 'Ctrl';
    if (token === 'Alt') return platform === 'darwin' ? '⌥' : 'Alt';
    if (token === 'Shift') return platform === 'darwin' ? '⇧' : 'Shift';
    if (token === 'Meta') return platform === 'darwin' ? '⌘' : 'Meta';
    return DISPLAY_KEYS[token] ?? token;
  });
}

export function formatShortcutBinding(binding: string | null, platform: NodeJS.Platform): string {
  return shortcutDisplayTokens(binding, platform).join(platform === 'darwin' ? '' : '+');
}

export function shortcutCollisionKey(binding: string, platform: NodeJS.Platform): string {
  return toElectronAccelerator(binding, platform)?.toLowerCase() ?? binding.toLowerCase();
}

export function toElectronAccelerator(binding: string | null, platform: NodeJS.Platform): string | undefined {
  if (!binding) return undefined;
  const normalized = canonicalizeShortcutBinding(binding);
  if (!normalized) return undefined;
  return normalized.split('+').map((token) => {
    if (token === 'Mod') return 'CmdOrCtrl';
    if (token === 'Ctrl') return 'Ctrl';
    if (token === 'Alt') return 'Alt';
    if (token === 'Shift') return 'Shift';
    if (token === 'Meta') return 'Super';
    if (token === 'Comma') return ',';
    if (token === 'Period') return '.';
    if (token === 'Slash') return '/';
    if (token === 'Backslash') return '\\';
    if (token === 'Semicolon') return ';';
    if (token === 'Quote') return "'";
    if (token === 'BracketLeft') return '[';
    if (token === 'BracketRight') return ']';
    if (token === 'Minus') return '-';
    if (token === 'Equal') return '=';
    if (token === 'Backquote') return '`';
    return token;
  }).join('+');
}

export function reservedShortcutReason(binding: string, platform: NodeJS.Platform): string | null {
  const collisionKey = shortcutCollisionKey(binding, platform);
  const nativeMenuBindings = new Set([
    'cmdorctrl+z', 'cmdorctrl+y', 'cmdorctrl+shift+z',
    'cmdorctrl+x', 'cmdorctrl+c', 'cmdorctrl+v', 'cmdorctrl+a',
    'cmdorctrl+r', 'cmdorctrl+shift+r', 'cmdorctrl+shift+i',
    'cmdorctrl+0', 'cmdorctrl+-', 'cmdorctrl+shift+w', 'cmdorctrl+q',
  ]);
  if (nativeMenuBindings.has(collisionKey)) return 'application';
  if (collisionKey === 'alt+f4' || collisionKey === 'ctrl+alt+delete') return 'system';
  if (platform === 'darwin' && (
    collisionKey === 'cmdorctrl+tab'
      || collisionKey === 'cmdorctrl+space'
      || collisionKey === 'cmdorctrl+m'
      || collisionKey === 'cmdorctrl+ctrl+f'
  )) return 'system';
  return null;
}

export function assertShortcutOverrides(overrides: ShortcutOverrides, platform: NodeJS.Platform) {
  const assigned = new Map<string, ShortcutCommandId>();
  for (const command of SHORTCUT_COMMANDS) {
    const binding = resolveShortcutBinding(overrides, command.id);
    if (!binding) continue;
    if (reservedShortcutReason(binding, platform)) throw new Error(`Shortcut ${binding} is reserved by the operating system`);
    const collisionKey = shortcutCollisionKey(binding, platform);
    const conflict = assigned.get(collisionKey);
    if (conflict) throw new Error(`Shortcut ${binding} conflicts with ${conflict}`);
    assigned.set(collisionKey, command.id);
  }
}

function normalizeModifierToken(value: string) {
  const token = value.toLowerCase();
  if (token === 'mod' || token === 'cmdorctrl' || token === 'commandorcontrol') return 'Mod';
  if (token === 'ctrl' || token === 'control') return 'Ctrl';
  if (token === 'alt' || token === 'option') return 'Alt';
  if (token === 'shift') return 'Shift';
  if (token === 'meta' || token === 'super') return 'Meta';
  return null;
}

function normalizeKeyToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed && value !== ' ') return null;
  const named = NAMED_KEYS.get(value.toLowerCase());
  if (named) return named;
  if (/^[a-z]$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9]$/.test(trimmed)) return trimmed;
  if (/^f(?:[1-9]|1[0-2])$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^(Tab|Enter|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Comma|Period|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote|Space)$/.test(trimmed)) return trimmed;
  return null;
}
