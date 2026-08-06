import type { AgentAttachmentMetadata } from '../agent-attachment-contract';
import {
  type AgentContextRef,
  normalizeAgentContextRefs,
} from '../agent-context-contract';
import { DEFAULT_PROXY_PROFILE, type ProxyProfile } from '../contracts/traffic';
import type { ShellProjectState } from '../contracts/shell';
import { normalizeShellProjectState } from './shell-contract';
import { isManagedRecordKind } from '../contracts/records';
import type { SubagentRun } from '../agent-subagent-contract';

export type ProjectPermissionMode = 'default' | 'auto' | 'bypassPermissions';
export type ProjectAutonomyLevel = 'low' | 'medium' | 'high';
export type ProjectTabType = 'terminal' | 'editor' | 'browser' | 'traffic' | 'replay' | 'report' | 'record' | 'settings' | 'welcome';

export interface PersistedAgentActivity {
  id: string;
  kind: 'text' | 'thinking' | 'tool';
  status: 'streaming' | 'running' | 'complete' | 'error';
  content?: string;
  toolUseId?: string;
  toolName?: string;
  label?: string;
  summary?: string;
  input?: Record<string, unknown>;
  output?: string;
  outputSummary?: string;
  elapsedSeconds?: number;
  subagentRunId?: string;
  agentType?: string;
  subagentDescription?: string;
}

export interface PersistedChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool_request';
  content: string;
  timestamp: string;
  status: 'sending' | 'streaming' | 'complete' | 'error';
  activities?: PersistedAgentActivity[];
  sdkMessageId?: string;
  attachments?: AgentAttachmentMetadata[];
  contextRefs?: AgentContextRef[];
}

export interface PersistedConversationBranch {
  id: string;
  title: string;
  parentBranchId?: string;
  forkedFromMessageId?: string;
  claudeSessionId: string | null;
  connectionFingerprint: string | null;
  messages: PersistedChatMessage[];
  subagentRuns: SubagentRun[];
  createdAt: string;
}

export interface PersistedProjectTab {
  id: string;
  type: ProjectTabType;
  title: string;
  closable: boolean;
  data?: Record<string, unknown>;
}

export interface ProjectWorkspaceState {
  tabs: PersistedProjectTab[];
  activeTabId: string | null;
  nextTabNumber: number;
}

export interface ProjectState {
  version: 5;
  agent: {
    model: string | null;
    lastError: string | null;
    activeBranchId: string;
    branches: PersistedConversationBranch[];
  };
  preferences: {
    permissionMode: ProjectPermissionMode;
    autonomyLevel: ProjectAutonomyLevel;
  };
  traffic: ProxyProfile;
  shells: ShellProjectState;
  workspace: ProjectWorkspaceState;
}

export type ProjectStatePatch = {
  agent?: Partial<ProjectState['agent']>;
  preferences?: Partial<ProjectState['preferences']>;
  traffic?: Partial<ProxyProfile>;
  shells?: Partial<ShellProjectState>;
  workspace?: Partial<ProjectWorkspaceState>;
};

const MAX_BRANCHES = 50;
const MAX_TABS = 50;

export function createDefaultProjectState(): ProjectState {
  const mainBranch = createConversationBranch('main', 'Main', {
    createdAt: new Date(0).toISOString(),
  });
  return {
    version: 5,
    agent: {
      model: null,
      lastError: null,
      activeBranchId: mainBranch.id,
      branches: [mainBranch],
    },
    preferences: {
      permissionMode: 'default',
      autonomyLevel: 'medium',
    },
    traffic: structuredClone(DEFAULT_PROXY_PROFILE),
    shells: normalizeShellProjectState(undefined),
    workspace: createDefaultWorkspace(),
  };
}

export function createConversationBranch(
  id: string,
  title: string,
  input: Partial<PersistedConversationBranch> = {},
): PersistedConversationBranch {
  return {
    id,
    title,
    claudeSessionId: null,
    connectionFingerprint: null,
    messages: [],
    subagentRuns: [],
    createdAt: new Date().toISOString(),
    ...input,
  };
}

export function createDefaultWorkspace(): ProjectWorkspaceState {
  return {
    tabs: [
      { id: 'welcome-0', type: 'welcome', title: 'Welcome', closable: false },
      { id: 'terminal-1', type: 'terminal', title: 'Terminal', closable: true },
    ],
    activeTabId: 'terminal-1',
    nextTabNumber: 2,
  };
}

export function normalizeProjectState(value: unknown): ProjectState {
  const defaults = createDefaultProjectState();
  if (!isRecord(value) || (value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5)) return defaults;
  const agent = isRecord(value.agent) ? value.agent : {};
  const preferences = isRecord(value.preferences) ? value.preferences : {};
  const traffic = isRecord(value.traffic) ? value.traffic : {};
  const shells = isRecord(value.shells) ? value.shells : {};
  const workspace = isRecord(value.workspace) ? value.workspace : {};
  const branches = Array.isArray(agent.branches)
    ? agent.branches.flatMap(normalizeBranch).slice(0, MAX_BRANCHES)
    : [];
  const safeBranches = branches.length > 0 ? branches : defaults.agent.branches;
  const requestedBranchId = typeof agent.activeBranchId === 'string'
    ? agent.activeBranchId
    : '';
  const activeBranchId = safeBranches.some((branch) => branch.id === requestedBranchId)
    ? requestedBranchId
    : safeBranches[0].id;

  return {
    version: 5,
    agent: {
      model: nullableString(agent.model),
      lastError: nullableString(agent.lastError),
      activeBranchId,
      branches: safeBranches,
    },
    preferences: {
      permissionMode: isPermissionMode(preferences.permissionMode)
        ? preferences.permissionMode
        : defaults.preferences.permissionMode,
      autonomyLevel: isAutonomyLevel(preferences.autonomyLevel)
        ? preferences.autonomyLevel
        : defaults.preferences.autonomyLevel,
    },
    traffic: normalizeProjectTrafficProfile(traffic),
    shells: normalizeShellProjectState(shells),
    workspace: normalizeWorkspace(workspace),
  };
}

export function mergeProjectState(current: ProjectState, patch: ProjectStatePatch): ProjectState {
  return normalizeProjectState({
    ...current,
    agent: { ...current.agent, ...patch.agent },
    preferences: { ...current.preferences, ...patch.preferences },
    traffic: { ...current.traffic, ...patch.traffic },
    shells: { ...current.shells, ...patch.shells },
    workspace: { ...current.workspace, ...patch.workspace },
  });
}

function normalizeWorkspace(value: Record<string, unknown>): ProjectWorkspaceState {
  const defaults = createDefaultWorkspace();
  const tabs = Array.isArray(value.tabs)
    ? value.tabs.flatMap(normalizeTab).slice(0, MAX_TABS)
    : [];
  if (tabs.length === 0) return defaults;
  const requestedActive = typeof value.activeTabId === 'string' ? value.activeTabId : null;
  const activeTabId = tabs.some((tab) => tab.id === requestedActive)
    ? requestedActive
    : tabs[0].id;
  const nextTabNumber = typeof value.nextTabNumber === 'number' && Number.isInteger(value.nextTabNumber)
    ? Math.max(1, value.nextTabNumber)
    : inferNextTabNumber(tabs);
  return { tabs, activeTabId, nextTabNumber };
}

function normalizeBranch(value: unknown): PersistedConversationBranch[] {
  if (!isRecord(value) || !isIdentifier(value.id)) return [];
  const messages = Array.isArray(value.messages)
    ? value.messages.flatMap(normalizeMessage)
    : [];
  const subagentRuns = Array.isArray(value.subagentRuns)
    ? value.subagentRuns.flatMap(normalizeSubagentRun)
    : [];
  return [{
    id: value.id,
    title: typeof value.title === 'string' && value.title.trim()
      ? value.title.trim().slice(0, 100)
      : 'Branch',
    parentBranchId: isIdentifier(value.parentBranchId) ? value.parentBranchId : undefined,
    forkedFromMessageId: isIdentifier(value.forkedFromMessageId)
      ? value.forkedFromMessageId
      : undefined,
    claudeSessionId: nullableString(value.claudeSessionId),
    connectionFingerprint: nullableString(value.connectionFingerprint),
    messages,
    subagentRuns,
    createdAt: typeof value.createdAt === 'string'
      ? value.createdAt
      : new Date(0).toISOString(),
  }];
}

function normalizeSubagentRun(value: unknown): SubagentRun[] {
  if (!isRecord(value) || !isIdentifier(value.id) || !isIdentifier(value.taskId)) return [];
  const persistedStatus = isSubagentRunStatus(value.status) ? value.status : 'interrupted';
  // A process restart cannot prove that a pending/running child is still alive.
  // Keep its transcript, but surface it as interrupted until a new run starts.
  const status = persistedStatus === 'pending' || persistedStatus === 'running'
    ? 'interrupted'
    : persistedStatus;
  const activities = Array.isArray(value.activities)
    ? value.activities.flatMap(normalizeSubagentActivity)
    : [];
  const usage = isRecord(value.usage)
    ? {
      totalTokens: boundedNumber(value.usage.totalTokens),
      toolUses: boundedNumber(value.usage.toolUses),
      durationMs: boundedNumber(value.usage.durationMs),
    }
    : undefined;
  return [{
    id: value.id,
    taskId: value.taskId,
    messageId: optionalIdentifier(value.messageId),
    toolUseId: optionalIdentifier(value.toolUseId),
    agentId: optionalIdentifier(value.agentId),
    agentType: optionalString(value.agentType),
    description: boundedString(value.description).slice(0, 2_000),
    prompt: optionalString(value.prompt)?.slice(0, 20_000),
    parentRunId: optionalIdentifier(value.parentRunId),
    parentToolUseId: optionalIdentifier(value.parentToolUseId),
    status,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    endedAt: optionalString(value.endedAt),
    isBackgrounded: value.isBackgrounded === true,
    lastToolName: optionalString(value.lastToolName),
    summary: optionalString(value.summary)?.slice(0, 4_000),
    output: optionalString(value.output)?.slice(0, 50_000),
    error: optionalString(value.error)?.slice(0, 4_000),
    usage,
    activities,
  }];
}

function normalizeSubagentActivity(value: unknown) {
  if (!isRecord(value) || typeof value.id !== 'string') return [];
  if (value.kind !== 'text' && value.kind !== 'thinking' && value.kind !== 'tool') return [];
  const status = value.status === 'streaming' || value.status === 'running'
    || value.status === 'complete' || value.status === 'error'
    ? value.status
    : 'complete';
  const kind = value.kind as 'text' | 'thinking' | 'tool';
  const normalizedStatus = status as 'streaming' | 'running' | 'complete' | 'error';
  return [{
    id: value.id,
    kind,
    status: normalizedStatus,
    content: optionalString(value.content)?.slice(0, 50_000),
    toolUseId: optionalIdentifier(value.toolUseId),
    toolName: optionalString(value.toolName),
    label: optionalString(value.label),
    summary: optionalString(value.summary),
    input: isRecord(value.input) ? value.input : undefined,
    output: optionalString(value.output)?.slice(0, 12_000),
    outputSummary: optionalString(value.outputSummary),
    elapsedSeconds: boundedNumber(value.elapsedSeconds),
  }];
}

function normalizeMessage(value: unknown): PersistedChatMessage[] {
  if (!isRecord(value)) return [];
  if (typeof value.id !== 'string' || !isMessageRole(value.role)) return [];
  const status = isMessageStatus(value.status) && value.status !== 'sending' && value.status !== 'streaming'
    ? value.status
    : 'complete';
  const activities = Array.isArray(value.activities)
    ? value.activities.flatMap(normalizeActivity)
    : undefined;
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.flatMap(normalizeAttachment)
    : undefined;
  const contextRefs = Array.isArray(value.contextRefs)
    ? normalizeAgentContextRefs(value.contextRefs)
    : undefined;
  return [{
    id: value.id,
    role: value.role,
    content: boundedString(value.content),
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : new Date(0).toISOString(),
    status,
    sdkMessageId: optionalIdentifier(value.sdkMessageId),
    ...(activities?.length ? { activities } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(contextRefs?.length ? { contextRefs } : {}),
  }];
}

function normalizeAttachment(value: unknown): AgentAttachmentMetadata[] {
  if (!isRecord(value) || !isIdentifier(value.id)) return [];
  if (typeof value.name !== 'string' || typeof value.path !== 'string') return [];
  if (!isAttachmentKind(value.kind) || typeof value.mimeType !== 'string') return [];
  if (typeof value.size !== 'number' || !Number.isFinite(value.size) || value.size < 0) return [];
  return [{
    id: value.id,
    name: value.name.slice(0, 500),
    path: value.path.slice(0, 4_000),
    kind: value.kind,
    mimeType: value.mimeType.slice(0, 200),
    size: Math.round(value.size),
  }];
}

function normalizeActivity(value: unknown): PersistedAgentActivity[] {
  if (!isRecord(value) || typeof value.id !== 'string' || !isActivityKind(value.kind)) return [];
  const status = isActivityStatus(value.status) && value.status !== 'streaming' && value.status !== 'running'
    ? value.status
    : 'complete';
  return [{
    id: value.id,
    kind: value.kind,
    status,
    content: optionalString(value.content),
    toolUseId: optionalString(value.toolUseId),
    toolName: optionalString(value.toolName),
    label: optionalString(value.label),
    summary: optionalString(value.summary),
    input: isRecord(value.input) ? value.input : undefined,
    output: optionalString(value.output),
    outputSummary: optionalString(value.outputSummary),
    elapsedSeconds: typeof value.elapsedSeconds === 'number' && Number.isFinite(value.elapsedSeconds)
      ? Math.max(0, Math.round(value.elapsedSeconds))
      : undefined,
    subagentRunId: optionalIdentifier(value.subagentRunId),
    agentType: optionalString(value.agentType),
    subagentDescription: optionalString(value.subagentDescription),
  }];
}

function normalizeTab(value: unknown): PersistedProjectTab[] {
  if (!isRecord(value) || typeof value.id !== 'string' || !isTabType(value.type)) return [];
  return [{
    id: value.id,
    type: value.type,
    title: typeof value.title === 'string' ? value.title.slice(0, 200) : value.type,
    closable: value.type === 'welcome' ? false : value.closable !== false,
    data: isRecord(value.data) ? sanitizeTabData(value.type, value.data) : undefined,
  }];
}

function sanitizeTabData(type: ProjectTabType, data: Record<string, unknown>) {
  if (type === 'editor') {
    return {
      filePath: optionalString(data.filePath)?.slice(0, 1_000),
    };
  }
  if (type === 'browser') {
    return {
      url: optionalString(data.url)?.slice(0, 4_000),
    };
  }
  if (type === 'traffic' && isIdentifier(data.flowId)) {
    return { flowId: data.flowId };
  }
  if (type === 'replay' && isIdentifier(data.replaySessionId)) {
    return { replaySessionId: data.replaySessionId };
  }
  if (type === 'terminal' && (isIdentifier(data.shellProfileId) || data.managedShell === true)) {
    return {
      managedShell: true,
      shellProfileId: optionalIdentifier(data.shellProfileId),
    };
  }
  if (type === 'record' && isManagedRecordKind(data.recordKind) && isIdentifier(data.recordId)) {
    return {
      recordKind: data.recordKind,
      recordId: data.recordId,
    };
  }
  return undefined;
}

function inferNextTabNumber(tabs: PersistedProjectTab[]) {
  return Math.max(1, ...tabs.map((tab) => Number(tab.id.match(/-(\d+)$/)?.[1] ?? 0) + 1));
}

function boundedString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function boundedNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value ? value.slice(0, 1_000) : null;
}

function optionalIdentifier(value: unknown) {
  return isIdentifier(value) ? value : undefined;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPermissionMode(value: unknown): value is ProjectPermissionMode {
  return value === 'default' || value === 'auto' || value === 'bypassPermissions';
}

function isAutonomyLevel(value: unknown): value is ProjectAutonomyLevel {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isTabType(value: unknown): value is ProjectTabType {
  return value === 'terminal' || value === 'editor' || value === 'browser'
    || value === 'traffic' || value === 'replay' || value === 'report' || value === 'record' || value === 'settings' || value === 'welcome';
}


function normalizeProjectTrafficProfile(value: Record<string, unknown>): ProxyProfile {
  const burp = isRecord(value.burp) ? value.burp : {};
  const legacyUpstream = burp.mode === 'upstream';
  const mcpUrl = typeof burp.mcpUrl === 'string' ? burp.mcpUrl : DEFAULT_PROXY_PROFILE.burp.mcpUrl;
  let safeMcpUrl = DEFAULT_PROXY_PROFILE.burp.mcpUrl;
  try {
    const parsed = new URL(mcpUrl);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1')) {
      safeMcpUrl = parsed.toString();
    }
  } catch {
    // Malformed persisted integrations normalize to the loopback default.
  }
  return {
    enabled: value.enabled === true,
    interceptRequests: value.interceptRequests === true,
    interceptResponses: value.interceptResponses === true,
    listenHost: '127.0.0.1',
    listenPort: isPort(value.listenPort) ? value.listenPort : undefined,
    burp: {
      enabled: burp.enabled === true && !legacyUpstream,
      bridgeHost: '127.0.0.1',
      bridgePort: isPort(burp.bridgePort) ? burp.bridgePort : 9877,
      bridgeToken: typeof burp.bridgeToken === 'string'
        && burp.bridgeToken.trim().length >= 32
        && burp.bridgeToken.trim().length <= 256
        && /^[\x21-\x7E]+$/.test(burp.bridgeToken.trim())
        ? burp.bridgeToken.trim()
        : '',
      mcpUrl: safeMcpUrl,
    },
  };
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535;
}

function isMessageRole(value: unknown): value is PersistedChatMessage['role'] {
  return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool_request';
}

function isMessageStatus(value: unknown): value is PersistedChatMessage['status'] {
  return value === 'sending' || value === 'streaming' || value === 'complete' || value === 'error';
}

function isActivityKind(value: unknown): value is PersistedAgentActivity['kind'] {
  return value === 'text' || value === 'thinking' || value === 'tool';
}

function isActivityStatus(value: unknown): value is PersistedAgentActivity['status'] {
  return value === 'streaming' || value === 'running' || value === 'complete' || value === 'error';
}

function isSubagentRunStatus(value: unknown): value is SubagentRun['status'] {
  return value === 'pending' || value === 'running' || value === 'completed'
    || value === 'failed' || value === 'stopped' || value === 'killed'
    || value === 'interrupted';
}

function isAttachmentKind(value: unknown): value is AgentAttachmentMetadata['kind'] {
  return value === 'text' || value === 'image' || value === 'pdf' || value === 'file';
}
