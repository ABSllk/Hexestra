import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const MITMPROXY_VERSION = '12.2.3';

export type MitmproxyRuntimeStatus = 'ready' | 'missing' | 'incompatible';
export type MitmproxyRuntimeSource = 'manual' | 'environment' | 'path' | 'common' | 'none';

export interface MitmproxyRuntimeDiagnostic {
  status: MitmproxyRuntimeStatus;
  requiredVersion: string;
  executablePath: string | null;
  version: string | null;
  source: MitmproxyRuntimeSource;
  error: string | null;
}

export interface MitmproxyRuntimeSearch {
  override?: string | null;
  environmentPath?: string | null;
  pathValue?: string | null;
  resourcesPath?: string;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  cwd?: string;
}

export interface MitmproxyCandidate {
  executablePath: string;
  source: Exclude<MitmproxyRuntimeSource, 'none'>;
}

export function listMitmdumpCandidates(search: MitmproxyRuntimeSearch = {}): MitmproxyCandidate[] {
  const platform = search.platform ?? process.platform;
  const executableName = platform === 'win32' ? 'mitmdump.exe' : 'mitmdump';
  const override = cleanPath(search.override);
  if (override) return [{ executablePath: override, source: 'manual' }];

  const environmentPath = cleanPath(search.environmentPath ?? process.env.HEXESTRA_MITMDUMP_PATH);
  if (environmentPath) return [{ executablePath: environmentPath, source: 'environment' }];

  const pathEntries = String(search.pathValue ?? process.env.PATH ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean)
    .map((entry) => ({ executablePath: path.join(entry, executableName), source: 'path' as const }));
  const commonDirectories = platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin']
    : platform === 'win32'
      ? []
      : [path.join(search.homeDirectory ?? os.homedir(), '.local', 'bin'), '/usr/local/bin', '/usr/bin'];
  const common = commonDirectories.map((directory) => ({
    executablePath: path.join(directory, executableName),
    source: 'common' as const,
  }));
  return [...pathEntries, ...common, ...(search.cwd ? [{ executablePath: path.join(search.cwd, executableName), source: 'common' as const }] : [])];
}

export function resolveMitmdumpCandidate(search: MitmproxyRuntimeSearch = {}): MitmproxyCandidate | null {
  const candidates = listMitmdumpCandidates(search);
  if (candidates[0]?.source === 'manual' || candidates[0]?.source === 'environment') return candidates[0];
  return candidates.find((candidate) => isFile(candidate.executablePath)) ?? null;
}

export function resolveMitmdumpPath(search: MitmproxyRuntimeSearch = {}) {
  const candidate = resolveMitmdumpCandidate(search);
  return candidate && isFile(candidate.executablePath) ? candidate.executablePath : null;
}

export function parseMitmdumpVersion(output: string) {
  const match = /(?:mitmproxy|mitmdump)\D+(\d+\.\d+\.\d+)/i.exec(output);
  return match?.[1] ?? null;
}

export async function inspectMitmdump(
  candidate: MitmproxyCandidate | null,
  runVersion: (executablePath: string) => Promise<string> = execMitmdumpVersion,
): Promise<MitmproxyRuntimeDiagnostic> {
  if (!candidate) {
    return {
      status: 'missing', requiredVersion: MITMPROXY_VERSION, executablePath: null,
      version: null, source: 'none', error: `mitmdump ${MITMPROXY_VERSION} was not found`,
    };
  }
  try {
    const output = await runVersion(candidate.executablePath);
    const version = parseMitmdumpVersion(output);
    if (version !== MITMPROXY_VERSION) {
      return {
        status: 'incompatible', requiredVersion: MITMPROXY_VERSION,
        executablePath: candidate.executablePath, version, source: candidate.source,
        error: `Hexestra requires mitmdump ${MITMPROXY_VERSION}; found ${version ?? 'unknown'}`,
      };
    }
    return {
      status: 'ready', requiredVersion: MITMPROXY_VERSION,
      executablePath: candidate.executablePath, version, source: candidate.source, error: null,
    };
  } catch (error) {
    return {
      status: 'missing', requiredVersion: MITMPROXY_VERSION,
      executablePath: candidate.executablePath, version: null, source: candidate.source,
      error: `Unable to verify mitmdump: ${errorMessage(error)}`,
    };
  }
}

export async function detectMitmproxyRuntime(search: MitmproxyRuntimeSearch = {}) {
  return inspectMitmdump(resolveMitmdumpCandidate(search));
}

export function isFile(candidate: string) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function cleanPath(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 2_000) : null;
}

function execMitmdumpVersion(executablePath: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(executablePath, ['--version'], {
      windowsHide: true,
      shell: false,
      timeout: 5_000,
      maxBuffer: 128 * 1024,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()));
      else resolve(`${stdout}\n${stderr}`);
    });
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
