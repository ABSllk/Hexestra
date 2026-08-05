import crypto from 'crypto';
import {
  DEFAULT_SHELL_PROJECT_STATE,
  type ReverseListenerProfile,
  type ShellFlavor,
  type ShellProfile,
  type ShellProjectState,
  type ShellSessionState,
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
  return [{
    id: value.id,
    name: bounded(value.name, 100) || (kind === 'ssh' ? host! : kind.toUpperCase()),
    kind,
    assetId: optionalIdentifier(value.assetId),
    assetRole: value.assetRole === 'infrastructure' ? 'infrastructure' : 'target',
    shellFlavor: isShellFlavor(value.shellFlavor) ? value.shellFlavor : defaultFlavor(kind),
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
  return value === 'local' || value === 'wsl' || value === 'ssh';
}

function isShellFlavor(value: unknown): value is ShellFlavor {
  return value === 'auto' || value === 'posix' || value === 'powershell' || value === 'cmd' || value === 'raw';
}

function isAuthMethod(value: unknown): value is NonNullable<ShellProfile['authMethod']> {
  return value === 'password' || value === 'private_key' || value === 'keyboard_interactive';
}

function validDate(value: unknown) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}
