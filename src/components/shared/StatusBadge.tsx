import { cn } from '@/lib/cn';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  untested: 'bg-node-untested/20 text-node-untested border-node-untested/30',
  in_progress: 'bg-node-progress/20 text-node-progress border-node-progress/30',
  scanned: 'bg-node-scanned/20 text-node-scanned border-node-scanned/30',
  vulnerable: 'bg-node-vulnerable/20 text-node-vulnerable border-node-vulnerable/30',
  compromised: 'bg-node-compromised/20 text-node-compromised border-node-compromised/30',
  out_of_scope: 'bg-surface text-text-muted border-text-muted/30',
  pending: 'bg-surface text-text-muted border-text-muted/30',
  completed: 'bg-node-compromised/20 text-node-compromised border-node-compromised/30',
  blocked: 'bg-severity-critical/20 text-severity-critical border-severity-critical/30',
  failed: 'bg-severity-critical/20 text-severity-critical border-severity-critical/30',
  active: 'bg-node-compromised/20 text-node-compromised border-node-compromised/30',
  paused: 'bg-node-scanned/20 text-node-scanned border-node-scanned/30',
  archived: 'bg-surface text-text-muted border-text-muted/30',
};

const STATUS_LABELS: Record<string, string> = {
  untested: 'Untested',
  in_progress: 'In Progress',
  scanned: 'Scanned',
  vulnerable: 'Vulnerable',
  compromised: 'Compromised',
  out_of_scope: 'Out of Scope',
  pending: 'Pending',
  completed: 'Done',
  blocked: 'Blocked',
  failed: 'Failed',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  const label = STATUS_LABELS[status] ?? status;

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium border',
        style,
        className
      )}
    >
      {label}
    </span>
  );
}
