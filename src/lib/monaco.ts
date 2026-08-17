import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { LIGHT_THEME_COLOR_HEX, MONACO_THEME_NAMES, type ResolvedTheme } from '@/lib/theme';

// Keep Monaco local. The default loader fetches from a public CDN, which is not
// available in many restricted testing environments.
loader.config({ monaco });

let themesRegistered = false;

/** Register the shared editor theme before an editor instance is shown. */
export function prepareMonaco(editorApi: typeof monaco, resolvedTheme: ResolvedTheme) {
  if (!themesRegistered) {
    editorApi.editor.defineTheme('hexestra-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [{ token: 'comment', foreground: '7C899B', fontStyle: 'italic' }],
      colors: {
        'editor.background': '#0B0F17',
        'editor.foreground': '#F1F5F9',
        'editorCursor.foreground': '#4F8CFF',
        'editor.selectionBackground': '#273244',
      },
    });
    editorApi.editor.defineTheme('hexestra-light', {
      base: 'vs',
      inherit: true,
      rules: [{ token: 'comment', foreground: LIGHT_THEME_COLOR_HEX.textMuted.slice(1), fontStyle: 'italic' }],
      colors: {
        'editor.background': LIGHT_THEME_COLOR_HEX.canvas,
        'editor.foreground': LIGHT_THEME_COLOR_HEX.textPrimary,
        'editorCursor.foreground': LIGHT_THEME_COLOR_HEX.accentBlue,
        'editor.selectionBackground': LIGHT_THEME_COLOR_HEX.surfaceActive,
        'editor.lineHighlightBackground': LIGHT_THEME_COLOR_HEX.raised,
      },
    });
    themesRegistered = true;
  }

  editorApi.editor.setTheme(MONACO_THEME_NAMES[resolvedTheme]);
}
