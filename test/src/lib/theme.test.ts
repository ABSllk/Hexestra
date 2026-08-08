import { describe, expect, it } from 'vitest';
import { getNetMapPalette, getTerminalTheme, MONACO_THEME_NAMES } from '@/lib/theme';

describe('theme palettes', () => {
  it('keeps terminal and Monaco themes distinct without rebuilding sessions', () => {
    expect(getTerminalTheme('dark').background).toBe('#0B0F17');
    expect(getTerminalTheme('light').background).toBe('#F4F6F8');
    expect(MONACO_THEME_NAMES.dark).not.toBe(MONACO_THEME_NAMES.light);
  });

  it('provides accessible light NetMap colors for nodes, edges, and labels', () => {
    const palette = getNetMapPalette('light');
    expect(palette.shell).toBe('#F4F6F8');
    expect(palette.nodeFill).toBe('#F8FAFC');
    expect(palette.nodeLabel).toBe('#344155');
    expect(palette.edgeLink).toBe('#0F766E');
    expect(palette.nodeColors.vulnerable).toBe('#C2410C');
  });
});
