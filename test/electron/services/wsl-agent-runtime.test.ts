import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConnectionSettings } from '@electron/contracts/agent-settings';
import {
  buildWslEnvironment,
  buildWslSpawnArguments,
  decodeProcessOutput,
  diagnoseAgentConnection,
  windowsPathToWsl,
} from '@electron/services/wsl-agent-runtime';

const settings: AgentConnectionSettings = {
  version: 1,
  executionMode: 'wsl',
  wslDistribution: 'Ubuntu-24.04',
  claudeExecutable: '/usr/bin/claude',
  model: null,
  settingSources: ['user', 'project', 'local'],
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('WSL Agent runtime', () => {
  it('decodes UTF-16LE WSL errors before stripping control characters', () => {
    const output = Buffer.from('无法启动 WSL：请重启计算机后重试', 'utf16le');
    expect(decodeProcessOutput(output)).toBe('无法启动 WSL：请重启计算机后重试');
  });

  it('maps only deterministic SDK working-directory forms', () => {
    expect(windowsPathToWsl('D:\\study\\项目\\Hexestra', settings.wslDistribution))
      .toBe('/mnt/d/study/项目/Hexestra');
    expect(windowsPathToWsl('\\\\wsl.localhost\\Ubuntu-24.04\\home\\testuser', settings.wslDistribution))
      .toBe('/home/testuser');
    expect(windowsPathToWsl('/mnt/d/work', settings.wslDistribution)).toBe('/mnt/d/work');
    expect(() => windowsPathToWsl('relative/path', settings.wslDistribution))
      .toThrow('Cannot map Windows path to WSL');
  });

  it('builds shell-free wsl.exe arguments and preserves SDK arguments', () => {
    expect(buildWslSpawnArguments({
      cwd: 'D:\\sessions\\engagement one',
      args: ['--output-format', 'stream-json', '--permission-mode', 'auto'],
    }, settings)).toEqual([
      '--distribution', 'Ubuntu-24.04',
      '--cd', '/mnt/d/sessions/engagement one',
      '--exec', '/usr/bin/claude',
      '--output-format', 'stream-json',
      '--permission-mode', 'auto',
    ]);
  });

  it('forwards only Agent-related variables without replacing Linux PATH or config home', () => {
    const env = buildWslEnvironment({
      PATH: 'C:\\Windows',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      CLAUDE_CONFIG_DIR: 'C:\\Users\\test\\.claude',
      ANTHROPIC_API_KEY: 'secret',
      HEXESTRA_TEST: '1',
    });

    expect(env.WSLENV).toContain('CLAUDE_CODE_ENTRYPOINT/u');
    expect(env.WSLENV).toContain('ANTHROPIC_API_KEY/u');
    expect(env.WSLENV).toContain('HEXESTRA_TEST/u');
    expect(env.WSLENV).not.toContain('CLAUDE_CONFIG_DIR');
    expect(env.WSLENV).not.toContain('PATH/u');
  });

  it.runIf(process.platform === 'win32')('diagnoses a Windows npm Claude shim through Node without a shell', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-claude-diagnostic-'));
    temporaryDirectories.push(root);
    const shim = path.join(root, 'claude.cmd');
    const entrypoint = path.join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(shim, '@echo off\r\nnode "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
    fs.writeFileSync(entrypoint, '');
    const calls: Array<{ command: string; args: string[] }> = [];
    const runFile = vi.fn(async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (args.includes('--version')) return { stdout: '2.1.0', stderr: '' };
      return { stdout: JSON.stringify({ loggedIn: true, authMethod: 'oauth' }), stderr: '' };
    });

    const diagnostic = await diagnoseAgentConnection({
      ...settings,
      executionMode: 'native',
      claudeExecutable: shim,
    }, {
      runFile,
      environment: { PATH: path.dirname(process.execPath) },
    });

    expect(diagnostic.ok).toBe(true);
    expect(calls).toContainEqual({ command: 'node', args: [fs.realpathSync(entrypoint), '--version'] });
    expect(calls).toContainEqual({
      command: 'node',
      args: [fs.realpathSync(entrypoint), 'auth', 'status', '--json'],
    });
  });

  it.skipIf(process.platform !== 'win32')('checks the ANTHROPIC_BASE_URL from WSL Claude user settings', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runFile = vi.fn(async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (args.includes('--version')) return { stdout: '2.1.0', stderr: '' };
      if (args.includes('auth')) {
        return { stdout: JSON.stringify({ loggedIn: true, authMethod: 'api_key' }), stderr: '' };
      }
      if (args.includes('/bin/cat')) {
        return {
          stdout: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' } }),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    const diagnostic = await diagnoseAgentConnection(settings, { runFile, environment: {} });
    const curlCall = calls.find(({ args }) => args.includes('/usr/bin/curl'));

    expect(curlCall?.args.at(-1)).toBe('https://api.deepseek.com/anthropic');
    expect(diagnostic.checks).toContainEqual(expect.objectContaining({
      id: 'network',
      status: 'pass',
      detail: expect.stringContaining('Claude user settings'),
    }));
  });

  it.skipIf(process.platform !== 'win32')('reports an invalid configured provider URL without probing the default endpoint', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runFile = vi.fn(async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (args.includes('--version')) return { stdout: '2.1.0', stderr: '' };
      if (args.includes('auth')) {
        return { stdout: JSON.stringify({ loggedIn: true, authMethod: 'api_key' }), stderr: '' };
      }
      return {
        stdout: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'file:///tmp/provider' } }),
        stderr: '',
      };
    });

    const diagnostic = await diagnoseAgentConnection(settings, { runFile, environment: {} });

    expect(calls.some(({ args }) => args.includes('/usr/bin/curl'))).toBe(false);
    expect(diagnostic.ok).toBe(false);
    expect(diagnostic.checks).toContainEqual(expect.objectContaining({
      id: 'network',
      status: 'fail',
      detail: expect.stringContaining('valid HTTP(S) URL'),
    }));
  });
});
