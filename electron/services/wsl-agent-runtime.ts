import { execFile, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  SpawnedProcess,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentConnectionDiagnostic,
  AgentConnectionSettings,
  AgentDiagnosticCheck,
} from '../contracts/agent-settings';

const FORWARDED_ENV = /^(?:ANTHROPIC_|CLAUDE_|MCP_|HEXESTRA_|HTTP_PROXY$|HTTPS_PROXY$|NO_PROXY$)/i;
const EXCLUDED_ENV = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
  'PATH',
  'NODE_OPTIONS',
]);
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

type RunFile = (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

interface AgentDiagnosticDependencies {
  runFile: RunFile;
  environment: NodeJS.ProcessEnv;
}

interface ProviderEndpoint {
  url: string | null;
  source: 'environment' | 'user-settings' | 'default';
  error: string | null;
}

export function windowsPathToWsl(input: string, distribution: string) {
  const value = input.trim();
  if (!value) throw new Error('WSL working directory is empty');
  if (value.startsWith('/')) return value;

  const drivePath = value.match(/^([A-Za-z]):[\\/](.*)$/);
  if (drivePath) {
    return `/mnt/${drivePath[1].toLowerCase()}/${drivePath[2].replace(/\\/g, '/')}`;
  }

  const normalized = value.replace(/\\/g, '/');
  const wslUnc = normalized.match(/^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i);
  if (wslUnc) {
    if (wslUnc[1].toLowerCase() !== distribution.toLowerCase()) {
      throw new Error(`Path belongs to WSL distribution ${wslUnc[1]}, not ${distribution}`);
    }
    return wslUnc[2] || '/';
  }

  throw new Error(`Cannot map Windows path to WSL: ${input}`);
}

export function buildWslEnvironment(source: NodeJS.ProcessEnv) {
  const env: NodeJS.ProcessEnv = { ...source };
  const inherited = new Set(
    String(source.WSLENV ?? '')
      .split(':')
      .map((item) => item.trim())
      .filter(Boolean),
  );

  for (const [key, value] of Object.entries(source)) {
    if (!value || !FORWARDED_ENV.test(key) || EXCLUDED_ENV.has(key.toUpperCase())) continue;
    inherited.add(`${key}/u`);
  }
  env.WSLENV = [...inherited].join(':');
  return env;
}

export function buildWslSpawnArguments(
  options: Pick<SpawnOptions, 'args' | 'cwd'>,
  settings: AgentConnectionSettings,
) {
  const args = ['--distribution', settings.wslDistribution];
  if (options.cwd) {
    args.push('--cd', windowsPathToWsl(options.cwd, settings.wslDistribution));
  }
  args.push('--exec', settings.claudeExecutable, ...options.args);
  return args;
}

export function spawnClaudeCodeInWsl(
  options: SpawnOptions,
  settings: AgentConnectionSettings,
): SpawnedProcess {
  if (process.platform !== 'win32') throw new Error('WSL Agent runtime is only supported on Windows');
  const child = spawn('wsl.exe', buildWslSpawnArguments(options, settings), {
    env: buildWslEnvironment(options.env),
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const line = String(chunk).replace(/\0/g, '').trim();
    if (line) console.warn('[Agent][WSL]', line);
  });
  return child as SpawnedProcess;
}

export async function diagnoseAgentConnection(
  settings: AgentConnectionSettings,
  dependencyOverrides: Partial<AgentDiagnosticDependencies> = {},
): Promise<AgentConnectionDiagnostic> {
  if (settings.executionMode === 'wsl' && process.platform !== 'win32') {
    throw new Error('WSL Agent runtime is only supported on Windows');
  }
  const run = dependencyOverrides.runFile ?? runFile;
  const environment = dependencyOverrides.environment ?? process.env;
  const checks: AgentDiagnosticCheck[] = [];
  const command = settings.executionMode === 'wsl'
    ? 'wsl.exe'
    : settings.claudeExecutable || resolveBundledClaudeExecutable() || 'claude';
  const prefix = settings.executionMode === 'wsl'
    ? ['--distribution', settings.wslDistribution, '--exec', settings.claudeExecutable]
    : [];

  if (settings.executionMode === 'wsl') {
    checks.push({
      id: 'runtime',
      label: 'WSL runtime',
      status: 'pass',
      detail: settings.wslDistribution,
    });
  } else {
    checks.push({
      id: 'runtime',
      label: 'Native runtime',
      status: 'pass',
      detail: process.platform,
    });
  }

  try {
    const versionResult = await run(command, [...prefix, '--version']);
    const claudeVersion = firstUsefulLine(versionResult.stdout) || firstUsefulLine(versionResult.stderr);
    checks.push({
      id: 'claude',
      label: 'Claude Code',
      status: 'pass',
      detail: claudeVersion || 'Executable responded successfully',
    });

    let authenticated: boolean | null = null;
    let authMethod: string | null = null;
    try {
      const authResult = await run(command, [...prefix, 'auth', 'status', '--json']);
      const auth = parseAuthStatus(authResult.stdout);
      authenticated = auth.loggedIn;
      authMethod = auth.authMethod;
      checks.push({
        id: 'authentication',
        label: 'Authentication',
        status: auth.loggedIn ? 'pass' : 'warning',
        detail: auth.loggedIn
          ? `${auth.authMethod ?? 'authenticated'}${auth.apiProvider ? ` · ${auth.apiProvider}` : ''}`
          : 'Claude Code is not logged in',
      });
    } catch (error) {
      checks.push({
        id: 'authentication',
        label: 'Authentication',
        status: 'warning',
        detail: errorMessage(error),
      });
    }

    let networkReady = true;
    if (settings.executionMode === 'wsl') {
      const endpoint = await resolveProviderEndpoint(settings, run, environment);
      if (endpoint.error || !endpoint.url) {
        networkReady = false;
        checks.push({
          id: 'network',
          label: 'Provider network',
          status: 'fail',
          detail: endpoint.error ?? 'Could not resolve the provider endpoint',
        });
      } else {
        const endpointLabel = safeEndpointLabel(endpoint.url);
        try {
          await run('wsl.exe', [
            '--distribution', settings.wslDistribution,
            '--exec', '/usr/bin/curl',
            '--silent', '--show-error', '--output', '/dev/null',
            '--connect-timeout', '5', '--max-time', '8',
            endpoint.url,
          ]);
          checks.push({
            id: 'network',
            label: 'Provider network',
            status: 'pass',
            detail: `${endpointLabel} is reachable from WSL (${providerSourceLabel(endpoint.source)})`,
          });
        } catch {
          networkReady = false;
          checks.push({
            id: 'network',
            label: 'Provider network',
            status: 'fail',
            detail: `Cannot reach ${endpointLabel} from ${settings.wslDistribution} (${providerSourceLabel(endpoint.source)})`,
          });
        }
      }
    }

    return {
      ok: authenticated !== false && networkReady,
      checkedAt: new Date().toISOString(),
      executionMode: settings.executionMode,
      claudeVersion,
      authenticated,
      authMethod,
      checks,
    };
  } catch (error) {
    checks[0] = { ...checks[0], status: 'fail', detail: errorMessage(error) };
    checks.push({
      id: 'claude',
      label: 'Claude Code',
      status: 'fail',
      detail: errorMessage(error),
    });
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      executionMode: settings.executionMode,
      claudeVersion: null,
      authenticated: null,
      authMethod: null,
      checks,
    };
  }
}

async function resolveProviderEndpoint(
  settings: AgentConnectionSettings,
  run: RunFile,
  environment: NodeJS.ProcessEnv,
): Promise<ProviderEndpoint> {
  const inherited = environment.ANTHROPIC_BASE_URL?.trim();
  if (inherited) return validateProviderEndpoint(inherited, 'environment');
  if (!settings.settingSources.includes('user')) {
    return { url: DEFAULT_ANTHROPIC_BASE_URL, source: 'default', error: null };
  }

  let content: string;
  try {
    if (settings.executionMode === 'wsl') {
      const result = await run('wsl.exe', [
        '--distribution', settings.wslDistribution,
        '--cd', '~',
        '--exec', '/bin/cat',
        '.claude/settings.json',
      ]);
      content = result.stdout;
    } else {
      content = fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8');
    }
  } catch {
    return { url: DEFAULT_ANTHROPIC_BASE_URL, source: 'default', error: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { url: null, source: 'user-settings', error: 'Claude user settings contain invalid JSON' };
  }
  const rawUrl = isRecord(parsed) && isRecord(parsed.env) && typeof parsed.env.ANTHROPIC_BASE_URL === 'string'
    ? parsed.env.ANTHROPIC_BASE_URL.trim()
    : '';
  return rawUrl
    ? validateProviderEndpoint(rawUrl, 'user-settings')
    : { url: DEFAULT_ANTHROPIC_BASE_URL, source: 'default', error: null };
}

function validateProviderEndpoint(
  value: string,
  source: ProviderEndpoint['source'],
): ProviderEndpoint {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported protocol');
    return { url: url.toString(), source, error: null };
  } catch {
    return {
      url: null,
      source,
      error: `ANTHROPIC_BASE_URL from ${providerSourceLabel(source)} must be a valid HTTP(S) URL`,
    };
  }
}

function safeEndpointLabel(value: string) {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function providerSourceLabel(source: ProviderEndpoint['source']) {
  if (source === 'environment') return 'process environment';
  if (source === 'user-settings') return 'Claude user settings';
  return 'Claude default';
}

function resolveBundledClaudeExecutable() {
  const platform = process.platform;
  const arch = process.arch;
  const executable = platform === 'win32' ? 'claude.exe' : 'claude';
  try {
    return require.resolve(`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/${executable}`);
  } catch {
    return null;
  }
}

function runFile(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = firstUsefulLine(stderr) || error.message;
        reject(new Error(detail));
      } else {
        resolve({ stdout: stripNulls(stdout), stderr: stripNulls(stderr) });
      }
    });
  });
}

function parseAuthStatus(output: string) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Claude Code returned an invalid authentication response');
  const value = JSON.parse(output.slice(start, end + 1)) as Record<string, unknown>;
  return {
    loggedIn: value.loggedIn === true,
    authMethod: typeof value.authMethod === 'string' ? value.authMethod : null,
    apiProvider: typeof value.apiProvider === 'string' ? value.apiProvider : null,
  };
}

function stripNulls(value: string) {
  return value.replace(/\0/g, '').trim();
}

function firstUsefulLine(value: string) {
  return stripNulls(value).split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
