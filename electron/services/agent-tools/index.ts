import type { AgentToolContext } from './context';
import { isTaskGuardedTool } from '../agent-tool-policy';
import { createBrowserAgentTools } from './browser-tools';
import { createProjectAgentTools } from './project-tools';
import { createShellAgentTools } from './shell-tools';
import { createTrafficAgentTools } from './traffic-tools';
import { createProxyAgentTools } from './proxy-tools';

export function createHexestraAgentTools(context: AgentToolContext) {
  const tools = [
    ...createBrowserAgentTools(context),
    ...createShellAgentTools(context),
    ...createTrafficAgentTools(context),
    ...createProxyAgentTools(context),
    ...createProjectAgentTools(context),
  ];
  if (!context.taskGuard) return tools;
  return tools.map((tool) => {
    const executionTool = isTaskGuardedTool(tool.name, tool.riskLevel);
    if (!executionTool) return tool;
    return {
      ...tool,
      execute: async (input: unknown) => {
        await context.taskGuard?.(tool.name);
        return tool.execute(input);
      },
    };
  });
}

export { createAgentTool } from './contract';
export type { AgentToolDefinition, AgentToolResult, AgentToolContent } from './contract';
