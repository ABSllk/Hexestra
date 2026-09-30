import { cn } from '@/lib/cn';
import type { VulnerabilitySeverity } from '@/types';

interface SeverityBadgeProps {
  severity: VulnerabilitySeverity;
  className?: string;
}

const STYLES: Record<VulnerabilitySeverity, string> = {
  critical: 'bg-severity-critical/20 text-severity-critical',
  high: 'bg-severity-high/20 text-severity-high',
  medium: 'bg-severity-medium/20 text-severity-medium',
  low: 'bg-severity-low/20 text-severity-low',
  info: 'bg-severity-info/20 text-severity-info',
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center rounded-md border border-transparent px-2 text-[11px] font-semibold uppercase tracking-wider',
        STYLES[severity],
        className
      )}
    >
      {severity}
    </span>
  );
}
