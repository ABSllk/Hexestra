import type { MenuItemConstructorOptions } from 'electron';

export const PROJECT_MENU_EVENTS = {
  OPEN_FOLDER: 'menu:open-folder',
  CREATE_FOLDER: 'menu:create-project-folder',
} as const;

interface ProjectMenuActions {
  openFolder: () => void;
  createProjectFolder: () => void;
}

export function createApplicationMenuTemplate(
  actions: ProjectMenuActions,
): MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: () => actions.openFolder(),
        },
        {
          label: 'New Project Folder...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => actions.createProjectFolder(),
        },
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
        { role: 'close' },
      ],
    },
  ];
}
