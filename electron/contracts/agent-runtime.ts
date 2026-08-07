import type { AgentAttachment } from '../agent-attachment-contract';
import type {
  AskUserQuestion,
  AskUserQuestionAnswers,
} from '../agent-interaction-contract';
import type { AgentToolDefinition } from './agent-tools';

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
  prompt: string;
  systemInstructions: string;
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
}

export interface AgentSessionEvent {
  type: 'session';
  sessionId: string;
  model: string | null;
}

export interface AgentTurnSnapshotEvent {
  type: 'turn_snapshot';
  content: string;
  activities: AgentActivity[];
}

export interface AgentSubagentSnapshotEvent {
  type: 'subagent_snapshot';
  run: import('../agent-subagent-contract').SubagentRun;
}

export interface AgentTurnCompletedEvent {
  type: 'turn_completed';
  content: string;
  activities: AgentActivity[];
  backendMessageId?: string;
}

export type AgentRunEvent =
  | AgentSessionEvent
  | AgentTurnSnapshotEvent
  | AgentSubagentSnapshotEvent
  | AgentTurnCompletedEvent;

export interface AgentAdapter {
  readonly id: AgentBackendId;
  readonly capabilities: AgentBackendCapabilities;
  initialize(): Promise<boolean>;
  fingerprint(): string;
  status(): AgentBackendStatus;
  runTurn(
    input: AgentRunInput,
    interactions: AgentInteractionHandler,
  ): AsyncIterable<AgentRunEvent>;
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
  subagentRunId?: string;
  agentType?: string;
  subagentDescription?: string;
}

export type AgentActivityStatus = AgentActivity['status'];
