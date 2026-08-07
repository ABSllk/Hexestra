import type { AgentToolDefinition } from '../../contracts/agent-tools';

export type ClaudeAgentSdk = typeof import('@anthropic-ai/claude-agent-sdk');

export function createClaudeSdkTools(
  sdk: ClaudeAgentSdk,
  definitions: AgentToolDefinition[],
) {
  return definitions.map((definition) => sdk.tool(
    definition.name,
    definition.description,
    definition.inputSchema,
    async (input) => definition.execute(input),
  ));
}
