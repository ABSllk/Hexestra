import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  root: '',
  handle: vi.fn(),
  send: vi.fn(),
  windows: [] as Array<{ isDestroyed: () => boolean; setBackgroundColor: ReturnType<typeof vi.fn>; webContents: { id: number; send: ReturnType<typeof vi.fn> } }>,
  nativeTheme: { themeSource: 'system' as 'system' | 'dark' | 'light', shouldUseDarkColors: true },
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.root) },
  BrowserWindow: { getAllWindows: vi.fn(() => mocks.windows) },
  ipcMain: { handle: mocks.handle },
  nativeTheme: mocks.nativeTheme,
  webContents: { getAllWebContents: vi.fn(() => []) },
}));

import { AppSettingsService, normalizeAppSettings } from './app-settings.service';

describe('AppSettingsService', () => {
  beforeEach(() => {
    mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-settings-'));
    mocks.windows = [];
    mocks.nativeTheme.themeSource = 'system';
    mocks.nativeTheme.shouldUseDarkColors = true;
    vi.clearAllMocks();
  });

  afterEach(() => fs.rmSync(mocks.root, { recursive: true, force: true }));

  it('normalizes unsupported or legacy values to English and system theme', () => {
    expect(normalizeAppSettings(null)).toEqual({ version: 3, language: 'en', theme: 'system', mitmdumpPath: null });
    expect(normalizeAppSettings({ version: 99, language: 'fr', theme: 'sepia' })).toEqual({ version: 3, language: 'en', theme: 'system', mitmdumpPath: null });
    expect(normalizeAppSettings({ version: 1, language: 'zh-CN' })).toEqual({ version: 3, language: 'zh-CN', theme: 'system', mitmdumpPath: null });
  });

  it('migrates and bounds an optional mitmdump path', () => {
    expect(normalizeAppSettings({ version: 1, language: 'en', mitmdumpPath: '  /usr/local/bin/mitmdump  ' }))
      .toEqual({ version: 3, language: 'en', theme: 'system', mitmdumpPath: '/usr/local/bin/mitmdump' });
  });

  it('writes normalized legacy settings back to the profile during migration', () => {
    fs.writeFileSync(path.join(mocks.root, 'app-settings.json'), JSON.stringify({ version: 2, language: 'zh-CN', mitmdumpPath: '/tmp/mitmdump' }), 'utf8');
    expect(new AppSettingsService().get()).toEqual({ version: 3, language: 'zh-CN', theme: 'system', mitmdumpPath: '/tmp/mitmdump' });
    expect(JSON.parse(fs.readFileSync(path.join(mocks.root, 'app-settings.json'), 'utf8'))).toEqual({ version: 3, language: 'zh-CN', theme: 'system', mitmdumpPath: '/tmp/mitmdump' });
  });

  it('persists the selected language and theme and restores them in a new service instance', () => {
    const service = new AppSettingsService();
    expect(service.update({ language: 'zh-CN', theme: 'light', mitmdumpPath: '/tmp/mitmdump' })).toEqual({ version: 3, language: 'zh-CN', theme: 'light', mitmdumpPath: '/tmp/mitmdump' });
    expect(mocks.nativeTheme.themeSource).toBe('light');
    expect(JSON.parse(fs.readFileSync(path.join(mocks.root, 'app-settings.json'), 'utf8'))).toEqual({ version: 3, language: 'zh-CN', theme: 'light', mitmdumpPath: '/tmp/mitmdump' });
    expect(new AppSettingsService().get()).toEqual({ version: 3, language: 'zh-CN', theme: 'light', mitmdumpPath: '/tmp/mitmdump' });
  });

  it('applies the resolved native background to open windows', () => {
    const setBackgroundColor = vi.fn();
    mocks.windows = [{ isDestroyed: () => false, setBackgroundColor, webContents: { id: 1, send: vi.fn() } }];
    mocks.nativeTheme.shouldUseDarkColors = false;
    new AppSettingsService().applyNativeTheme();
    expect(setBackgroundColor).toHaveBeenCalledWith('#f8f7f4');
  });

  it('rejects an invalid theme patch before persistence', () => {
    expect(() => new AppSettingsService().update({ theme: 'sepia' })).toThrow('Unsupported interface theme');
  });
});
