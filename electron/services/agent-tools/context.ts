import type { WebContents } from 'electron';
import type { SupportedAgentMode } from '../agent-mode';

export type AgentSdk = typeof import('@anthropic-ai/claude-agent-sdk');

export interface AgentToolContext {
  sdk: AgentSdk;
  sender: WebContents;
  sessionId?: string;
  selectedTargetId?: string;
  permissionMode: SupportedAgentMode;
}
