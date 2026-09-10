import { app, BrowserWindow, ipcMain, nativeTheme, webContents } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  APP_SETTINGS_IPC,
  type AppLanguage,
  type AppSettings,
  type AppSettingsPatch,
  type AppThemePreference,
} from '../contracts/app-settings';
import { assertShortcutOverrides, normalizeShortcutOverrides, parseShortcutOverrides } from '../contracts/shortcuts';

const DEFAULT_SETTINGS: AppSettings = {
  version: 5,
  language: 'en',
  theme: 'system',
  mitmdumpPath: null,
  mihomoPath: null,
  shortcutOverrides: {},
};

export class AppSettingsService {
  private cached: AppSettings | null = null;
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor() {
    ipcMain.handle(APP_SETTINGS_IPC.GET, () => this.get());
    ipcMain.handle(APP_SETTINGS_IPC.UPDATE, (_event, value: unknown) => this.update(value));
  }

  get(): AppSettings {
    if (this.cached) return cloneSettings(this.cached);
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath(), 'utf8')) as unknown;
      this.cached = normalizeAppSettings(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(this.cached)) {
        try {
          this.persist(this.cached);
        } catch {
          // A read-only profile can still use the migrated values in memory.
        }
      }
    } catch {
      this.cached = { ...DEFAULT_SETTINGS };
      try {
        this.persist(this.cached);
      } catch {
        // A read-only profile should still be usable for this session.
      }
    }
    return cloneSettings(this.cached);
  }

  applyNativeTheme(): AppSettings {
    const settings = this.get();
    nativeTheme.themeSource = settings.theme;
    this.updateWindowBackgrounds();
    return settings;
  }

  syncNativeTheme(): AppSettings {
    const settings = this.get();
    this.updateWindowBackgrounds();
    this.broadcast(settings);
    return settings;
  }

  subscribe(listener: (settings: AppSettings) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(value: unknown): AppSettings {
    const patch = parsePatch(value);
    const next: AppSettings = { ...this.get(), ...patch, version: 5 };
    assertShortcutOverrides(next.shortcutOverrides, process.platform);
    this.persist(next);
    this.cached = next;
    nativeTheme.themeSource = next.theme;
    this.updateWindowBackgrounds();
    this.broadcast(next);
    for (const listener of this.listeners) {
      try {
        listener(cloneSettings(next));
      } catch (error) {
        console.error('[Settings] Change listener failed:', error);
      }
    }
    return cloneSettings(next);
  }

  private settingsPath() {
    return path.join(app.getPath('userData'), 'app-settings.json');
  }

  private persist(settings: AppSettings) {
    const destination = this.settingsPath();
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, destination);
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

  private updateWindowBackgrounds() {
    const background = nativeTheme.shouldUseDarkColors ? '#1e1e2e' : '#e1e6ed';
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setBackgroundColor(background);
    }
  }
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const record = value as { language?: unknown; theme?: unknown; mitmdumpPath?: unknown; mihomoPath?: unknown; shortcutOverrides?: unknown };
  const mitmdumpPath = typeof record.mitmdumpPath === 'string' && record.mitmdumpPath.trim()
    ? record.mitmdumpPath.trim().slice(0, 2_000)
    : null;
  return {
    version: 5,
    language: isAppLanguage(record.language) ? record.language : 'en',
    theme: isAppThemePreference(record.theme) ? record.theme : 'system',
    mitmdumpPath,
    mihomoPath: normalizeExecutablePath(record.mihomoPath),
    shortcutOverrides: normalizeShortcutOverrides(record.shortcutOverrides),
  };
}

function parsePatch(value: unknown): AppSettingsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid app settings');
  const record = value as { language?: unknown; theme?: unknown; mitmdumpPath?: unknown; mihomoPath?: unknown; shortcutOverrides?: unknown };
  const patch: AppSettingsPatch = {};
  if (record.language !== undefined) {
    if (!isAppLanguage(record.language)) throw new Error('Unsupported interface language');
    patch.language = record.language;
  }
  if (record.theme !== undefined) {
    if (!isAppThemePreference(record.theme)) throw new Error('Unsupported interface theme');
    patch.theme = record.theme;
  }
  if (record.mitmdumpPath !== undefined) {
    if (record.mitmdumpPath !== null && typeof record.mitmdumpPath !== 'string') {
      throw new Error('Invalid mitmdump executable path');
    }
    patch.mitmdumpPath = typeof record.mitmdumpPath === 'string' && record.mitmdumpPath.trim()
      ? record.mitmdumpPath.trim().slice(0, 2_000)
      : null;
  }
  if (record.mihomoPath !== undefined) {
    if (record.mihomoPath !== null && typeof record.mihomoPath !== 'string') {
      throw new Error('Invalid Mihomo executable path');
    }
    patch.mihomoPath = normalizeExecutablePath(record.mihomoPath);
  }
  if (record.shortcutOverrides !== undefined) {
    patch.shortcutOverrides = parseShortcutOverrides(record.shortcutOverrides);
  }
  return patch;
}

function normalizeExecutablePath(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2_000) : null;
}

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'zh-CN';
}

function isAppThemePreference(value: unknown): value is AppThemePreference {
  return value === 'system' || value === 'dark' || value === 'light';
}

function cloneSettings(settings: AppSettings): AppSettings {
  return { ...settings, shortcutOverrides: { ...settings.shortcutOverrides } };
}

export const appSettingsService = new AppSettingsService();
