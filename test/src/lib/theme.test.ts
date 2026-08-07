import { describe, expect, it } from 'vitest';
import { getNetMapPalette, getTerminalTheme, MONACO_THEME_NAMES } from '@/lib/theme';

describe('theme palettes', () => {
  it('keeps terminal and Monaco themes distinct without rebuilding sessions', () => {
    expect(getTerminalTheme('dark').background).toBe('#1e1e2e');
    expect(getTerminalTheme('light').background).toBe('#faf9f6');
    expect(MONACO_THEME_NAMES.dark).not.toBe(MONACO_THEME_NAMES.light);
  });

  it('provides accessible light NetMap colors for nodes, edges, and labels', () => {
    const palette = getNetMapPalette('light');
    expect(palette.shell).toBe('#f1f0ec');
    expect(palette.nodeFill).toBe('#fdfcf9');
    expect(palette.nodeLabel).toBe('#464b52');
    expect(palette.edgeLink).toBe('#2e7067');
    expect(palette.nodeColors.vulnerable).toBe('#b04c24');
  });
});
