import { describe, expect, it } from 'vitest';
import type { PersistedChatMessage } from './project-state';
import { resolveBranchResumeOptions } from './conversation-branch';
import type { AgentBackendRuntimeState } from '../contracts/agent-runtime';

const messages: PersistedChatMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    content: 'First request',
    timestamp: '2026-07-31T00:00:00.000Z',
    status: 'complete',
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: 'First response',
    timestamp: '2026-07-31T00:00:01.000Z',
    status: 'complete',
    backendMessageId: 'sdk-assistant-1',
  },
  {
    id: 'user-2',
    role: 'user',
    content: 'Second request',
    timestamp: '2026-07-31T00:00:02.000Z',
    status: 'complete',
  },
];

describe('conversation branch resume planning', () => {
  it('forks the Claude session at the preceding assistant UUID', () => {
    expect(resolveBranchResumeOptions(
      messages,
      2,
      {
        backendId: 'claude',
        sessionId: 'claude-session-a',
        connectionFingerprint: 'wsl:Ubuntu:/usr/bin/claude',
      } satisfies AgentBackendRuntimeState,
      'wsl:Ubuntu:/usr/bin/claude',
    )).toEqual({
      sessionId: 'claude-session-a',
      resumeAt: 'sdk-assistant-1',
      fork: true,
    });
  });

  it('starts fresh for the first turn or a changed runtime', () => {
    expect(resolveBranchResumeOptions(
      messages,
      0,
      {
        backendId: 'claude',
        sessionId: 'claude-session-a',
        connectionFingerprint: 'native::claude',
      },
      'native::claude',
    )).toEqual({ sessionId: undefined, resumeAt: undefined, fork: false });
    expect(resolveBranchResumeOptions(
      messages,
      2,
      {
        backendId: 'claude',
        sessionId: 'claude-session-a',
        connectionFingerprint: 'wsl:Ubuntu:/usr/bin/claude',
      },
      'native::claude',
    )).toEqual({ sessionId: undefined, resumeAt: undefined, fork: false });
  });
});
