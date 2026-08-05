import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { appSettingsService } from './app-settings.service';
import {
  detectMitmproxyRuntime,
  type MitmproxyRuntimeDiagnostic,
} from './mitmproxy-runtime';

export class MitmproxyRuntimeService {
  constructor(registerIpc = true) {
    if (registerIpc) this.registerHandlers();
  }

  async getStatus() {
    return this.detect(appSettingsService.get().mitmdumpPath);
  }

  async detect(override = appSettingsService.get().mitmdumpPath): Promise<MitmproxyRuntimeDiagnostic> {
    return detectMitmproxyRuntime({ override });
  }

  async updatePath(value: unknown) {
    const override = value === null || value === '' ? null : normalizePath(value);
    const status = await this.detect(override);
    if (override && status.status !== 'ready') throw new Error(status.error ?? 'Selected mitmdump is not usable');
    appSettingsService.update({ mitmdumpPath: override });
    return status;
  }

  async choose() {
    const parent = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      title: 'Choose mitmdump executable',
      properties: ['openFile'],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return this.getStatus();
    return this.updatePath(result.filePaths[0]);
  }

  private registerHandlers() {
    ipcMain.handle('traffic:runtime:get', () => this.getStatus());
    ipcMain.handle('traffic:runtime:detect', () => this.detect());
    ipcMain.handle('traffic:runtime:update', (_event, value: unknown) => this.updatePath(value));
    ipcMain.handle('traffic:runtime:choose', () => this.choose());
  }
}

function normalizePath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('mitmdump executable path is required');
  return value.trim().slice(0, 2_000);
}

export const mitmproxyRuntimeService = new MitmproxyRuntimeService();
