import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { createApplicationMenuTemplate } from '@electron/app-menu';

function submenuOf(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  if (!Array.isArray(item.submenu)) throw new Error('Expected an array submenu');
  return item.submenu;
}

describe('application menu', () => {
  it('exposes the folder project actions in File and delegates to shared callbacks', () => {
    const runShortcutCommand = vi.fn();
    const menu = createApplicationMenuTemplate({ runShortcutCommand }, {}, 'win32');
    const fileMenu = menu.find((item) => item.label === 'File');

    expect(fileMenu).toBeDefined();
    const items = submenuOf(fileMenu!);
    const openItem = items.find((item) => item.label === 'Open Folder...');
    const createItem = items.find((item) => item.label === 'New Project Folder...');

    expect(openItem?.accelerator).toBe('CmdOrCtrl+O');
    expect(createItem?.accelerator).toBe('CmdOrCtrl+Shift+O');

    (openItem?.click as (() => void) | undefined)?.();
    (createItem?.click as (() => void) | undefined)?.();

    expect(runShortcutCommand).toHaveBeenNthCalledWith(1, 'project.openFolder');
    expect(runShortcutCommand).toHaveBeenNthCalledWith(2, 'project.createFolder');
  });

  it('uses persisted accelerators and disables cleared commands', () => {
    const menu = createApplicationMenuTemplate({ runShortcutCommand: vi.fn() }, {
      'project.openFolder': 'Mod+Alt+O',
      'workspace.newTerminal': null,
    }, 'win32');
    const fileItems = submenuOf(menu.find((item) => item.label === 'File')!);
    expect(fileItems.find((item) => item.label === 'Open Folder...')?.accelerator).toBe('CmdOrCtrl+Alt+O');
    expect(fileItems.find((item) => item.label === 'New Terminal')?.accelerator).toBeUndefined();
  });
});
