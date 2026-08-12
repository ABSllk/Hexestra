import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const loginEnvironmentCache = new Map<string, Promise<NodeJS.ProcessEnv>>();

/** Electron injects these values into child processes; Claude and user shells must not inherit them. */
export const ELECTRON_CHILD_ENV_KEYS = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
  'NODE_OPTIONS',
]);

export interface LocalShellLaunch {
  shell: string;
  args: string[];
}

export interface LoginShellEnvironmentOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  shell?: string;
  runShell?: (shell: string, args: string[], environment: NodeJS.ProcessEnv) => Promise<Buffer | string>;
}

export function localShellLaunch(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): LocalShellLaunch {
  if (platform === 'win32') {
    return { shell: 'powershell.exe', args: [] };
  }

  const shell = environment.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { shell, args: ['-il'] };
}

/** Remove Electron/Node-only fields while preserving the user's shell configuration. */
export function sanitizeChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !ELECTRON_CHILD_ENV_KEYS.has(key)) environment[key] = value;
  }
  return environment;
}

/**
 * Resolve the environment a Finder-launched Electron process would get from the
 * user's interactive login shell. The NUL-delimited output survives non-UTF8
 * startup messages and values containing spaces/newlines.
 */
export async function resolveLoginShellEnvironment(
  options: LoginShellEnvironmentOptions = {},
): Promise<NodeJS.ProcessEnv> {
  const platform = options.platform ?? process.platform;
  const base = sanitizeChildEnvironment(options.environment ?? process.env);
  if (platform === 'win32') return base;

  const launch = localShellLaunch(platform, options.environment ?? process.env);
  const shell = options.shell ?? launch.shell;
  const runShell = options.runShell ?? defaultRunShell;
  const cacheKey = JSON.stringify([
    platform,
    shell,
    base.HOME,
    base.USER,
    base.SHELL,
    base.PATH,
    base.XDG_CONFIG_HOME,
  ]);
  if (!options.runShell) {
    const cached = loginEnvironmentCache.get(cacheKey);
    if (cached) return cached;
  }
  const pending = resolveLoginEnvironmentUncached(shell, launch.args, base, runShell);
  if (!options.runShell) loginEnvironmentCache.set(cacheKey, pending);
  return pending;
}

async function resolveLoginEnvironmentUncached(
  shell: string,
  launchArgs: string[],
  base: NodeJS.ProcessEnv,
  runShell: NonNullable<LoginShellEnvironmentOptions['runShell']>,
): Promise<NodeJS.ProcessEnv> {
  try {
    const output = await runShell(shell, [...launchArgs, '-c', "printf '\\0__HEXESTRA_ENV_START__\\0'; env -0; printf '\\0__HEXESTRA_ENV_END__\\0'"], base);
    const resolved = parseNullDelimitedEnvironment(output);
    return Object.keys(resolved).length ? sanitizeChildEnvironment({ ...base, ...resolved }) : base;
  } catch {
    // A broken shell profile must not make the terminal or diagnostics unusable.
    // The executable resolver will still try the process PATH and common paths.
    return base;
  }
}

export function parseNullDelimitedEnvironment(output: Buffer | string): NodeJS.ProcessEnv {
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  const environment: NodeJS.ProcessEnv = {};
  const records = buffer.toString('utf8').split('\0');
  const start = records.indexOf('__HEXESTRA_ENV_START__');
  const end = records.indexOf('__HEXESTRA_ENV_END__', start + 1);
  const selected = start >= 0 && end > start ? records.slice(start + 1, end) : records;
  for (const record of selected) {
    const separator = record.indexOf('=');
    if (separator <= 0) continue;
    const name = record.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    environment[name] = record.slice(separator + 1);
  }
  return environment;
}

async function defaultRunShell(
  shell: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<Buffer> {
  const result = await execFileAsync(shell, args, {
    env: environment,
    encoding: 'buffer' as never,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout));
}

export function pathEntries(environment: NodeJS.ProcessEnv, platform = process.platform): string[] {
  return (environment.PATH ?? '')
    .split(platform === 'win32' ? ';' : path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
