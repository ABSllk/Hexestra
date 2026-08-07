import { z } from 'zod';

export type AgentToolRiskLevel = 'read' | 'write';

export type AgentToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface AgentToolResult extends Record<string, unknown> {
  content: AgentToolContent[];
  isError?: boolean;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  riskLevel: AgentToolRiskLevel;
  execute: (input: unknown) => Promise<AgentToolResult> | AgentToolResult;
}
