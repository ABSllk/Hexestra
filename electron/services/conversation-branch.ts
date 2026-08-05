import type { PersistedChatMessage } from './project-state';

export interface BranchResumeOptions {
  sessionId?: string;
  resumeAt?: string;
  fork: boolean;
}

export function resolveBranchResumeOptions(
  messages: PersistedChatMessage[],
  sourceIndex: number,
  claudeSessionId: string | null,
  sourceFingerprint: string | null,
  currentFingerprint: string,
): BranchResumeOptions {
  const precedingAssistant = [...messages.slice(0, sourceIndex)]
    .reverse()
    .find((message) => message.role === 'assistant' && message.sdkMessageId);
  const canResume = Boolean(
    precedingAssistant?.sdkMessageId
    && claudeSessionId
    && sourceFingerprint === currentFingerprint,
  );
  return {
    sessionId: canResume ? claudeSessionId ?? undefined : undefined,
    resumeAt: canResume ? precedingAssistant?.sdkMessageId : undefined,
    fork: canResume,
  };
}
