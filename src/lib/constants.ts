export const APP_NAME = 'Hexestra';
export const APP_VERSION = '0.2.1';

export const SESSION_DIR = 'sessions';

export const NODE_COLORS = {
  untested: '#7C899B',
  in_progress: '#4F8CFF',
  scanned: '#FDE68A',
  vulnerable: '#FDBA74',
  compromised: '#6EE7B7',
  out_of_scope: '#273244',
} as const;

export const SEVERITY_COLORS = {
  critical: '#FB7185',
  high: '#FDBA74',
  medium: '#FDE68A',
  low: '#6EE7B7',
  info: '#4F8CFF',
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
