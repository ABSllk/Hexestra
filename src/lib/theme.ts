import type { ITheme } from '@xterm/xterm';

export type ResolvedTheme = 'dark' | 'light';

export const LIGHT_THEME_COLOR_HEX = {
  canvas: '#E1E6ED',
  panel: '#EAEDF2',
  raised: '#E5E9EF',
  borderSubtle: '#C4CDD8',
  borderStrong: '#A6B2C0',
  surfaceActive: '#C5CFDB',
  textPrimary: '#1F2A3A',
  textSecondary: '#46566A',
  textMuted: '#566476',
  accentBlue: '#315F9F',
  accentRed: '#A83A50',
  accentTeal: '#176E67',
} as const;

const DARK_TERMINAL_THEME: ITheme = {
  background: '#0B0F17', foreground: '#F1F5F9', cursor: '#4F8CFF', selectionBackground: '#273244',
  black: '#273244', red: '#FB7185', green: '#6EE7B7', yellow: '#FDE68A', blue: '#4F8CFF',
  magenta: '#A78BFA', cyan: '#2DD4BF', white: '#CBD5E1', brightBlack: '#4B5B72', brightRed: '#FB7185',
  brightGreen: '#6EE7B7', brightYellow: '#FDE68A', brightBlue: '#7AA7FF', brightMagenta: '#C4B5FD',
  brightCyan: '#5EEAD4', brightWhite: '#F1F5F9',
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: LIGHT_THEME_COLOR_HEX.canvas, foreground: LIGHT_THEME_COLOR_HEX.textPrimary,
  cursor: LIGHT_THEME_COLOR_HEX.accentBlue, selectionBackground: LIGHT_THEME_COLOR_HEX.surfaceActive,
  black: LIGHT_THEME_COLOR_HEX.textSecondary, red: LIGHT_THEME_COLOR_HEX.accentRed, green: '#176B52', yellow: '#7A5B00',
  blue: LIGHT_THEME_COLOR_HEX.accentBlue, magenta: '#66519A', cyan: LIGHT_THEME_COLOR_HEX.accentTeal,
  white: LIGHT_THEME_COLOR_HEX.panel, brightBlack: LIGHT_THEME_COLOR_HEX.textMuted, brightRed: '#8F3044',
  brightGreen: '#125B46', brightYellow: '#684E00', brightBlue: '#284F86', brightMagenta: '#564381',
  brightCyan: '#125D57', brightWhite: LIGHT_THEME_COLOR_HEX.textPrimary,
};

export function getTerminalTheme(theme: ResolvedTheme): ITheme {
  return theme === 'dark' ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
}

export const MONACO_THEME_NAMES = {
  dark: 'hexestra-dark',
  light: 'hexestra-light',
} as const;

export interface NetMapPalette {
  shell: string;
  chrome: string;
  edgeBase: string;
  edgeLink: string;
  edgeResolve: string;
  edgeAttack: string;
  edgeLabelFill: string;
  edgeLabelStroke: string;
  nodeFill: string;
  nodeFocus: string;
  nodeLabel: string;
  nodeSecondaryLabel: string;
  badgeFill: string;
  badgeText: string;
  nodeColors: Record<string, string>;
}

const DARK_NETMAP_PALETTE: NetMapPalette = {
  shell: '#0B0F17', chrome: '#111827', edgeBase: '#273244', edgeLink: '#2DD4BF', edgeResolve: '#4F8CFF', edgeAttack: '#FB7185',
  edgeLabelFill: '#0B0F17', edgeLabelStroke: '#31506A', nodeFill: '#111827', nodeFocus: '#E6FFFB',
  nodeLabel: '#BED0DF', nodeSecondaryLabel: '#7C899B', badgeFill: '#2B1620', badgeText: '#FB7185',
  nodeColors: {
    untested: '#7C899B', in_progress: '#4F8CFF', scanned: '#FDE68A', vulnerable: '#FDBA74',
    compromised: '#6EE7B7', out_of_scope: '#273244',
  },
};

const LIGHT_NETMAP_PALETTE: NetMapPalette = {
  shell: LIGHT_THEME_COLOR_HEX.canvas, chrome: LIGHT_THEME_COLOR_HEX.panel, edgeBase: '#8E9CAC',
  edgeLink: LIGHT_THEME_COLOR_HEX.accentTeal, edgeResolve: LIGHT_THEME_COLOR_HEX.accentBlue,
  edgeAttack: LIGHT_THEME_COLOR_HEX.accentRed, edgeLabelFill: LIGHT_THEME_COLOR_HEX.panel,
  edgeLabelStroke: '#75869A', nodeFill: LIGHT_THEME_COLOR_HEX.raised, nodeFocus: LIGHT_THEME_COLOR_HEX.accentTeal,
  nodeLabel: '#324053', nodeSecondaryLabel: LIGHT_THEME_COLOR_HEX.textMuted, badgeFill: '#E7D7DE', badgeText: LIGHT_THEME_COLOR_HEX.accentRed,
  nodeColors: {
    untested: LIGHT_THEME_COLOR_HEX.textMuted, in_progress: LIGHT_THEME_COLOR_HEX.accentBlue, scanned: '#7A5B00', vulnerable: '#9A4521',
    compromised: '#176B52', out_of_scope: '#8E9CAC',
  },
};

export function getNetMapPalette(theme: ResolvedTheme): NetMapPalette {
  return theme === 'dark' ? DARK_NETMAP_PALETTE : LIGHT_NETMAP_PALETTE;
}
