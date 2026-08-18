import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentConnectionSettings } from '@electron/contracts/agent-settings';
import {
  claudeRuntimeCommand,
  resolveClaudeRuntime,
  resolveWindowsClaudeNpmEntrypoint,
} from '@electron/services/claude-runtime';
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
    expect(result).toMatchObject({ executablePath: fs.realpathSync(fixture.file), source: 'explicit' });
  });

  it('uses the login-shell PATH before the Electron PATH', async () => {
    const login = executableFixture();
    const processPath = executableFixture();
    const result = await resolveClaudeRuntime(baseSettings, {
      platform: 'linux',
      environment: { PATH: processPath.root },
      resolveLoginEnvironment: async () => ({ PATH: login.root }),
    });
    expect(result).toMatchObject({ executablePath: fs.realpathSync(login.file), source: 'login-shell' });
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

  it('maps a Windows npm command shim to the Claude Code JavaScript entrypoint', () => {
    const shim = String.raw`C:\fixture\npm\claude.cmd`;
    const entrypoint = String.raw`C:\fixture\npm\node_modules\@anthropic-ai\claude-code\cli.js`;
    const localShim = String.raw`C:\fixture\project\node_modules\.bin\claude.cmd`;
    const localEntrypoint = String.raw`C:\fixture\project\node_modules\@anthropic-ai\claude-code\cli.js`;

    expect(resolveWindowsClaudeNpmEntrypoint(shim, (candidate) => candidate === entrypoint)).toBe(entrypoint);
    expect(resolveWindowsClaudeNpmEntrypoint(localShim, (candidate) => candidate === localEntrypoint)).toBe(localEntrypoint);
    expect(resolveWindowsClaudeNpmEntrypoint(String.raw`C:\tools\claude.bat`, () => true)).toBeNull();
    expect(resolveWindowsClaudeNpmEntrypoint(shim, () => false)).toBeNull();
  });

  it('runs a mapped Windows JavaScript entrypoint through Node without a shell', () => {
    const entrypoint = String.raw`C:\fixture\npm\node_modules\@anthropic-ai\claude-code\cli.js`;

    expect(claudeRuntimeCommand(entrypoint, 'win32')).toEqual({
      command: 'node',
      prefixArgs: [entrypoint],
    });
    expect(claudeRuntimeCommand('/usr/local/bin/claude', 'darwin')).toEqual({
      command: '/usr/local/bin/claude',
      prefixArgs: [],
    });
  });

  it.runIf(process.platform === 'win32')('resolves a real Windows npm shim before spawning Claude Code', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-claude-npm-shim-'));
    temporaryDirectories.push(root);
    const shim = path.join(root, 'claude.cmd');
    const entrypoint = path.join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(shim, '@echo off\r\nnode "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
    fs.writeFileSync(entrypoint, 'if (process.argv.includes("--version")) process.stdout.write("Claude Code fixture\\n");\n');

    const direct = spawnSync(shim, ['--version'], { shell: false, encoding: 'utf8' });
    expect((direct.error as NodeJS.ErrnoException | undefined)?.code).toBe('EINVAL');

    const runtime = await resolveClaudeRuntime(
      { ...baseSettings, claudeExecutable: shim },
      { platform: 'win32', environment: { PATH: path.dirname(process.execPath) } },
    );
    expect(runtime).toMatchObject({
      executablePath: fs.realpathSync(entrypoint),
      source: 'explicit',
      error: null,
    });

    const invocation = claudeRuntimeCommand(runtime.executablePath!, 'win32');
    const mapped = spawnSync(invocation.command, [...invocation.prefixArgs, '--version'], {
      env: { ...process.env, PATH: path.dirname(process.execPath) },
      shell: false,
      encoding: 'utf8',
    });
    expect(mapped.error).toBeUndefined();
    expect(mapped.status).toBe(0);
    expect(mapped.stdout).toContain('Claude Code fixture');
  });
});
