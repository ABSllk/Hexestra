import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
import { createApplicationMenuTemplate, PROJECT_MENU_EVENTS } from './app-menu';

// Services — imported for side effects (IPC handler registration)
import { terminalService } from './services/terminal.service';
import { sessionService } from './services/session.service';
import { toolExecutor } from './services/tool-executor.service';
import { agentService } from './services/agent.service';
import { browserService } from './services/browser.service';
import { claudeCapabilitiesService } from './services/claude-capabilities.service';
import { clipboardService } from './services/clipboard.service';
import { trafficService } from './services/traffic.service';
import { shellService } from './services/shell.service';
import { appSettingsService } from './services/app-settings.service';
import { dialogOverlayService } from './services/dialog-overlay.service';
import { getPlatformCapabilities } from './contracts/platform';
import { mitmproxyRuntimeService } from './services/mitmproxy-runtime.service';

console.log('[Hexestra] Starting Electron main process...');
console.log('[Hexestra] ELECTRON_RUN_AS_NODE =', process.env.ELECTRON_RUN_AS_NODE);
console.log('[Hexestra] VITE_DEV_SERVER_URL =', process.env.VITE_DEV_SERVER_URL);

// Attempt single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Hexestra] Another instance is already running. Exiting.');
  app.quit();
} else {
  console.log('[Hexestra] Single instance lock acquired.');
}

let mainWindow: BrowserWindow | null = null;

function sendProjectMenuEvent(channel: typeof PROJECT_MENU_EVENTS[keyof typeof PROJECT_MENU_EVENTS]) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send(channel);
}

function installApplicationMenu() {
  const template = createApplicationMenuTemplate({
    openFolder: () => sendProjectMenuEvent(PROJECT_MENU_EVENTS.OPEN_FOLDER),
    createProjectFolder: () => sendProjectMenuEvent(PROJECT_MENU_EVENTS.CREATE_FOLDER),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  console.log('[Hexestra] Creating main window...');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Hexestra — AI-Assisted Pentest IDE',
    backgroundColor: '#1e1e2e',
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the Vite dev server or production build
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    console.log('[Hexestra] Loading from dev server:', devUrl);
    mainWindow.loadURL(devUrl).catch((err) => {
      console.error('[Hexestra] Failed to load dev URL:', err.message);
    });
  } else {
    const prodPath = path.join(__dirname, '../dist/index.html');
    console.log('[Hexestra] Loading from production build:', prodPath);
    mainWindow.loadFile(prodPath).catch((err) => {
      console.error('[Hexestra] Failed to load production build:', err.message);
    });
  }

  // DevTools toggle: Ctrl+Shift+I in the app window
  // DevTools auto-open disabled for cleaner startup

  mainWindow.on('closed', () => {
    console.log('[Hexestra] Main window closed.');
    mainWindow = null;
  });
  mainWindow.on('maximize', () => mainWindow?.webContents.send('app:window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('app:window:maximized', false));

  // Expose window ID for PTY routing
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('app:windowId', mainWindow.id);
  });

  console.log('[Hexestra] Main window created successfully.');
}

app.whenReady().then(() => {
  console.log('[Hexestra] App ready. Services initialized.');
  void agentService.initSDK();
  installApplicationMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  console.log('[Hexestra] All windows closed. Quitting.');
  terminalService.destroyAll();
  shellService.destroyAll();
  void trafficService.close().finally(() => {
    sessionService.close();
    app.quit();
  });
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Second instance: focus existing window
app.on('second-instance', () => {
  console.log('[Hexestra] Second instance detected, focusing existing window.');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ============================================================
// Core IPC Handlers
// ============================================================
ipcMain.handle('app:ping', () => 'pong');
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getPlatform', () => process.platform);
ipcMain.handle('app:getCapabilities', () => getPlatformCapabilities());
ipcMain.handle('app:window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle('app:window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
  return window.isMaximized();
});
ipcMain.handle('app:window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
ipcMain.handle('app:window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());

void browserService;
void claudeCapabilitiesService;
void clipboardService;
void trafficService;
void shellService;
void appSettingsService;
void dialogOverlayService;
void mitmproxyRuntimeService;
