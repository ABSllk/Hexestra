import { cn } from '@/lib/cn';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  untested: 'bg-node-untested/20 text-node-untested',
  in_progress: 'bg-node-progress/20 text-node-progress',
  scanned: 'bg-node-scanned/20 text-node-scanned',
  vulnerable: 'bg-node-vulnerable/20 text-node-vulnerable',
  compromised: 'bg-node-compromised/20 text-node-compromised',
  pending: 'bg-raised text-text-muted',
  completed: 'bg-node-compromised/20 text-node-compromised',
  blocked: 'bg-severity-critical/20 text-severity-critical',
  failed: 'bg-severity-critical/20 text-severity-critical',
  active: 'bg-node-compromised/20 text-node-compromised',
  paused: 'bg-node-scanned/20 text-node-scanned',
  archived: 'bg-raised text-text-muted',
};

const STATUS_LABELS: Record<string, string> = {
  untested: 'Untested',
  in_progress: 'In Progress',
  scanned: 'Scanned',
  vulnerable: 'Vulnerable',
  compromised: 'Compromised',
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
        'inline-flex min-h-6 items-center rounded-md border border-transparent px-2 text-[11px] font-medium',
        style,
        className
      )}
    >
      {label}
    </span>
  );
}
