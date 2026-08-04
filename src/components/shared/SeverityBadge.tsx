import { cn } from '@/lib/cn';
import type { VulnerabilitySeverity } from '@/types';

interface SeverityBadgeProps {
  severity: VulnerabilitySeverity;
  className?: string;
}

const STYLES: Record<VulnerabilitySeverity, string> = {
  critical: 'bg-severity-critical/20 text-severity-critical border-severity-critical/30',
  high: 'bg-severity-high/20 text-severity-high border-severity-high/30',
  medium: 'bg-severity-medium/20 text-severity-medium border-severity-medium/30',
  low: 'bg-severity-low/20 text-severity-low border-severity-low/30',
  info: 'bg-severity-info/20 text-severity-info border-severity-info/30',
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-semibold uppercase tracking-wider border',
        STYLES[severity],
        className
      )}
    >
      {severity}
    </span>
  );
}
