import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MONO_FONT_FAMILY, getMonoFontFamily } from './typography';

describe('typography', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--font-mono');
  });

  it('reads the shared monospace font stack from the document', () => {
    document.documentElement.style.setProperty('--font-mono', '"Test Mono", monospace');

    expect(getMonoFontFamily()).toBe('"Test Mono", monospace');
  });

  it('falls back when the shared font variable is unavailable', () => {
    expect(getMonoFontFamily(null)).toBe(DEFAULT_MONO_FONT_FAMILY);
  });
});
