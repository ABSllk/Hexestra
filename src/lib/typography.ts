export const DEFAULT_MONO_FONT_FAMILY =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Noto Sans SC", "Microsoft YaHei UI", monospace';

export const APP_FONT_SIZE_PX = 12;
export const APP_SUPPORTING_FONT_SIZE_PX = 11;
export const APP_CODE_FONT_SIZE_PX = 13;

export function getMonoFontFamily(root: Element | null = document.documentElement) {
  if (!root || typeof getComputedStyle !== 'function') return DEFAULT_MONO_FONT_FAMILY;
  return getComputedStyle(root).getPropertyValue('--font-mono').trim() || DEFAULT_MONO_FONT_FAMILY;
}
