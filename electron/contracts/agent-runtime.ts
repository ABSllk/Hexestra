import type { AgentAttachment } from '../agent-attachment-contract';
import type {
  AskUserQuestion,
  AskUserQuestionAnswers,
} from '../agent-interaction-contract';
import type { AgentToolDefinition } from './agent-tools';
import type { AgentSlashCommandDescriptor } from '../agent-command-contract';

export const CLAUDE_BACKEND_ID = 'claude';

export type AgentBackendId = string;
export type AgentPermissionMode = 'default' | 'auto' | 'bypassPermissions';
export type AgentState =
  | 'loading'
  | 'ready'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'error';

export type AgentBranchingMode = 'message' | 'session' | 'none';

export interface AgentBackendCapabilities {
  branching: AgentBranchingMode;
  subagents: boolean;
  attachments: Array<'text' | 'image' | 'pdf' | 'file'>;
  tools: boolean;
  interactiveQuestions: boolean;
  slashCommands: boolean;
  queuedInput?: boolean;
  scheduledWakeups?: boolean;
}

export interface AgentBackendRuntimeState {
  backendId: AgentBackendId;
  sessionId: string | null;
  connectionFingerprint: string | null;
}

export interface AgentBackendStatus {
  available: boolean;
  authenticated: boolean | null;
  model: string | null;
  lastError: string | null;
  runtimeMode: string;
  runtimeLabel: string;
}

export interface AgentStatus extends AgentBackendStatus {
  state: AgentState;
  backendId: AgentBackendId;
  backendSessionId: string | null;
  pendingRequests: number;
  historyLength: number;
}

export interface AgentToolPermissionRequest {
  toolName: string;
  riskLevel?: 'read' | 'write';
  input: Record<string, unknown>;
  toolUseId: string;
  signal: AbortSignal;
  agentId?: string;
  subagentRunId?: string;
  agentType?: string;
}

export interface AgentToolPermissionDecision {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  message?: string;
  interrupt?: boolean;
  decisionClassification?: 'user_temporary' | 'user_reject';
}

export interface AgentInteractionHandler {
  authorizeTool(request: AgentToolPermissionRequest): Promise<AgentToolPermissionDecision>;
  requestAnswers(
    request: AgentToolPermissionRequest & { questions: AskUserQuestion[] },
  ): Promise<AskUserQuestionAnswers>;
}

export interface AgentRunInput {
  /** Stable application conversation identity used to retain a live backend runtime. */
  conversationId: string;
  prompt: string;
  command?: string;
  systemInstructions: string;
  dynamicSystemContext?: string;
  /** Internal main-process callback used to refresh scheduled context without exposing provider types. */
  dynamicSystemContextProvider?: () => Promise<string | undefined> | string | undefined;
  signal: AbortSignal;
  attachments: AgentAttachment[];
  cwd: string;
  additionalDirectories?: string[];
  model: string | null;
  permissionMode: AgentPermissionMode;
  runtime: AgentBackendRuntimeState | null;
  resumeAt?: string;
  fork: boolean;
  settingSources?: string[];
  tools: AgentToolDefinition[];
  projectId?: string;
  /** Stable UUID/source used when the provider queue starts this input. */
  inputId?: string;
  source?: AgentInputSource;
  queuedAt?: string;
}

export type AgentInputSource = 'operator' | 'scheduled' | 'runtime';

export type AgentAttentionKind = 'completed' | 'failed' | 'waiting_approval' | 'waiting_input';

export interface AgentAttentionInteraction {
  id: string;
  kind: 'tool_approval' | 'ask_user_question';
  toolUseId: string;
  toolName?: string;
  input?: Record<string, unknown>;
  description?: string;
  riskLevel?: 'read' | 'write';
  questions?: AskUserQuestion[];
  createdAt: string;
  agentId?: string;
  subagentRunId?: string;
  agentType?: string;
}

export interface AgentAttentionItem {
  id: string;
  projectId: string;
  branchId: string;
  kind: AgentAttentionKind;
  title: string;
  detail?: string;
  interaction?: AgentAttentionInteraction;
  createdAt: string;
  read: boolean;
}

export interface AgentAttentionEvent {
  item: AgentAttentionItem;
}

export interface AgentQueuedInput {
  id: string;
  source: AgentInputSource;
  prompt: string;
  command?: string;
  queuedAt: string;
  input: AgentRunInput;
}

export interface AgentConversationOpenInput extends Omit<AgentRunInput, 'signal'> {
  signal?: AbortSignal;
}

export interface AgentInterruptReceipt {
  stillQueued: string[];
}

export interface AgentRuntimeSnapshot {
  projectId?: string;
  branchId: string;
  active: boolean;
  pendingInputs: number;
  pendingCrons: number;
  interactionPending: boolean;
}

export interface AgentConversationHandle {
  enqueue(input: AgentQueuedInput): Promise<void>;
  events(): AsyncIterable<AgentRunEvent>;
  interrupt(): Promise<AgentInterruptReceipt>;
  snapshot(): AgentRuntimeSnapshot;
  dispose(): Promise<void>;
}

export interface AgentCommandDiscoveryInput {
  cwd: string;
  additionalDirectories?: string[];
  settingSources?: string[];
  projectId?: string;
}

export interface AgentSessionEvent {
  type: 'session';
  sessionId: string;
  model: string | null;
  projectId?: string;
  branchId?: string;
}

export interface AgentInputStartedEvent {
  type: 'input_started';
  projectId?: string;
  branchId: string;
  inputId: string;
  source: AgentInputSource;
  prompt?: string;
  queuedAt?: string;
  startedAt: string;
}

export interface AgentTurnStartedEvent {
  type: 'turn_started';
  projectId?: string;
  branchId: string;
  inputId: string;
  source: AgentInputSource;
  startedAt: string;
}

export interface AgentRuntimeStateEvent {
  type: 'runtime_state';
  projectId?: string;
  branchId: string;
  snapshot: AgentRuntimeSnapshot;
}

export interface AgentSchedulesChangedEvent {
  type: 'schedules_changed';
  projectId?: string;
  branchId: string;
  crons: Array<{ id: string; schedule: string; recurring: boolean; prompt: string }>;
}

export interface AgentTurnSnapshotEvent {
  type: 'turn_snapshot';
  projectId?: string;
  branchId?: string;
  inputId?: string;
  content: string;
  activities: AgentActivity[];
}

export interface AgentSubagentSnapshotEvent {
  type: 'subagent_snapshot';
  projectId?: string;
  branchId?: string;
  run: import('../agent-subagent-contract').SubagentRun;
}

export interface AgentTurnCompletedEvent {
  type: 'turn_completed';
  projectId?: string;
  branchId?: string;
  inputId?: string;
  source?: AgentInputSource;
  content: string;
  activities: AgentActivity[];
  backendMessageId?: string;
}

export interface AgentCommandsChangedEvent {
  type: 'commands_changed';
  projectId?: string;
  branchId?: string;
  commands: AgentSlashCommandDescriptor[];
}

export type AgentRunEvent =
  | AgentSessionEvent
  | AgentInputStartedEvent
  | AgentTurnStartedEvent
  | AgentRuntimeStateEvent
  | AgentSchedulesChangedEvent
  | AgentTurnSnapshotEvent
  | AgentSubagentSnapshotEvent
  | AgentCommandsChangedEvent
  | AgentTurnCompletedEvent;

export interface AgentAdapter {
  readonly id: AgentBackendId;
  readonly capabilities: AgentBackendCapabilities;
  initialize(projectId?: string): Promise<boolean>;
  fingerprint(): string;
  resolveFingerprint?(projectId?: string): Promise<string>;
  status(): AgentBackendStatus;
  listCommands?(input: AgentCommandDiscoveryInput): Promise<AgentSlashCommandDescriptor[]>;
  runTurn(
    input: AgentRunInput,
    interactions: AgentInteractionHandler,
  ): AsyncIterable<AgentRunEvent>;
  openConversation?(
    input: AgentConversationOpenInput,
    interactions: AgentInteractionHandler,
  ): Promise<AgentConversationHandle>;
  disposeConversation?(projectId: string | undefined, conversationId: string): Promise<void> | void;
}

export class AgentBackendError extends Error {
  constructor(
    message: string,
    readonly backendId: AgentBackendId,
    readonly code: 'unavailable' | 'authentication' | 'runtime' | 'limit' | 'cancelled' | 'unknown' = 'unknown',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentBackendError';
  }
}

export interface AgentActivity {
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
  /** Task node that first observed this activity; never rewritten on focus changes. */
  pttTaskId?: string;
  subagentRunId?: string;
  agentType?: string;
  subagentDescription?: string;
}

export type AgentActivityStatus = AgentActivity['status'];
