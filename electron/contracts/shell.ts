export const SHELL_IPC = {
  PROFILE_LIST: 'shell:profile:list',
  PROFILE_SAVE: 'shell:profile:save',
  PROFILE_DELETE: 'shell:profile:delete',
  CREDENTIAL_SAVE: 'shell:credential:save',
  CREDENTIAL_DELETE: 'shell:credential:delete',
  CREDENTIAL_STATUS: 'shell:credential:status',
  INTERFACES: 'shell:interfaces',
  SESSION_CONNECT: 'shell:session:connect',
  SESSION_ATTACH: 'shell:session:attach',
  SESSION_LIST: 'shell:session:list',
  SESSION_READ: 'shell:session:read',
  SESSION_WRITE: 'shell:session:write',
  SESSION_RESIZE: 'shell:session:resize',
  SESSION_INTERRUPT: 'shell:session:interrupt',
  SESSION_TAKEOVER: 'shell:session:takeover',
  SESSION_DISCONNECT: 'shell:session:disconnect',
  LISTENER_START: 'shell:listener:start',
  LISTENER_LIST: 'shell:listener:list',
  LISTENER_SAVE: 'shell:listener:save',
  LISTENER_DELETE: 'shell:listener:delete',
  LISTENER_STOP: 'shell:listener:stop',
  CONNECT_TEMPLATE_LIST: 'shell:connect-template:list',
  CONNECT_COMMAND_BUILD: 'shell:connect-command:build',
  PUBLIC_IP_DETECT: 'shell:public-ip:detect',
  REVERSE_BIND: 'shell:reverse:bind',
  REVERSE_REJECT: 'shell:reverse:reject',
  AUDIT_LIST: 'shell:audit:list',
  AUDIT_READ: 'shell:audit:read',
  AUDIT_DELETE: 'shell:audit:delete',
  SAVE_EVIDENCE: 'shell:save-evidence',
  OUTPUT: 'shell:output',
  CHANGED: 'shell:changed',
} as const;

export const LOCAL_OPERATOR_ASSET_ID = 'local-operator';

export function isLoopbackShellPeer(value?: string) {
  const normalized = (value ?? '').trim().toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' || normalized.startsWith('127.');
}

export type ShellProfileKind = 'local' | 'wsl' | 'ssh';
export type ShellFlavor = 'auto' | 'posix' | 'powershell' | 'cmd' | 'raw';
export type ShellAuthMethod = 'password' | 'private_key' | 'keyboard_interactive';
export type ShellAssetRole = 'target' | 'infrastructure';

export interface ShellProfile {
  id: string;
  name: string;
  kind: ShellProfileKind;
  assetId?: string;
  assetRole: ShellAssetRole;
  shellFlavor: ShellFlavor;
  executable?: string;
  args?: string[];
  wslDistribution?: string;
  host?: string;
  port?: number;
  username?: string;
  authMethod?: ShellAuthMethod;
  credentialId?: string;
  jumpProfileId?: string;
  hostKeyFingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReverseListenerProfile {
  id: string;
  name: string;
  bindAddress: string;
  port: number;
  shellFlavor: ShellFlavor;
  createdAt: string;
  updatedAt: string;
}

export interface ShellProjectState {
  profiles: ShellProfile[];
  listeners: ReverseListenerProfile[];
}

export type ShellSessionState =
  | 'connecting'
  | 'host_key_pending'
  | 'authenticating'
  | 'quarantined'
  | 'ready'
  | 'agent_locked'
  | 'disconnected'
  | 'failed'
  | 'closed';

export interface ShellPeer {
  address: string;
  port: number;
}

export interface ShellSessionCapabilities {
  resize: boolean;
  interrupt: boolean;
  exitCode: boolean;
  agentExecute: boolean;
}

export interface ShellAgentLease {
  id: string;
  commandId: string;
  revision: number;
  startedAt: string;
  timeoutMs: number;
}

export interface ShellSession {
  id: string;
  projectId: string;
  profileId?: string;
  listenerId?: string;
  kind: ShellProfileKind | 'reverse_tcp';
  title: string;
  state: ShellSessionState;
  revision: number;
  assetId?: string;
  peer?: ShellPeer;
  shellFlavor: ShellFlavor;
  capabilities: ShellSessionCapabilities;
  ownerWindowId?: number;
  ownerTabId?: string;
  agentLease?: ShellAgentLease;
  preview?: string;
  error?: string;
  createdAt: string;
  lastActivityAt: string;
}

export type ShellCommandOutcome =
  | 'completed'
  | 'completed_unverified'
  | 'timeout'
  | 'interrupted'
  | 'disconnected'
  | 'unknown';

export interface ShellCommandRequest {
  projectId: string;
  sessionId: string;
  command: string;
  timeoutMs?: number;
  targetAssetId?: string;
}

export interface ShellCommandResult {
  id: string;
  projectId: string;
  sessionId: string;
  command: string;
  startedAt: string;
  completedAt: string;
  outcome: ShellCommandOutcome;
  exitCode?: number;
  output: string;
  truncated: false;
}

export interface ShellCommandAudit extends ShellCommandResult {
  assetId?: string;
  profileId?: string;
  actor: 'agent';
  approvalMode: 'default' | 'auto' | 'bypassPermissions';
}

export interface ShellCredentialInput {
  kind: 'password' | 'private_key' | 'keyboard_interactive';
  label: string;
  secret: string;
  passphrase?: string;
}

export interface ShellCredentialStatus {
  id: string;
  kind: ShellCredentialInput['kind'];
  label: string;
  available: boolean;
}

export interface ShellNetworkInterface {
  name: string;
  address: string;
  family: 'IPv4' | 'IPv6';
  internal: boolean;
}

export interface ShellListenerRuntime {
  profile: ReverseListenerProfile;
  state: 'stopped' | 'starting' | 'listening' | 'error';
  sessionCount: number;
  error?: string;
}

export type ShellConnectTemplateId =
  | 'powershell-tcp'
  | 'bash-tcp'
  | 'python3'
  | 'netcat'
  | 'busybox-netcat'
  | 'php-cli';

export type ShellConnectObfuscation = 'none' | 'base64';

export interface ShellConnectTemplateSummary {
  id: ShellConnectTemplateId;
  label: string;
  target: string;
  runtime: string;
  shell: string;
  pty: 'native' | 'partial' | 'none';
  note: string;
}

export interface ShellConnectCommandRequest {
  projectId: string;
  listenerId: string;
  templateId: ShellConnectTemplateId;
  callbackAddress: string;
  callbackPort: number;
  obfuscation?: ShellConnectObfuscation;
}

export interface ShellConnectCommandResult {
  listenerId: string;
  template: ShellConnectTemplateSummary;
  callbackAddress: string;
  callbackPort: number;
  command: string;
  localOnly: boolean;
  warning: string;
  obfuscation: ShellConnectObfuscation;
}

export interface ShellChangedEvent {
  projectId: string;
  sessionId?: string;
  listenerId?: string;
  profiles?: boolean;
}

export interface ShellOutputEvent {
  projectId: string;
  sessionId: string;
  data: string;
}

export const DEFAULT_SHELL_PROJECT_STATE: ShellProjectState = {
  profiles: [],
  listeners: [],
};
