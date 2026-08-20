import type { AgentToolContext } from './context';
import { isReadOnlyHexestraTool } from '../agent-tool-policy';
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

function isTaskGuardedTool(name: string, riskLevel?: string) {
  // Read-only tools (recon, reading pages/scrollback/traffic) never mutate state,
  // so they must not require a focused Task; only state-changing work is gated.
  if (isReadOnlyHexestraTool(name)) return false;
  if (/^(task_|restriction_|tool_catalog_|attack_catalog_)/.test(name)) return false;
  if (/^(target_|asset_|finding_|vulnerability_|evidence_|report_|scope_)/.test(name)) return false;
  if (/^(browser|shell|traffic|egress-proxy|mcp|subagent|Task$|Agent)/.test(name)) return true;
  return riskLevel === 'write';
}

export { createAgentTool } from './contract';
export type { AgentToolDefinition, AgentToolResult, AgentToolContent } from './contract';
