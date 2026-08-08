import type { ITheme } from '@xterm/xterm';

export type ResolvedTheme = 'dark' | 'light';

const DARK_TERMINAL_THEME: ITheme = {
  background: '#0B0F17', foreground: '#F1F5F9', cursor: '#4F8CFF', selectionBackground: '#273244',
  black: '#273244', red: '#FB7185', green: '#6EE7B7', yellow: '#FDE68A', blue: '#4F8CFF',
  magenta: '#A78BFA', cyan: '#2DD4BF', white: '#CBD5E1', brightBlack: '#4B5B72', brightRed: '#FB7185',
  brightGreen: '#6EE7B7', brightYellow: '#FDE68A', brightBlue: '#7AA7FF', brightMagenta: '#C4B5FD',
  brightCyan: '#5EEAD4', brightWhite: '#F1F5F9',
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#F4F6F8', foreground: '#172033', cursor: '#2563EB', selectionBackground: '#D8E0EA',
  black: '#526178', red: '#BE123C', green: '#047857', yellow: '#A16207', blue: '#2563EB',
  magenta: '#6D28D9', cyan: '#0F766E', white: '#FFFFFF', brightBlack: '#6B7788', brightRed: '#9F1239',
  brightGreen: '#065F46', brightYellow: '#854D0E', brightBlue: '#1D4ED8', brightMagenta: '#5B21B6',
  brightCyan: '#115E59', brightWhite: '#172033',
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
  shell: '#F4F6F8', chrome: '#FFFFFF', edgeBase: '#A9B7C8', edgeLink: '#0F766E', edgeResolve: '#2563EB', edgeAttack: '#BE123C',
  edgeLabelFill: '#FFFFFF', edgeLabelStroke: '#8494A8', nodeFill: '#F8FAFC', nodeFocus: '#0F766E',
  nodeLabel: '#344155', nodeSecondaryLabel: '#6B7788', badgeFill: '#FCE7F3', badgeText: '#BE123C',
  nodeColors: {
    untested: '#6B7788', in_progress: '#2563EB', scanned: '#A16207', vulnerable: '#C2410C',
    compromised: '#047857', out_of_scope: '#A9B7C8',
  },
};

export function getNetMapPalette(theme: ResolvedTheme): NetMapPalette {
  return theme === 'dark' ? DARK_NETMAP_PALETTE : LIGHT_NETMAP_PALETTE;
}
