import type { WebContents } from 'electron';
import type { AgentPermissionMode } from '../../contracts/agent-runtime';

export interface AgentToolContext {
  sender: WebContents;
  sessionId?: string;
  selectedTargetId?: string;
  permissionMode: AgentPermissionMode;
}
