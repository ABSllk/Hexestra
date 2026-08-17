import type { AgentToolDefinition } from '../../contracts/agent-tools';

export type ClaudeAgentSdk = typeof import('@anthropic-ai/claude-agent-sdk');

export function createClaudeSdkTools(
  sdk: ClaudeAgentSdk,
  definitions: AgentToolDefinition[],
  resolveDefinition?: (name: string) => AgentToolDefinition | undefined,
) {
  return definitions.map((definition) => sdk.tool(
    definition.name,
    definition.description,
    definition.inputSchema,
    async (input) => {
      const activeDefinition = resolveDefinition
        ? resolveDefinition(definition.name)
        : definition;
      if (!activeDefinition) {
        throw new Error(`Claude tool ${definition.name} has no active Agent turn`);
      }
      return activeDefinition.execute(input);
    },
  ));
}
