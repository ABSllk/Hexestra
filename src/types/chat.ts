import type { AutonomyLevel } from './session';
import type { ToolRequest } from '../../electron/agent-interaction-contract';
import type { AgentAttachmentMetadata } from '../../electron/agent-attachment-contract';
import type { AgentContextRef } from '../../electron/agent-context-contract';
export type {
  SubagentActivity,
  SubagentRun,
  SubagentRunStatus,
  SubagentUsage,
} from '../../electron/agent-subagent-contract';

export type {
  AskUserQuestion,
  AskUserQuestionAnswers,
  AskUserQuestionOption,
  AskUserQuestionRequest,
  ToolApprovalRequest,
  ToolRequest,
} from '../../electron/agent-interaction-contract';
export type { AgentAttachment, AgentAttachmentMetadata, AgentAttachmentPicker } from '../../electron/agent-attachment-contract';
export type { AgentContextRef } from '../../electron/agent-context-contract';
export { agentContextRefKey } from '../../electron/agent-context-contract';
export { attachmentMetadata } from '../../electron/agent-attachment-contract';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool_request';
export type MessageStatus = 'sending' | 'streaming' | 'complete' | 'error';
export type ClaudePermissionMode = 'default' | 'auto' | 'bypassPermissions';
export type AgentActivityKind = 'text' | 'thinking' | 'tool';
export type AgentActivityStatus = 'streaming' | 'running' | 'complete' | 'error';

export interface AgentActivity {
  id: string;
  kind: AgentActivityKind;
  status: AgentActivityStatus;
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

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  status: MessageStatus;
  activities?: AgentActivity[];
  hasToolRequest?: boolean;
  toolRequest?: ToolRequest;
  sdkMessageId?: string;
  attachments?: AgentAttachmentMetadata[];
  contextRefs?: AgentContextRef[];
}

export interface ToolResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  parsedTargets?: string[];
  parsedFindings?: string[];
}

export interface ContextTab {
  tabId: string;
  title: string;
  type: 'terminal' | 'editor' | 'browser' | 'traffic' | 'report';
  contentPreview: string;
  isShared: boolean;
}

export type AgentState =
  | 'loading'
  | 'ready'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'error';

export interface AgentStatus {
  state: AgentState;
  sdkAvailable: boolean;
  backend: 'claude-agent-sdk';
  authenticated: boolean | null;
  model: string | null;
  claudeSessionId: string | null;
  pendingRequests: number;
  historyLength: number;
  lastError: string | null;
  executionMode: 'native' | 'wsl';
  runtimeLabel: string;
}
