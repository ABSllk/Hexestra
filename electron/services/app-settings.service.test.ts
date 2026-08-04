import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  root: '',
  handle: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.root) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: mocks.handle },
  webContents: { getAllWebContents: vi.fn(() => []) },
}));

import { AppSettingsService, normalizeAppSettings } from './app-settings.service';

describe('AppSettingsService', () => {
  beforeEach(() => {
    mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-settings-'));
    vi.clearAllMocks();
  });

  afterEach(() => fs.rmSync(mocks.root, { recursive: true, force: true }));

  it('normalizes unsupported or legacy values to English', () => {
    expect(normalizeAppSettings(null)).toEqual({ version: 2, language: 'en', mitmdumpPath: null });
    expect(normalizeAppSettings({ version: 99, language: 'fr' })).toEqual({ version: 2, language: 'en', mitmdumpPath: null });
    expect(normalizeAppSettings({ version: 1, language: 'zh-CN' })).toEqual({ version: 2, language: 'zh-CN', mitmdumpPath: null });
  });

  it('migrates and bounds an optional mitmdump path', () => {
    expect(normalizeAppSettings({ version: 1, language: 'en', mitmdumpPath: '  /usr/local/bin/mitmdump  ' }))
      .toEqual({ version: 2, language: 'en', mitmdumpPath: '/usr/local/bin/mitmdump' });
  });

  it('persists the selected language and restores it in a new service instance', () => {
    const service = new AppSettingsService();
    expect(service.update({ language: 'zh-CN', mitmdumpPath: '/tmp/mitmdump' })).toEqual({ version: 2, language: 'zh-CN', mitmdumpPath: '/tmp/mitmdump' });
    expect(JSON.parse(fs.readFileSync(path.join(mocks.root, 'app-settings.json'), 'utf8'))).toEqual({ version: 2, language: 'zh-CN', mitmdumpPath: '/tmp/mitmdump' });
    expect(new AppSettingsService().get()).toEqual({ version: 2, language: 'zh-CN', mitmdumpPath: '/tmp/mitmdump' });
  });
});
