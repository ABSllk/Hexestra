import type { PersistedChatMessage } from './project-state';
import type { AgentBackendRuntimeState } from '../contracts/agent-runtime';

export interface BranchResumeOptions {
  sessionId?: string;
  resumeAt?: string;
  fork: boolean;
}

export function resolveBranchResumeOptions(
  messages: PersistedChatMessage[],
  sourceIndex: number,
  runtime: AgentBackendRuntimeState | null,
  currentFingerprint: string,
): BranchResumeOptions {
  const precedingAssistant = [...messages.slice(0, sourceIndex)]
    .reverse()
    .find((message) => message.role === 'assistant' && message.backendMessageId);
  const canResume = Boolean(
    precedingAssistant?.backendMessageId
    && runtime?.sessionId
    && runtime.connectionFingerprint === currentFingerprint,
  );
  return {
    sessionId: canResume ? runtime?.sessionId ?? undefined : undefined,
    resumeAt: canResume ? precedingAssistant?.backendMessageId : undefined,
    fork: canResume,
  };
}
