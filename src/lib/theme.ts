import type { ITheme } from '@xterm/xterm';

export type ResolvedTheme = 'dark' | 'light';

const DARK_TERMINAL_THEME: ITheme = {
  background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#89b4fa', selectionBackground: '#45475a',
  black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa',
  magenta: '#cba6f7', cyan: '#94e2d5', white: '#bac2de', brightBlack: '#585b70', brightRed: '#f38ba8',
  brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5', brightWhite: '#cdd6f4',
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#faf9f6', foreground: '#24272c', cursor: '#315f9e', selectionBackground: '#dddad3',
  black: '#4c5159', red: '#b84357', green: '#39734e', yellow: '#8a6422', blue: '#315f9e',
  magenta: '#7653a6', cyan: '#2e7067', white: '#faf9f6', brightBlack: '#626a73', brightRed: '#a9374b',
  brightGreen: '#2d6240', brightYellow: '#725119', brightBlue: '#274f86', brightMagenta: '#654391',
  brightCyan: '#245e56', brightWhite: '#24272c',
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
  shell: '#050b0e', chrome: '#071014', edgeBase: '#16343a', edgeLink: '#94e2d5', edgeResolve: '#89b4fa', edgeAttack: '#f38ba8',
  edgeLabelFill: '#061014', edgeLabelStroke: '#315b65', nodeFill: '#071216', nodeFocus: '#e6fffb',
  nodeLabel: '#b7c8cb', nodeSecondaryLabel: '#58767c', badgeFill: '#170b0f', badgeText: '#f38ba8',
  nodeColors: {
    untested: '#6c7086', in_progress: '#89b4fa', scanned: '#f9e2af', vulnerable: '#fab387',
    compromised: '#a6e3a1', out_of_scope: '#45475a',
  },
};

const LIGHT_NETMAP_PALETTE: NetMapPalette = {
  shell: '#f1f0ec', chrome: '#edebe6', edgeBase: '#c1c0ba', edgeLink: '#2e7067', edgeResolve: '#315f9e', edgeAttack: '#b84357',
  edgeLabelFill: '#fcfbf8', edgeLabelStroke: '#72797c', nodeFill: '#fdfcf9', nodeFocus: '#2e7067',
  nodeLabel: '#464b52', nodeSecondaryLabel: '#626a73', badgeFill: '#f8e8e8', badgeText: '#b84357',
  nodeColors: {
    untested: '#626a73', in_progress: '#315f9e', scanned: '#8a6422', vulnerable: '#b04c24',
    compromised: '#39734e', out_of_scope: '#a1a5a8',
  },
};

export function getNetMapPalette(theme: ResolvedTheme): NetMapPalette {
  return theme === 'dark' ? DARK_NETMAP_PALETTE : LIGHT_NETMAP_PALETTE;
}
