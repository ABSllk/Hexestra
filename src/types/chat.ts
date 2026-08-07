import type { AutonomyLevel } from './session';
import type { ToolRequest } from '../../electron/agent-interaction-contract';
import type { AgentAttachmentMetadata } from '../../electron/agent-attachment-contract';
import type { AgentContextRef } from '../../electron/agent-context-contract';
import type {
  AgentActivity,
  AgentPermissionMode,
  AgentState,
  AgentStatus,
} from '../../electron/contracts/agent-runtime';
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
export type {
  AgentActivity,
  AgentBackendCapabilities,
  AgentBackendId,
  AgentBackendRuntimeState,
  AgentPermissionMode,
  AgentRunEvent,
  AgentStatus,
} from '../../electron/contracts/agent-runtime';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool_request';
export type MessageStatus = 'sending' | 'streaming' | 'complete' | 'error';
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  status: MessageStatus;
  activities?: AgentActivity[];
  hasToolRequest?: boolean;
  toolRequest?: ToolRequest;
  backendMessageId?: string;
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
