import crypto from 'crypto';
import {
  DEFAULT_SHELL_PROJECT_STATE,
  WEBSHELL_COMMAND_PLACEHOLDERS,
  type ReverseListenerProfile,
  type ShellHttpHeader,
  type ShellFlavor,
  type ShellProfile,
  type ShellProjectState,
  type ShellSessionState,
  type WebShellProfileOptions,
} from '../contracts/shell';

const IDENTIFIER = /^[a-zA-Z0-9_-]{1,200}$/;

export function createShellId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function assertShellId(value: unknown, label = 'Shell identifier'): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`Invalid ${label.toLowerCase()}`);
}

export function normalizeShellProjectState(value: unknown): ShellProjectState {
  if (!isRecord(value)) return structuredClone(DEFAULT_SHELL_PROJECT_STATE);
  return {
    profiles: Array.isArray(value.profiles) ? value.profiles.flatMap(normalizeShellProfile).slice(0, 200) : [],
    listeners: Array.isArray(value.listeners) ? value.listeners.flatMap(normalizeListener).slice(0, 50) : [],
  };
}

export function normalizeShellProfile(value: unknown): ShellProfile[] {
  if (!isRecord(value) || !isIdentifier(value.id) || !isProfileKind(value.kind)) return [];
  const now = new Date(0).toISOString();
  const kind = value.kind;
  const host = bounded(value.host, 500);
  const username = bounded(value.username, 200);
  if (kind === 'ssh' && (!host || !username || !isPort(value.port))) return [];
  const webshell = kind === 'webshell' ? normalizeWebShellOptions(value.webshell) : undefined;
  if (kind === 'webshell' && !webshell) return [];
  const shellFlavor = isShellFlavor(value.shellFlavor) ? value.shellFlavor : defaultFlavor(kind);
  if (kind === 'webshell' && shellFlavor === 'raw') return [];
  return [{
    id: value.id,
    name: bounded(value.name, 100) || (kind === 'ssh' ? host! : kind.toUpperCase()),
    kind,
    webshell,
    assetId: optionalIdentifier(value.assetId),
    assetRole: value.assetRole === 'infrastructure' ? 'infrastructure' : 'target',
    shellFlavor,
    executable: bounded(value.executable, 1_000),
    args: Array.isArray(value.args) ? value.args.flatMap((item) => bounded(item, 1_000) ?? []).slice(0, 50) : undefined,
    wslDistribution: bounded(value.wslDistribution, 200),
    host,
    port: kind === 'ssh' ? value.port as number : undefined,
    username,
    authMethod: kind === 'ssh' ? (isAuthMethod(value.authMethod) ? value.authMethod : 'password') : undefined,
    credentialId: kind === 'ssh' ? optionalIdentifier(value.credentialId) : undefined,
    jumpProfileId: kind === 'ssh' ? optionalIdentifier(value.jumpProfileId) : undefined,
    hostKeyFingerprint: kind === 'ssh' ? normalizeFingerprint(value.hostKeyFingerprint) : undefined,
    createdAt: validDate(value.createdAt) ?? now,
    updatedAt: validDate(value.updatedAt) ?? now,
  }];
}

export function normalizeListener(value: unknown): ReverseListenerProfile[] {
  if (!isRecord(value) || !isIdentifier(value.id) || !isPort(value.port)) return [];
  const address = bounded(value.bindAddress, 100);
  if (!address || isWildcardAddress(address)) return [];
  const now = new Date(0).toISOString();
  return [{
    id: value.id,
    name: bounded(value.name, 100) || `${address}:${value.port}`,
    bindAddress: address,
    port: value.port,
    shellFlavor: isShellFlavor(value.shellFlavor) ? value.shellFlavor : 'raw',
    createdAt: validDate(value.createdAt) ?? now,
    updatedAt: validDate(value.updatedAt) ?? now,
  }];
}

export function assertSessionTransition(from: ShellSessionState, to: ShellSessionState) {
  const allowed: Record<ShellSessionState, ShellSessionState[]> = {
    connecting: ['host_key_pending', 'authenticating', 'ready', 'failed', 'disconnected', 'closed'],
    host_key_pending: ['authenticating', 'failed', 'closed'],
    authenticating: ['ready', 'failed', 'disconnected', 'closed'],
    quarantined: ['ready', 'failed', 'disconnected', 'closed'],
    ready: ['agent_locked', 'disconnected', 'failed', 'closed'],
    agent_locked: ['ready', 'disconnected', 'failed', 'closed'],
    disconnected: ['connecting', 'closed'],
    failed: ['connecting', 'closed'],
    closed: [],
  };
  if (!allowed[from].includes(to)) throw new Error(`Invalid shell session transition: ${from} -> ${to}`);
}

export function isWildcardAddress(address: string) {
  return address === '0.0.0.0' || address === '::' || address === '[::]' || address === '*';
}

export function normalizeCommandTimeout(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 300_000;
  return Math.max(1_000, Math.min(1_800_000, Math.round(value)));
}

export function normalizeReadLimits(lines: unknown, bytes: unknown) {
  return {
    lines: typeof lines === 'number' && Number.isFinite(lines) ? Math.max(1, Math.min(2_000, Math.round(lines))) : 200,
    bytes: typeof bytes === 'number' && Number.isFinite(bytes) ? Math.max(1_024, Math.min(262_144, Math.round(bytes))) : 262_144,
  };
}

function defaultFlavor(kind: ShellProfile['kind']): ShellFlavor {
  if (kind === 'local') return process.platform === 'win32' ? 'powershell' : 'posix';
  return kind === 'wsl' ? 'posix' : 'auto';
}

export function normalizeWebShellOptions(value: unknown): WebShellProfileOptions | undefined {
  try {
    return validateWebShellOptions(value);
  } catch {
    return undefined;
  }
}

export function validateWebShellOptions(value: unknown): WebShellProfileOptions {
  if (!isRecord(value)) throw new Error('WebShell settings are required');
  const url = bounded(value.url, 2_000);
  if (!url) throw new Error('WebShell URL is required');
  if (!/^https?:\/\//i.test(url)) throw new Error('WebShell URL must use HTTP or HTTPS');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('WebShell URL is invalid');
  }
  if (parsed.username || parsed.password) throw new Error('WebShell URL must not contain username or password');
  const method = value.method === 'GET' || value.method === 'POST' ? value.method : undefined;
  const bodyKind = isWebShellBodyKind(value.bodyKind) ? value.bodyKind : undefined;
  const adapterId = value.adapterId === undefined || value.adapterId === 'generic'
    ? 'generic'
    : value.adapterId === 'antsword.v2.php' ? value.adapterId : undefined;
  if (!adapterId) throw new Error('WebShell adapterId must be generic or antsword.v2.php');
  if (!method) throw new Error('WebShell method must be GET or POST');
  if (!bodyKind) throw new Error('WebShell bodyKind must be none, form, json, or raw');
  const bodyTemplate = bounded(value.bodyTemplate, 64 * 1024);
  if (adapterId === 'generic' && bodyKind !== 'none' && !bodyTemplate) {
    throw new Error(`WebShell bodyTemplate is required when bodyKind is ${bodyKind}`);
  }
  if (bodyKind === 'none' && bodyTemplate) {
    throw new Error('WebShell bodyTemplate must be omitted when bodyKind is none');
  }
  const runtime = value.runtime === undefined
    ? (adapterId === 'antsword.v2.php' ? 'php' : 'auto')
    : isWebShellRuntime(value.runtime) ? value.runtime : undefined;
  if (!runtime) throw new Error('WebShell runtime must be auto, php, jsp, jspx, or aspx');
  if (adapterId === 'antsword.v2.php' && runtime !== 'php') {
    throw new Error('AntSword v2 adapter currently supports the PHP runtime only');
  }
  const placeholderCount = countCommandPlaceholders(url) + countCommandPlaceholders(bodyTemplate ?? '');
  if (adapterId === 'generic' && placeholderCount !== 1) {
    throw new Error('WebShell URL and bodyTemplate must contain exactly one supported placeholder ({{command}} or {{command_base64}}) in total');
  }
  if (adapterId === 'antsword.v2.php' && placeholderCount > 0) {
    throw new Error('AntSword v2 adapter owns its password parameter and does not use command placeholders');
  }
  const commandMode = value.commandMode === undefined
    ? 'auto'
    : isWebShellCommandMode(value.commandMode) ? value.commandMode : undefined;
  if (!commandMode) throw new Error('WebShell commandMode must be auto, os, or php_eval');
  if (commandMode === 'php_eval' && `${url}${bodyTemplate ?? ''}`.includes('{{command_base64}}')) {
    throw new Error('WebShell php_eval commandMode requires {{command}} because Hexestra owns the PHP-to-OS adapter');
  }
  const headers = normalizeHeaders(value.headers);
  if (!headers) throw new Error('WebShell headers must be an array of at most 50 valid name/value entries without line breaks');
  const responseExtract = value.responseExtract === undefined
    ? 'body'
    : isResponseExtract(value.responseExtract) ? value.responseExtract : undefined;
  if (!responseExtract) throw new Error('WebShell responseExtract must be body, between, or regex');
  const responseStart = bounded(value.responseStart, 1_000);
  const responseEnd = bounded(value.responseEnd, 1_000);
  const responseRegex = bounded(value.responseRegex, 2_000);
  if (responseExtract === 'between' && (!responseStart || !responseEnd)) {
    throw new Error('WebShell responseStart and responseEnd are required for between extraction');
  }
  if (responseExtract === 'regex') {
    if (!responseRegex) throw new Error('WebShell responseRegex is required for regex extraction');
    try {
      new RegExp(responseRegex, 's');
    } catch {
      throw new Error('WebShell responseRegex is invalid');
    }
  }
  const responseEncoding = value.responseEncoding === undefined
    ? 'auto'
    : isResponseEncoding(value.responseEncoding) ? value.responseEncoding : undefined;
  if (!responseEncoding) throw new Error('WebShell responseEncoding must be auto, utf-8, or gb18030');
  const antsword = adapterId === 'antsword.v2.php' ? normalizeAntSword(value.antsword) : undefined;
  if (adapterId === 'antsword.v2.php' && !antsword) {
    throw new Error('AntSword v2 PHP settings require a passwordParameter and encoder');
  }
  if (adapterId === 'antsword.v2.php' && (method !== 'POST' || bodyKind !== 'form')) {
    throw new Error('AntSword v2 PHP adapter requires POST form requests');
  }
  return {
    adapterId,
    runtime,
    url,
    method,
    headers,
    bodyKind,
    bodyTemplate,
    commandMode,
    responseExtract,
    responseStart,
    responseEnd,
    responseRegex,
    responseEncoding,
    allowInvalidTls: value.allowInvalidTls === true,
    antsword,
  };
}

function normalizeAntSword(value: unknown): WebShellProfileOptions['antsword'] | undefined {
  if (!isRecord(value)) return undefined;
  const passwordParameter = bounded(value.passwordParameter, 200);
  const encoder = value.encoder === 'raw' || value.encoder === 'base64' || value.encoder === 'hex'
    ? value.encoder
    : undefined;
  if (!passwordParameter || !/^[A-Za-z0-9_.-]+$/.test(passwordParameter) || !encoder) return undefined;
  return { passwordParameter, encoder };
}

function normalizeHeaders(value: unknown): ShellHttpHeader[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) return undefined;
  const headers: ShellHttpHeader[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const name = bounded(item.name, 200);
    const headerValue = bounded(item.value, 8_000);
    if (!name || headerValue === undefined || /[\r\n]/.test(name) || /[\r\n]/.test(headerValue)) return undefined;
    headers.push({ name, value: headerValue });
  }
  return headers;
}

function countCommandPlaceholders(value: string) {
  return WEBSHELL_COMMAND_PLACEHOLDERS.reduce((count, marker) => count + value.split(marker).length - 1, 0);
}

function normalizeFingerprint(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/^SHA256:/i, '').trim();
  return /^[A-Za-z0-9+/]{20,100}={0,2}$/.test(normalized) ? `SHA256:${normalized}` : undefined;
}

function bounded(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function optionalIdentifier(value: unknown) {
  return isIdentifier(value) ? value : undefined;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535;
}

function isProfileKind(value: unknown): value is ShellProfile['kind'] {
  return value === 'local' || value === 'wsl' || value === 'ssh' || value === 'webshell';
}

function isShellFlavor(value: unknown): value is ShellFlavor {
  return value === 'auto' || value === 'posix' || value === 'powershell' || value === 'cmd' || value === 'raw';
}

function isAuthMethod(value: unknown): value is NonNullable<ShellProfile['authMethod']> {
  return value === 'password' || value === 'private_key' || value === 'keyboard_interactive';
}

function isWebShellBodyKind(value: unknown): value is WebShellProfileOptions['bodyKind'] {
  return value === 'none' || value === 'form' || value === 'json' || value === 'raw';
}

function isWebShellCommandMode(value: unknown): value is WebShellProfileOptions['commandMode'] {
  return value === 'auto' || value === 'os' || value === 'php_eval';
}

function isWebShellRuntime(value: unknown): value is NonNullable<WebShellProfileOptions['runtime']> {
  return value === 'auto' || value === 'php' || value === 'jsp' || value === 'jspx' || value === 'aspx';
}

function isResponseExtract(value: unknown): value is WebShellProfileOptions['responseExtract'] {
  return value === 'body' || value === 'between' || value === 'regex';
}

function isResponseEncoding(value: unknown): value is WebShellProfileOptions['responseEncoding'] {
  return value === 'auto' || value === 'utf-8' || value === 'gb18030';
}

function validDate(value: unknown) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}
