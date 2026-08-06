import type { ChatMessage, ClaudePermissionMode, AgentStatus } from './chat';
import type { AutonomyLevel } from './session';
import type { ShellProjectState } from '@electron/contracts/shell';
import type { SubagentRun } from '../../electron/agent-subagent-contract';
export type { SubagentRun } from '../../electron/agent-subagent-contract';
export type { ManagedRecordKind } from '@electron/contracts/records';
export { isManagedRecordKind } from '@electron/contracts/records';

export type ProjectTabType = 'terminal' | 'editor' | 'browser' | 'traffic' | 'replay' | 'report' | 'record' | 'settings' | 'welcome';

export interface ProjectWorkspaceTab {
  id: string;
  type: ProjectTabType;
  title: string;
  closable: boolean;
  data?: Record<string, unknown>;
}

export interface ProjectWorkspaceState {
  tabs: ProjectWorkspaceTab[];
  activeTabId: string | null;
  nextTabNumber: number;
}

export interface ProjectPreferences {
  permissionMode: ClaudePermissionMode;
  autonomyLevel: AutonomyLevel;
}

export interface ConversationBranchSummary {
  id: string;
  title: string;
  parentBranchId?: string;
  forkedFromMessageId?: string;
  createdAt: string;
  messageCount: number;
}

export interface ProjectActivation {
  sessionId: string;
  messages: ChatMessage[];
  activeBranchId: string;
  branches: ConversationBranchSummary[];
  subagentRuns?: SubagentRun[];
  status: AgentStatus;
  preferences: ProjectPreferences;
  workspace: ProjectWorkspaceState;
}

export interface ProjectStatePatch {
  preferences?: Partial<ProjectPreferences>;
  workspace?: Partial<ProjectWorkspaceState>;
  shells?: Partial<ShellProjectState>;
}

export interface AgentMessageEvent {
  sessionId: string | null;
  branchId: string;
  message: ChatMessage;
}

export interface AgentStatusEvent {
  sessionId: string | null;
  status: AgentStatus;
}

export interface AgentSubagentUpdateEvent {
  sessionId: string | null;
  branchId: string;
  run: SubagentRun;
}

export interface AgentToolRequestEvent {
  sessionId: string | null;
  request: import('./chat').ToolRequest;
}
