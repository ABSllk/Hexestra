/**
 * Normalize a backend-native slash command while leaving ordinary prompts alone.
 * Claude Code recognizes these commands only when the slash command is the
 * actual user input, rather than text embedded inside a larger prompt.
 */
export function normalizeAgentSlashCommand(content: string): string | null {
  const trimmed = content.trim();
  return /^\/\S+/.test(trimmed) ? trimmed : null;
}

export interface AgentSlashCommandDescriptor {
  name: string;
  description: string;
  argumentHint: string;
  aliases: string[];
}

export interface AgentCommandsChangedPayload {
  sessionId: string | null;
  commands: AgentSlashCommandDescriptor[];
}

export function normalizeAgentCommandsChangedPayload(value: unknown): AgentCommandsChangedPayload | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.sessionId !== null && typeof record.sessionId !== 'string') return null;
  if (!Array.isArray(record.commands)) return null;
  return {
    sessionId: record.sessionId as string | null,
    commands: normalizeAgentSlashCommands(record.commands),
  };
}

/**
 * Normalize the SDK command catalog at the main/renderer boundary. The SDK
 * reports names without a leading slash, while older runtimes and test doubles
 * may omit descriptions, hints, or aliases.
 */
export function normalizeAgentSlashCommands(value: unknown): AgentSlashCommandDescriptor[] {
  if (!Array.isArray(value)) return [];
  const commands = new Map<string, AgentSlashCommandDescriptor>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const name = normalizeCommandName(record.name);
    if (!name) continue;
    const aliases = Array.isArray(record.aliases)
      ? record.aliases.map(normalizeCommandName).filter((alias): alias is string => Boolean(alias))
      : [];
    commands.set(name, {
      name,
      description: typeof record.description === 'string' ? record.description.trim() : '',
      argumentHint: typeof record.argumentHint === 'string' ? record.argumentHint.trim() : '',
      aliases: [...new Set(aliases.filter((alias) => alias !== name))],
    });
  }
  return [...commands.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeCommandName(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^\/+/, '');
  return trimmed && !/\s/.test(trimmed) ? `/${trimmed}` : null;
}
