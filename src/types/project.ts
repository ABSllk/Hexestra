import type { AgentActivity, AgentPermissionMode, AgentStatus, ChatMessage } from './chat';
import type { AgentBackendId } from '../../electron/contracts/agent-runtime';
import type { AgentAttentionEvent, AgentAttentionItem, AgentAttentionKind } from '../../electron/contracts/agent-runtime';
import type { AutonomyLevel } from './session';
import type { ShellProjectState } from '@electron/contracts/shell';
import type { SubagentRun } from '../../electron/agent-subagent-contract';
export type { SubagentRun } from '../../electron/agent-subagent-contract';
export type { ManagedRecordKind } from '@electron/contracts/records';
export { isManagedRecordKind } from '@electron/contracts/records';

export type ProjectTabType = 'terminal' | 'editor' | 'browser' | 'traffic' | 'replay' | 'report' | 'record' | 'workflow' | 'refinery' | 'settings' | 'welcome';

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
  permissionMode: AgentPermissionMode;
  autonomyLevel: AutonomyLevel;
}

export interface ConversationBranchSummary {
  id: string;
  title: string;
  parentBranchId?: string;
  forkedFromMessageId?: string;
  backendId: AgentBackendId;
  createdAt: string;
  messageCount: number;
  activityCount?: number;
  subagentRunCount?: number;
}

export interface AgentHistoryPage {
  items: ChatMessage[];
  beforeCursor: string | null;
  hasEarlier: boolean;
  total: number;
  totalActivities: number;
}

export interface AgentActivityPage {
  items: AgentActivity[];
  beforeCursor: string | null;
  hasEarlier: boolean;
  total: number;
}

export interface SubagentDetailPage {
  run: SubagentRun | null;
  page: AgentActivityPage | null;
}

export interface ProjectActivation {
  sessionId: string;
  messages: ChatMessage[];
  history: AgentHistoryPage;
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
  projectId?: string | null;
  message: ChatMessage;
}

export interface AgentStatusEvent {
  sessionId: string | null;
  branchId?: string;
  projectId?: string | null;
  status: AgentStatus;
}

export interface AgentSubagentUpdateEvent {
  sessionId: string | null;
  branchId: string;
  projectId?: string | null;
  run: SubagentRun;
}

export interface AgentToolRequestEvent {
  sessionId: string | null;
  branchId?: string;
  projectId?: string | null;
  request: import('./chat').ToolRequest;
}

export type { AgentAttentionEvent, AgentAttentionItem, AgentAttentionKind };
