import { describe, expect, it } from 'vitest';
import { buildBrowserContextMenuModel, type BrowserContextMenuInput } from './browser-context-menu';

const base: BrowserContextMenuInput = {
  isEditable: false, selectionText: '', linkURL: '', srcURL: '', hasImageContents: false,
  editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canDelete: false, canSelectAll: true },
  canGoBack: false, canGoForward: false,
};

describe('browser context menu model', () => {
  it('uses Chromium edit flags for editable content', () => {
    const items = buildBrowserContextMenuModel({ ...base, isEditable: true, editFlags: { ...base.editFlags, canCopy: true, canPaste: true } });
    expect(items.find((item) => item.command === 'copy')?.enabled).toBe(true);
    expect(items.find((item) => item.command === 'paste')?.enabled).toBe(true);
    expect(items.find((item) => item.command === 'cut')?.enabled).toBe(false);
    expect(items.some((item) => item.command === 'ask-selection')).toBe(false);
  });

  it('adds selection, link, image and page actions only for matching contexts', () => {
    const commands = buildBrowserContextMenuModel({
      ...base, selectionText: 'selected', linkURL: 'https://example.test/link', srcURL: 'https://example.test/image.png', hasImageContents: true,
      editFlags: { ...base.editFlags, canCopy: true }, canGoBack: true,
    }).map((item) => item.command);
    expect(commands).toEqual(expect.arrayContaining(['copy', 'ask-selection', 'open-link', 'copy-link', 'ask-link', 'copy-image', 'copy-image-url', 'back', 'reload', 'ask-page']));
    expect(commands).not.toContain('paste');
  });
});
