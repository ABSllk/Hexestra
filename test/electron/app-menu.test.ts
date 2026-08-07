import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { createApplicationMenuTemplate } from '@electron/app-menu';

function submenuOf(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  if (!Array.isArray(item.submenu)) throw new Error('Expected an array submenu');
  return item.submenu;
}

describe('application menu', () => {
  it('exposes the folder project actions in File and delegates to shared callbacks', () => {
    const openFolder = vi.fn();
    const createProjectFolder = vi.fn();
    const menu = createApplicationMenuTemplate({ openFolder, createProjectFolder });
    const fileMenu = menu.find((item) => item.label === 'File');

    expect(fileMenu).toBeDefined();
    const items = submenuOf(fileMenu!);
    const openItem = items.find((item) => item.label === 'Open Folder...');
    const createItem = items.find((item) => item.label === 'New Project Folder...');

    expect(openItem?.accelerator).toBe('CmdOrCtrl+O');
    expect(createItem?.accelerator).toBe('CmdOrCtrl+Shift+O');

    (openItem?.click as (() => void) | undefined)?.();
    (createItem?.click as (() => void) | undefined)?.();

    expect(openFolder).toHaveBeenCalledOnce();
    expect(createProjectFolder).toHaveBeenCalledOnce();
  });
});
