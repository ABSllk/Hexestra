import { clipboard, ipcMain } from 'electron';

const MAX_CLIPBOARD_BYTES = 4 * 1024 * 1024;

export class ClipboardService {
  constructor(registerIpc = true) {
    if (registerIpc) this.registerHandlers();
  }

  readText() {
    const text = clipboard.readText('clipboard');
    if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_BYTES) {
      throw new Error('Clipboard text exceeds the 4 MB terminal paste limit');
    }
    return text;
  }

  writeText(value: unknown) {
    if (typeof value !== 'string') throw new Error('Clipboard text must be a string');
    if (Buffer.byteLength(value, 'utf8') > MAX_CLIPBOARD_BYTES) {
      throw new Error('Selected text exceeds the 4 MB clipboard limit');
    }
    clipboard.writeText(value, 'clipboard');
  }

  private registerHandlers() {
    ipcMain.handle('clipboard:read-text', () => this.readText());
    ipcMain.handle('clipboard:write-text', (_event, value: unknown) => this.writeText(value));
  }
}

export const clipboardService = new ClipboardService();
