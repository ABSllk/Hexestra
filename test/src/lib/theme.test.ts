import { describe, expect, it } from 'vitest';
import { getNetMapPalette, getTerminalTheme, LIGHT_THEME_COLOR_HEX, MONACO_THEME_NAMES } from '@/lib/theme';

describe('theme palettes', () => {
  it('keeps terminal and Monaco themes distinct without rebuilding sessions', () => {
    expect(getTerminalTheme('dark').background).toBe('#0B0F17');
    expect(getTerminalTheme('light').background).toBe('#E1E6ED');
    expect(MONACO_THEME_NAMES.dark).not.toBe(MONACO_THEME_NAMES.light);
  });

  it('provides accessible light NetMap colors for nodes, edges, and labels', () => {
    const palette = getNetMapPalette('light');
    expect(palette.shell).toBe('#E1E6ED');
    expect(palette.nodeFill).toBe('#E5E9EF');
    expect(palette.nodeLabel).toBe('#324053');
    expect(palette.edgeLink).toBe('#176E67');
    expect(palette.nodeColors.vulnerable).toBe('#9A4521');
  });

  it('keeps low-glare light surfaces readable', () => {
    expect(LIGHT_THEME_COLOR_HEX.panel).not.toBe('#FFFFFF');
    expect(contrastRatio(LIGHT_THEME_COLOR_HEX.textPrimary, LIGHT_THEME_COLOR_HEX.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(LIGHT_THEME_COLOR_HEX.textSecondary, LIGHT_THEME_COLOR_HEX.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(LIGHT_THEME_COLOR_HEX.textMuted, LIGHT_THEME_COLOR_HEX.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#FFFFFF', LIGHT_THEME_COLOR_HEX.accentBlue)).toBeGreaterThanOrEqual(4.5);
  });
});

function contrastRatio(foreground: string, background: string) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid hex color: ${hex}`);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
