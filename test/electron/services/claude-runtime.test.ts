import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentConnectionSettings } from '@electron/contracts/agent-settings';
import { resolveClaudeRuntime } from '@electron/services/claude-runtime';
import { parseNullDelimitedEnvironment } from '@electron/services/shell-environment';

const temporaryDirectories: string[] = [];
const baseSettings: AgentConnectionSettings = {
  version: 1,
  executionMode: 'native',
  wslDistribution: 'Ubuntu-24.04',
  claudeExecutable: '',
  model: null,
  settingSources: ['user', 'project', 'local'],
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function executableFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-claude-runtime-'));
  temporaryDirectories.push(root);
  const file = path.join(root, 'claude');
  fs.writeFileSync(file, '#!/bin/sh\n');
  fs.chmodSync(file, 0o755);
  return { root, file };
}

describe('Claude runtime resolution', () => {
  it('ignores login-shell banners around the NUL-delimited environment', () => {
    expect(parseNullDelimitedEnvironment(Buffer.from('Welcome\0__HEXESTRA_ENV_START__\0PATH=/usr/bin\0CLAUDE_HOME=/tmp/claude\0__HEXESTRA_ENV_END__\0')))
      .toEqual({ PATH: '/usr/bin', CLAUDE_HOME: '/tmp/claude' });
  });

  it('prefers an explicit executable', async () => {
    const fixture = executableFixture();
    const result = await resolveClaudeRuntime({ ...baseSettings, claudeExecutable: fixture.file }, { platform: process.platform, environment: {} });
    expect(result).toMatchObject({ executablePath: fixture.file, source: 'explicit' });
  });

  it('uses the login-shell PATH before the Electron PATH', async () => {
    const login = executableFixture();
    const processPath = executableFixture();
    const result = await resolveClaudeRuntime(baseSettings, {
      platform: 'linux',
      environment: { PATH: processPath.root },
      resolveLoginEnvironment: async () => ({ PATH: login.root }),
    });
    expect(result).toMatchObject({ executablePath: login.file, source: 'login-shell' });
  });

  it('blocks when no local executable exists', async () => {
    const result = await resolveClaudeRuntime(baseSettings, {
      platform: 'linux',
      environment: { PATH: '' },
      resolveLoginEnvironment: async () => ({ PATH: '' }),
      homeDirectory: path.join(os.tmpdir(), 'hexestra-no-claude'),
    });
    expect(result.executablePath).toBeNull();
    expect(result.error).toContain('Claude Code was not found');
  });

  it('keeps the selected WSL path as a WSL runtime', async () => {
    const result = await resolveClaudeRuntime({ ...baseSettings, executionMode: 'wsl', claudeExecutable: '' }, { platform: 'win32' });
    expect(result).toMatchObject({ executablePath: '/usr/bin/claude', source: 'wsl' });
    expect(result.installGuidance).toContain('wsl.exe --install');
  });
});
