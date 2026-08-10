import { describe, expect, it } from 'vitest';
import {
  normalizeAgentCommandsChangedPayload,
  normalizeAgentSlashCommand,
  normalizeAgentSlashCommands,
} from '@electron/agent-command-contract';

describe('Agent slash-command contract', () => {
  it('normalizes commands and preserves their arguments', () => {
    expect(normalizeAgentSlashCommand('  /compact  ')).toBe('/compact');
    expect(normalizeAgentSlashCommand('/review src/main.ts')).toBe('/review src/main.ts');
  });

  it('does not classify ordinary prompts or an empty slash as commands', () => {
    expect(normalizeAgentSlashCommand('Explain /compact to me')).toBeNull();
    expect(normalizeAgentSlashCommand('/')).toBeNull();
    expect(normalizeAgentSlashCommand('')).toBeNull();
  });
});

describe('normalizeAgentSlashCommands', () => {
  it('normalizes SDK names, aliases, optional metadata, and ordering', () => {
    expect(normalizeAgentSlashCommands([
      { name: 'doctor', description: ' Check health ', argumentHint: '', aliases: [] },
      { name: '/compact', description: 'Compact', argumentHint: ' [instructions] ', aliases: ['compress', '/shrink'] },
      { name: 'bad command', description: 'ignored' },
      null,
    ])).toEqual([
      {
        name: '/compact', description: 'Compact', argumentHint: '[instructions]',
        aliases: ['/compress', '/shrink'],
      },
      { name: '/doctor', description: 'Check health', argumentHint: '', aliases: [] },
    ]);
  });

  it('rejects malformed command-change events at the IPC boundary', () => {
    expect(normalizeAgentCommandsChangedPayload({ sessionId: 42, commands: [] })).toBeNull();
    expect(normalizeAgentCommandsChangedPayload({ sessionId: null, commands: {} })).toBeNull();
    expect(normalizeAgentCommandsChangedPayload({
      sessionId: 'project-1',
      commands: [{ name: 'help', description: 'Help', argumentHint: '', aliases: [] }],
    })).toEqual({
      sessionId: 'project-1',
      commands: [{ name: '/help', description: 'Help', argumentHint: '', aliases: [] }],
    });
  });
});
