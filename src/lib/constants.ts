export const APP_NAME = 'Hexestra';
export const APP_VERSION = '0.2.0';

export const SESSION_DIR = 'sessions';

export const NODE_COLORS = {
  untested: '#6c7086',
  in_progress: '#89b4fa',
  scanned: '#f9e2af',
  vulnerable: '#fab387',
  compromised: '#a6e3a1',
  out_of_scope: '#45475a',
} as const;

export const SEVERITY_COLORS = {
  critical: '#f38ba8',
  high: '#fab387',
  medium: '#f9e2af',
  low: '#a6e3a1',
  info: '#89b4fa',
} as const;

export const STATUS_LABELS: Record<string, string> = {
  untested: 'Untested',
  in_progress: 'In Progress',
  scanned: 'Scanned',
  vulnerable: 'Vulnerable',
  compromised: 'Compromised',
  out_of_scope: 'Out of Scope',
  pending: 'Pending',
  completed: 'Completed',
  blocked: 'Blocked',
  skipped: 'Skipped',
  failed: 'Failed',
};
