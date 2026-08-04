import { app, BrowserWindow, ipcMain, webContents } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  APP_SETTINGS_IPC,
  type AppLanguage,
  type AppSettings,
  type AppSettingsPatch,
} from '../contracts/app-settings';

const DEFAULT_SETTINGS: AppSettings = { version: 2, language: 'en', mitmdumpPath: null };

export class AppSettingsService {
  private cached: AppSettings | null = null;

  constructor() {
    ipcMain.handle(APP_SETTINGS_IPC.GET, () => this.get());
    ipcMain.handle(APP_SETTINGS_IPC.UPDATE, (_event, value: unknown) => this.update(value));
  }

  get(): AppSettings {
    if (this.cached) return { ...this.cached };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath(), 'utf8')) as unknown;
      this.cached = normalizeAppSettings(parsed);
    } catch {
      this.cached = { ...DEFAULT_SETTINGS };
    }
    return { ...this.cached };
  }

  update(value: unknown): AppSettings {
    const patch = parsePatch(value);
    const next: AppSettings = { ...this.get(), ...patch, version: 2 };
    const destination = this.settingsPath();
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, destination);
    this.cached = next;
    this.broadcast(next);
    return { ...next };
  }

  private settingsPath() {
    return path.join(app.getPath('userData'), 'app-settings.json');
  }

  private broadcast(settings: AppSettings) {
    const sent = new Set<number>();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(APP_SETTINGS_IPC.CHANGED, settings);
        sent.add(window.webContents.id);
      }
    }
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed() && !sent.has(contents.id)) {
        contents.send(APP_SETTINGS_IPC.CHANGED, settings);
      }
    }
  }
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const record = value as { language?: unknown; mitmdumpPath?: unknown };
  const mitmdumpPath = typeof record.mitmdumpPath === 'string' && record.mitmdumpPath.trim()
    ? record.mitmdumpPath.trim().slice(0, 2_000)
    : null;
  return { version: 2, language: isAppLanguage(record.language) ? record.language : 'en', mitmdumpPath };
}

function parsePatch(value: unknown): AppSettingsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid app settings');
  const record = value as { language?: unknown; mitmdumpPath?: unknown };
  const patch: AppSettingsPatch = {};
  if (record.language !== undefined) {
    if (!isAppLanguage(record.language)) throw new Error('Unsupported interface language');
    patch.language = record.language;
  }
  if (record.mitmdumpPath !== undefined) {
    if (record.mitmdumpPath !== null && typeof record.mitmdumpPath !== 'string') {
      throw new Error('Invalid mitmdump executable path');
    }
    patch.mitmdumpPath = typeof record.mitmdumpPath === 'string' && record.mitmdumpPath.trim()
      ? record.mitmdumpPath.trim().slice(0, 2_000)
      : null;
  }
  return patch;
}

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'zh-CN';
}

export const appSettingsService = new AppSettingsService();
