import type { AgentToolContext } from './context';
import { createBrowserAgentTools } from './browser-tools';
import { createProjectAgentTools } from './project-tools';
import { createShellAgentTools } from './shell-tools';
import { createTrafficAgentTools } from './traffic-tools';
import { createProxyAgentTools } from './proxy-tools';

export function createHexestraAgentTools(context: AgentToolContext) {
  return [
    ...createBrowserAgentTools(context),
    ...createShellAgentTools(context),
    ...createTrafficAgentTools(context),
    ...createProxyAgentTools(context),
    ...createProjectAgentTools(context),
  ];
}

export { createAgentTool } from './contract';
export type { AgentToolDefinition, AgentToolResult, AgentToolContent } from './contract';
