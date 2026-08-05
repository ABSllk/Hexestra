import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  ipcMain: { handle: vi.fn() },
}));

import {
  AgentSettingsService,
  agentConnectionFingerprint,
  createDefaultAgentSettings,
  normalizeAgentSettings,
} from './agent-settings.service';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Agent settings', () => {
  it('defaults Windows to the existing WSL Claude installation contract', () => {
    expect(createDefaultAgentSettings('win32')).toMatchObject({
      executionMode: 'wsl',
      wslDistribution: 'Ubuntu-24.04',
      claudeExecutable: '/usr/bin/claude',
    });
  });

  it('normalizes invalid settings and keeps at least one setting source', () => {
    expect(normalizeAgentSettings({
      executionMode: 'remote',
      settingSources: [],
      model: '   ',
    }, 'win32')).toEqual(createDefaultAgentSettings('win32'));
    expect(normalizeAgentSettings({ executionMode: 'native' }, 'win32').claudeExecutable).toBe('');
  });

  it('persists settings atomically and returns isolated snapshots', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-agent-settings-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'agent-settings.json');
    const service = new AgentSettingsService(file, false);
    const executionMode = process.platform === 'win32' ? 'wsl' : 'native';

    const updated = service.updateSettings({
      executionMode,
      wslDistribution: 'Kali-Linux',
      claudeExecutable: '/usr/local/bin/claude',
      model: 'claude-sonnet-4-5',
      settingSources: ['user', 'project'],
    });
    updated.settingSources.length = 0;

    expect(service.getSettings().settingSources).toEqual(['user', 'project']);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      wslDistribution: 'Kali-Linux',
      model: 'claude-sonnet-4-5',
    });
    expect(agentConnectionFingerprint(service.getSettings()))
      .toBe(executionMode === 'wsl'
        ? 'wsl:Kali-Linux:/usr/local/bin/claude'
        : 'native:/usr/local/bin/claude');
  });

  it('keeps application settings in the configured data directory', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-shared-data-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('HEXESTRA_USER_DATA', directory);

    const service = new AgentSettingsService(undefined, false);
    service.updateSettings({ executionMode: 'native', model: 'configured-model' });

    expect(JSON.parse(fs.readFileSync(path.join(directory, 'agent-settings.json'), 'utf8')))
      .toMatchObject({ model: 'configured-model' });
  });
});
