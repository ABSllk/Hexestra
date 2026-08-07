import type { AgentActivityStatus } from './contracts/agent-runtime';

export type SubagentRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'killed'
  | 'interrupted';

export interface SubagentActivity {
  id: string;
  kind: 'text' | 'thinking' | 'tool';
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
}

export interface SubagentUsage {
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
}

export interface SubagentRun {
  id: string;
  taskId: string;
  messageId?: string;
  toolUseId?: string;
  agentId?: string;
  agentType?: string;
  description: string;
  prompt?: string;
  parentRunId?: string;
  parentToolUseId?: string;
  status: SubagentRunStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  isBackgrounded?: boolean;
  lastToolName?: string;
  summary?: string;
  output?: string;
  error?: string;
  usage?: SubagentUsage;
  activities: SubagentActivity[];
}

export interface AgentSubagentUpdateEvent {
  sessionId: string | null;
  branchId: string;
  run: SubagentRun;
}
