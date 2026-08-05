export const DEFAULT_MONO_FONT_FAMILY =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace';

export function getMonoFontFamily(root: Element | null = document.documentElement) {
  if (!root || typeof getComputedStyle !== 'function') return DEFAULT_MONO_FONT_FAMILY;
  return getComputedStyle(root).getPropertyValue('--font-mono').trim() || DEFAULT_MONO_FONT_FAMILY;
}
