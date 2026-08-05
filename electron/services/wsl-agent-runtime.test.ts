import { describe, expect, it, vi } from 'vitest';
import type { AgentConnectionSettings } from '../contracts/agent-settings';
import {
  buildWslEnvironment,
  buildWslSpawnArguments,
  diagnoseAgentConnection,
  windowsPathToWsl,
} from './wsl-agent-runtime';

const settings: AgentConnectionSettings = {
  version: 1,
  executionMode: 'wsl',
  wslDistribution: 'Ubuntu-24.04',
  claudeExecutable: '/usr/bin/claude',
  model: null,
  settingSources: ['user', 'project', 'local'],
};

describe('WSL Agent runtime', () => {
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
