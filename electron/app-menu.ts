import type { MenuItemConstructorOptions } from 'electron';
import {
  resolveShortcutBinding,
  toElectronAccelerator,
  type ShortcutCommandId,
  type ShortcutOverrides,
} from './contracts/shortcuts';

interface ApplicationMenuActions {
  runShortcutCommand: (commandId: ShortcutCommandId) => void;
}

export function createApplicationMenuTemplate(
  actions: ApplicationMenuActions,
  overrides: ShortcutOverrides = {},
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  const command = (label: string, id: ShortcutCommandId): MenuItemConstructorOptions => ({
    label,
    accelerator: toElectronAccelerator(resolveShortcutBinding(overrides, id), platform),
    click: () => actions.runShortcutCommand(id),
  });

  return [
    {
      label: 'File',
      submenu: [
        command('New Terminal', 'workspace.newTerminal'),
        command('Open Browser', 'workspace.openBrowser'),
        { type: 'separator' },
        command('Open Folder...', 'project.openFolder'),
        command('New Project Folder...', 'project.createFolder'),
        { type: 'separator' },
        command('Close Tab', 'tabs.closeActive'),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        command('Settings', 'settings.open'),
        command('Toggle Presentation Mode', 'presentation.toggle'),
        command('Toggle NetMap', 'view.toggleNetMap'),
        command('Open Traffic', 'view.openTraffic'),
        { type: 'separator' },
        command('Next Tab', 'tabs.next'),
        command('Previous Tab', 'tabs.previous'),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' },
      ],
    },
  ];
}
