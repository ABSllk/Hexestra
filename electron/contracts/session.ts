export type ScopeMode = 'whitelist' | 'blacklist';
export type ScopeAnnotation = 'authorized' | 'excluded';
export type ScopeAdvisory = 'included' | 'unlisted' | 'excluded' | 'neutral';

export interface SessionScopePayload {
  mode: ScopeMode;
  allowRules: string[];
  excludeRules: string[];
}

export interface SessionDataChangedEvent {
  sessionId: string;
  targets?: boolean;
  netmap?: boolean;
  tasks?: boolean;
  files?: boolean;
  findings?: boolean;
  vulnerabilities?: boolean;
  evidence?: boolean;
  reports?: boolean;
  changes?: boolean;
  scope?: SessionScopePayload;
}

export function isSessionDataChangedEvent(value: unknown): value is SessionDataChangedEvent {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { sessionId?: unknown }).sessionId === 'string';
}
