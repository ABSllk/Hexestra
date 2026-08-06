import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_CODE_FONT_SIZE_PX,
  APP_FONT_SIZE_PX,
  APP_SUPPORTING_FONT_SIZE_PX,
  DEFAULT_MONO_FONT_FAMILY,
  getMonoFontFamily,
} from './typography';

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

  it('keeps the application typography hierarchy readable', () => {
    expect(APP_SUPPORTING_FONT_SIZE_PX).toBe(11);
    expect(APP_FONT_SIZE_PX).toBe(12);
    expect(APP_CODE_FONT_SIZE_PX).toBe(13);
  });
});
