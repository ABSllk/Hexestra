import fs from 'node:fs';
import os from 'node:os';
import { posix, win32 } from 'node:path';
import type { AgentConnectionSettings, ClaudeRuntimeSource } from '../contracts/agent-settings';
import {
  pathEntries,
  resolveLoginShellEnvironment,
  sanitizeChildEnvironment,
} from './shell-environment';
import { projectProxyEnvironment } from './project-egress';

export const DEFAULT_WSL_CLAUDE_EXECUTABLE = '/usr/bin/claude';

export interface ClaudeRuntimeResolution {
  executionMode: AgentConnectionSettings['executionMode'];
  executablePath: string | null;
  source: ClaudeRuntimeSource;
  environment: NodeJS.ProcessEnv;
  error: string | null;
  installGuidance: string;
}

export interface ClaudeRuntimeResolutionOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  resolveLoginEnvironment?: (environment: NodeJS.ProcessEnv) => Promise<NodeJS.ProcessEnv>;
  projectId?: string;
}

export interface ClaudeRuntimeCommand {
  command: string;
  prefixArgs: string[];
}

export async function resolveClaudeRuntime(
  settings: AgentConnectionSettings,
  options: ClaudeRuntimeResolutionOptions = {},
): Promise<ClaudeRuntimeResolution> {
  const platform = options.platform ?? process.platform;
  const environment = sanitizeChildEnvironment(options.environment ?? process.env);
  const withProjectEnvironment = (source: NodeJS.ProcessEnv) => options.projectId
    ? sanitizeChildEnvironment(projectProxyEnvironment(options.projectId, source))
    : sanitizeChildEnvironment(source);
  const guidance = claudeInstallGuidance(settings.executionMode, platform);

  if (settings.executionMode === 'wsl') {
    const executablePath = settings.claudeExecutable.trim() || DEFAULT_WSL_CLAUDE_EXECUTABLE;
    return {
      executionMode: 'wsl',
      executablePath,
      source: 'wsl',
      environment: withProjectEnvironment(environment),
      error: null,
      installGuidance: guidance,
    };
  }

  const explicit = settings.claudeExecutable.trim();
  if (explicit) {
    const executablePath = resolveExplicitExecutable(explicit, platform, environment);
    if (executablePath) {
      return {
        executionMode: 'native',
        executablePath,
        source: 'explicit',
        environment: withProjectEnvironment(environment),
        error: null,
        installGuidance: guidance,
      };
    }
    return {
      executionMode: 'native',
      executablePath: null,
      source: 'none',
      environment: withProjectEnvironment(environment),
      error: platform === 'win32' && /\.(?:cmd|bat)$/i.test(explicit)
        ? `Configured Claude command shim could not be resolved to a runnable entrypoint: ${explicit}. Reinstall Claude Code or select claude.exe.`
        : `Configured Claude executable was not found or is not executable: ${explicit}. ${guidance}`,
      installGuidance: guidance,
    };
  }

  const resolveLoginEnvironment = options.resolveLoginEnvironment
    ?? ((base) => resolveLoginShellEnvironment({ platform, environment: base }));
  const loginEnvironment = await resolveLoginEnvironment(environment);
  const loginPath = findOnPath(loginEnvironment, platform, options.homeDirectory);
  if (loginPath) return success('login-shell', loginPath, withProjectEnvironment(loginEnvironment), guidance);

  const processPath = findOnPath(environment, platform, options.homeDirectory);
  if (processPath) return success('process-path', processPath, withProjectEnvironment(loginEnvironment), guidance);

  const standardPath = findInStandardLocations(platform, options.homeDirectory);
  if (standardPath) return success('standard-location', standardPath, withProjectEnvironment(loginEnvironment), guidance);

  return {
    executionMode: 'native',
    executablePath: null,
    source: 'none',
    environment: withProjectEnvironment(loginEnvironment),
    error: `Claude Code was not found on this machine. ${guidance}`,
    installGuidance: guidance,
  };
}

export function claudeInstallGuidance(
  executionMode: AgentConnectionSettings['executionMode'],
  platform = process.platform,
) {
  if (executionMode === 'wsl') {
    return 'If WSL is not installed, run wsl.exe --install and restart Windows; then install Claude Code inside the selected distribution and verify it with claude --version.';
  }
  if (platform === 'win32') {
    return 'Install Claude Code on Windows, add it to PATH, then restart Hexestra and verify it with claude --version.';
  }
  return 'Install Claude Code on this Mac/Linux machine, then restart Hexestra and verify it with claude --version.';
}

export function runtimeFingerprint(
  settings: AgentConnectionSettings,
  runtime: ClaudeRuntimeResolution | null,
) {
  if (settings.executionMode === 'wsl') {
    const executable = runtime?.executablePath ?? (settings.claudeExecutable || DEFAULT_WSL_CLAUDE_EXECUTABLE);
    return `wsl:${settings.wslDistribution}:${executable}`;
  }
  const executable = runtime?.executablePath ?? (settings.claudeExecutable || 'auto');
  return `native:${executable}`;
}

export function claudeRuntimeCommand(
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): ClaudeRuntimeCommand {
  if (platform === 'win32' && /\.(?:js|mjs)$/i.test(executablePath)) {
    return { command: 'node', prefixArgs: [executablePath] };
  }
  return { command: executablePath, prefixArgs: [] };
}

function success(
  source: ClaudeRuntimeSource,
  executablePath: string,
  environment: NodeJS.ProcessEnv,
  installGuidance: string,
): ClaudeRuntimeResolution {
  return {
    executionMode: 'native',
    executablePath,
    source,
    environment: sanitizeChildEnvironment(environment),
    error: null,
    installGuidance,
  };
}

function resolveExplicitExecutable(
  value: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  homeDirectory = os.homedir(),
) {
  const pathApi = platform === 'win32' ? win32 : posix;
  const candidates = pathApi.isAbsolute(value)
    ? [value]
    : pathEntries(environment, platform).flatMap((directory) => executableNames(pathApi.join(directory, value), platform));
  return candidates.map((candidate) => normalizeExecutable(candidate, platform)).find(Boolean) ?? null;
}

function findOnPath(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  _homeDirectory = os.homedir(),
) {
  const pathApi = platform === 'win32' ? win32 : posix;
  for (const directory of pathEntries(environment, platform)) {
    for (const name of executableNames(pathApi.join(directory, 'claude'), platform)) {
      const found = normalizeExecutable(name, platform);
      if (found) return found;
    }
  }
  return null;
}

function findInStandardLocations(platform: NodeJS.Platform, homeDirectory = os.homedir()) {
  const home = homeDirectory;
  const pathApi = platform === 'win32' ? win32 : posix;
  const locations = platform === 'darwin'
    ? [posix.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
    : platform === 'win32'
      ? [
          win32.join(home, '.local', 'bin', 'claude.exe'),
          win32.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          win32.join(home, 'AppData', 'Roaming', 'npm', 'claude.exe'),
        ]
      : [pathApi.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/usr/bin/claude'];
  for (const location of locations) {
    const found = executableNames(location, platform)
      .map((candidate) => normalizeExecutable(candidate, platform))
      .find(Boolean);
    if (found) return found;
  }
  return null;
}

function executableNames(candidate: string, platform: NodeJS.Platform) {
  const pathApi = platform === 'win32' ? win32 : posix;
  if (platform !== 'win32' || pathApi.extname(candidate)) return [candidate];
  return [candidate, `${candidate}.exe`, `${candidate}.cmd`, `${candidate}.bat`];
}

export function resolveWindowsClaudeNpmEntrypoint(
  shimPath: string,
  isFile: (candidate: string) => boolean = fileIsRegular,
) {
  if (win32.extname(shimPath).toLowerCase() !== '.cmd') return null;
  const directory = win32.dirname(shimPath);
  const entrypoints = [
    win32.join(directory, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    win32.join(directory, '..', '@anthropic-ai', 'claude-code', 'cli.js'),
  ];
  return entrypoints.find(isFile) ?? null;
}

function normalizeExecutable(candidate: string, platform: NodeJS.Platform): string | null {
  try {
    if (!fileIsRegular(candidate)) return null;
    if (platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
    const resolved = fs.realpathSync(candidate);
    if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(resolved)) return resolved;
    const entrypoint = resolveWindowsClaudeNpmEntrypoint(resolved);
    return entrypoint ? fs.realpathSync(entrypoint) : null;
  } catch {
    return null;
  }
}

function fileIsRegular(candidate: string) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
