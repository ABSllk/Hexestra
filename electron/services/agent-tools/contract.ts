import { z } from 'zod';
import { isReadOnlyHexestraTool } from '../agent-tool-policy';
import type {
  AgentToolDefinition,
  AgentToolResult,
  AgentToolRiskLevel,
} from '../../contracts/agent-tools';

export type { AgentToolContent, AgentToolDefinition, AgentToolResult, AgentToolRiskLevel } from '../../contracts/agent-tools';

export function createAgentTool<TShape extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: TShape,
  execute: (input: z.infer<z.ZodObject<TShape>>) => Promise<AgentToolResult> | AgentToolResult,
  riskLevel: AgentToolRiskLevel = isReadOnlyHexestraTool(name) ? 'read' : 'write',
): AgentToolDefinition {
  return {
    name,
    description,
    inputSchema,
    riskLevel,
    execute: (input) => execute(input as z.infer<z.ZodObject<TShape>>),
  };
}
